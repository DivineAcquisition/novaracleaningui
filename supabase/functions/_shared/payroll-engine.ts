// ─── Payroll engine (draft + guarded auto-execute) ──────────────────────────
//
// Single source of truth for the "Review → Approve → Auto-Execute" payroll
// flow, shared by the scheduled payroll-draft function, the payroll-execute
// function, and the payroll-admin build_runs action. All money math runs here
// on the server; the client never computes or moves money.
//
// Built on the isolated manual payroll subsystem (payroll_jobs /
// payroll_job_cleaners / payroll_runs) so it never collides with the live
// booking→completion→payout flow.

import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "./app-secrets.ts";
import { syncPayrollRunToOps } from "./airtable-payroll-ops.ts";

// deno-lint-ignore no-explicit-any
type DB = any;

// ─── Date helpers (Mon–Sun, anchored at UTC noon so DST never shifts day) ──
function pad(n: number): string { return String(n).padStart(2, "0"); }
function ymd(d: Date): string { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }

/** Monday (YYYY-MM-DD) of the week the given date falls in. */
export function mondayOf(dateInput: string): string {
  const d = new Date(`${String(dateInput).slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return ymd(d);
}
export function sundayOf(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return ymd(d);
}
/** Monday of the period that ended yesterday (i.e. last completed Mon–Sun). */
export function priorPeriodMonday(now = new Date()): string {
  const thisMonday = new Date(`${mondayOf(ymd(now))}T12:00:00Z`);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  return ymd(thisMonday);
}

const audit = async (admin: DB, row: { run_id?: string; action: string; detail?: string; actor?: string | null }) => {
  try { await admin.from("payroll_job_audit").insert(row); } catch (_) { /* non-blocking */ }
};

// Fat-finger guard for an admin-entered per-cleaner send amount ($20k cap).
const MAX_LINE_CENTS = 2_000_000;

/** Resolve the amount to actually send for a run: an admin override (if valid)
 *  otherwise the computed net. Returns a non-negative integer, clamped to the
 *  per-line ceiling. */
function resolveSendCents(net: number, override: unknown): number {
  if (override === undefined || override === null) return net;
  const n = Math.round(Number(override));
  if (!Number.isFinite(n) || n < 0) return net;
  return Math.min(n, MAX_LINE_CENTS);
}

// ─── Step 1: auto-compute + draft the weekly run (idempotent) ───────────────
//
// Groups APPROVED payroll jobs in the period by cleaner, sums each cleaner's
// LOCKED per-cleaner pay (payroll_job_cleaners.pay_cents — never recomputed),
// and upserts one Draft payroll_runs row per cleaner. Re-running updates the
// existing Draft and never duplicates or double-attaches jobs.
export interface BuildDraftResult {
  period: string;
  periodEnd: string;
  runs: number;
  pendingJobs: number;   // approved-pending jobs not yet drafted into a run
  netCents: number;
}

export async function buildDraftRuns(admin: DB, periodInput: string): Promise<BuildDraftResult> {
  const period = mondayOf(periodInput);
  const periodEnd = sundayOf(period);

  const { data: jobs } = await admin
    .from("payroll_jobs")
    .select("id")
    .eq("pay_period", period)
    .eq("payment_status", "approved");
  const jobIds = (jobs || []).map((j: { id: string }) => j.id);

  // Count still-pending (unapproved) jobs so the notifier can nudge the admin.
  const { count: pendingJobs } = await admin
    .from("payroll_jobs")
    .select("id", { count: "exact", head: true })
    .eq("pay_period", period)
    .eq("payment_status", "pending");

  if (jobIds.length === 0) {
    return { period, periodEnd, runs: 0, pendingJobs: pendingJobs || 0, netCents: 0 };
  }

  const { data: lines } = await admin
    .from("payroll_job_cleaners")
    .select("id, cleaner_id, pay_cents, job_id, supply_reimbursement_cents, mileage_reimbursement_cents")
    .in("job_id", jobIds)
    .eq("payment_status", "approved");

  const byCleaner = new Map<string, { ids: string[]; gross: number; jobs: number; reimb: number }>();
  for (const l of lines || []) {
    const g = byCleaner.get(l.cleaner_id) || { ids: [], gross: 0, jobs: 0, reimb: 0 };
    g.ids.push(l.id);
    g.gross += Number(l.pay_cents) || 0;
    g.reimb += (Number(l.supply_reimbursement_cents) || 0) + (Number(l.mileage_reimbursement_cents) || 0);
    g.jobs += 1;
    byCleaner.set(l.cleaner_id, g);
  }
  if (byCleaner.size === 0) {
    return { period, periodEnd, runs: 0, pendingJobs: pendingJobs || 0, netCents: 0 };
  }

  const cleanerIds = Array.from(byCleaner.keys());
  const { data: cleaners } = await admin
    .from("cleaners")
    .select("id, payment_method, stripe_account_id, payouts_enabled")
    .in("id", cleanerIds);
  const cleanerMap = new Map((cleaners || []).map((c: Record<string, unknown>) => [String(c.id), c]));

  let runCount = 0;
  let netTotal = 0;
  for (const [cleanerId, g] of byCleaner) {
    const c = (cleanerMap.get(cleanerId) || {}) as Record<string, unknown>;
    const method = String(c.payment_method || "stripe_connect");
    const stripeId = (c.stripe_account_id as string) || null;
    const needsStripe = method === "stripe_connect";
    const status = needsStripe && !stripeId ? "hold" : "draft";

    const { data: prior } = await admin
      .from("payroll_runs")
      .select("id, bonus_cents, deduction_cents, status")
      .eq("cleaner_id", cleanerId)
      .eq("pay_period_start", period)
      .maybeSingle();
    // Never touch a run that already went out / is in flight.
    if (prior && ["processing", "sent", "paid", "cleared"].includes(String(prior.status))) continue;

    const bonus = Number(prior?.bonus_cents) || 0;
    const deduction = Number(prior?.deduction_cents) || 0;
    // Per-job supply + mileage reimbursements ride the same payout rail.
    const net = g.gross + bonus + g.reimb - deduction;
    netTotal += net;

    const { data: run, error: runErr } = await admin
      .from("payroll_runs")
      .upsert({
        ...(prior?.id ? { id: prior.id } : {}),
        cleaner_id: cleanerId,
        pay_period_start: period,
        pay_period_end: periodEnd,
        total_jobs: g.jobs,
        gross_cents: g.gross,
        bonus_cents: bonus,
        deduction_cents: deduction,
        reimbursement_cents: g.reimb,
        net_cents: net,
        payment_method: method,
        stripe_connect_id: stripeId,
        status,
        updated_at: new Date().toISOString(),
      }, { onConflict: "cleaner_id,pay_period_start" })
      .select("id")
      .single();
    if (runErr) continue;

    await admin.from("payroll_job_cleaners").update({ payroll_run_id: run.id }).in("id", g.ids);
    runCount++;
  }

  return { period, periodEnd, runs: runCount, pendingJobs: pendingJobs || 0, netCents: netTotal };
}

// ─── STRIPE_ENV guard ───────────────────────────────────────────────────────
function envGuard(stripeEnv: string, key: string): string | null {
  const isLiveKey = key.startsWith("sk_live");
  const wantLive = stripeEnv.toLowerCase() === "live";
  if (wantLive && !isLiveKey) return "STRIPE_ENV=live but STRIPE_SECRET_KEY is a test key — halted.";
  if (!wantLive && isLiveKey) return `STRIPE_ENV=${stripeEnv} but STRIPE_SECRET_KEY is a LIVE key — halted to prevent an unintended live payout.`;
  return null;
}

export interface ExecuteLineResult {
  runId: string;
  cleanerId: string;
  cleanerName: string;
  netCents: number;
  sentCents?: number;
  status: "paid" | "failed" | "skipped" | "blocked";
  transferId?: string;
  reason?: string;
}

export interface ClawbackResult {
  ok: boolean;
  reason?: string;
  reversalId?: string;
  amountCents?: number;
  clawedBackTotalCents?: number;
}
export interface ExecutePeriodResult {
  ok: boolean;
  halted?: boolean;
  reason?: string;
  period: string;
  totals: { payable: number; blocked: number; paidCount: number; failedCount: number; netPaidCents: number };
  results: ExecuteLineResult[];
}

// ─── Steps 2+3: approve → auto-execute every payable line in the period ─────
//
// One call pays every payable cleaner in the period. Re-validates server-side,
// checks platform balance once up-front, claims a per-run processing lock, then
// fires idempotent Stripe transfers. One cleaner failing never blocks the rest.
export async function executePeriod(
  admin: DB,
  opts: { period: string; actor?: string | null; overrides?: Record<string, number> },
): Promise<ExecutePeriodResult> {
  const period = mondayOf(opts.period);
  const actor = opts.actor || null;
  const overrides = opts.overrides || {};

  const empty: ExecutePeriodResult = {
    ok: true, period,
    totals: { payable: 0, blocked: 0, paidCount: 0, failedCount: 0, netPaidCents: 0 },
    results: [],
  };

  // Candidate runs for this period (exclude already-terminal/in-flight).
  const { data: runs } = await admin
    .from("payroll_runs")
    .select("*")
    .eq("pay_period_start", period)
    .in("status", ["draft", "approved", "hold"]);
  if (!runs || runs.length === 0) return empty;

  // Resolve cleaner readiness (names + live payouts_enabled).
  const cleanerIds = Array.from(new Set(runs.map((r: Record<string, unknown>) => String(r.cleaner_id))));
  const { data: cleaners } = await admin
    .from("cleaners")
    .select("id, first_name, last_name, payment_method, stripe_account_id, payouts_enabled")
    .in("id", cleanerIds);
  const cmap = new Map((cleaners || []).map((c: Record<string, unknown>) => [String(c.id), c]));
  const nameOf = (id: string) => {
    const c = cmap.get(id) as Record<string, unknown> | undefined;
    return c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner";
  };

  // Classify each run.
  const payable: Array<Record<string, unknown>> = [];
  const results: ExecuteLineResult[] = [];
  let blocked = 0;
  for (const run of runs) {
    const cid = String(run.cleaner_id);
    const c = (cmap.get(cid) || {}) as Record<string, unknown>;
    const method = String(run.payment_method || c.payment_method || "stripe_connect");
    const net = Number(run.net_cents) || 0;
    const stripeId = (run.stripe_connect_id as string) || (c.stripe_account_id as string) || null;

    // Admin can override the exact amount sent for this line.
    const send = resolveSendCents(net, overrides[String(run.id)]);

    if (method !== "stripe_connect") {
      // Manual methods (ACH/Zelle/cash): tracked only, marked paid, no transfer.
      payable.push({ ...run, __manual: true, __net: net, __send: send, __stripeId: stripeId });
      continue;
    }
    if (!stripeId) {
      blocked++;
      await admin.from("payroll_runs").update({ status: "hold", failure_reason: "No Stripe Connect account", updated_at: new Date().toISOString() }).eq("id", run.id);
      results.push({ runId: run.id, cleanerId: cid, cleanerName: nameOf(cid), netCents: net, status: "blocked", reason: "No Stripe Connect account" });
      continue;
    }
    if (!c.payouts_enabled) {
      blocked++;
      await admin.from("payroll_runs").update({ status: "hold", failure_reason: "Payouts not enabled on Stripe account", updated_at: new Date().toISOString() }).eq("id", run.id);
      results.push({ runId: run.id, cleanerId: cid, cleanerName: nameOf(cid), netCents: net, status: "blocked", reason: "payouts_enabled = false" });
      continue;
    }
    if (send <= 0) {
      results.push({ runId: run.id, cleanerId: cid, cleanerName: nameOf(cid), netCents: net, status: "skipped", reason: "Amount ≤ 0" });
      continue;
    }
    payable.push({ ...run, __net: net, __send: send, __stripeId: stripeId });
  }

  if (payable.length === 0) {
    return { ...empty, totals: { ...empty.totals, blocked }, results };
  }

  // Stripe init + env guard.
  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) {
    return { ok: false, halted: true, reason: "STRIPE_SECRET_KEY not configured", period, totals: { payable: payable.length, blocked, paidCount: 0, failedCount: 0, netPaidCents: 0 }, results };
  }
  const stripeEnv = (await resolveSecret(admin, "STRIPE_ENV")) || "test";
  const guardErr = envGuard(stripeEnv, key);
  if (guardErr) {
    return { ok: false, halted: true, reason: guardErr, period, totals: { payable: payable.length, blocked, paidCount: 0, failedCount: 0, netPaidCents: 0 }, results };
  }
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  // Balance check (Stripe transfers only) — halt before firing if short.
  const stripeNet = payable.filter((r) => !r.__manual).reduce((a, r) => a + Number(r.__send || 0), 0);
  if (stripeNet > 0) {
    try {
      const bal = await stripe.balance.retrieve();
      const available = (bal.available || []) as Array<{ amount: number; currency: string }>;
      const availableUsd = available
        .filter((b) => b.currency === "usd")
        .reduce((a, b) => a + (b.amount || 0), 0);
      if (availableUsd < stripeNet) {
        return {
          ok: false, halted: true,
          reason: `Insufficient Stripe balance: $${(availableUsd / 100).toFixed(2)} available, $${(stripeNet / 100).toFixed(2)} needed. No transfers were sent.`,
          period,
          totals: { payable: payable.length, blocked, paidCount: 0, failedCount: 0, netPaidCents: 0 },
          results,
        };
      }
    } catch (balErr) {
      return {
        ok: false, halted: true,
        reason: `Could not verify Stripe balance: ${balErr instanceof Error ? balErr.message : String(balErr)}. No transfers were sent.`,
        period,
        totals: { payable: payable.length, blocked, paidCount: 0, failedCount: 0, netPaidCents: 0 },
        results,
      };
    }
  }

  // Execute each payable line. Atomic processing-lock claim per run prevents a
  // double-click / concurrent run from paying twice (belt + Stripe idempotency).
  let paidCount = 0, failedCount = 0, netPaid = 0;
  const markPaidJobs = async (runId: string) => {
    const { data: jl } = await admin.from("payroll_job_cleaners").select("job_id").eq("payroll_run_id", runId);
    const jobIds = Array.from(new Set((jl || []).map((l: { job_id: string }) => l.job_id)));
    await admin.from("payroll_job_cleaners").update({ payment_status: "paid" }).eq("payroll_run_id", runId);
    if (jobIds.length > 0) {
      await admin.from("payroll_jobs").update({ payment_status: "paid", locked: true, updated_at: new Date().toISOString() }).in("id", jobIds);
    }
  };

  for (const run of payable) {
    const runId = String(run.id);
    const cid = String(run.cleaner_id);
    const net = Number(run.__net || 0);
    const send = Number(run.__send ?? net);
    const overridden = send !== net;
    const cleanerName = nameOf(cid);

    // Claim the lock: only transition rows still draft/approved/hold.
    const { data: claimed } = await admin
      .from("payroll_runs")
      .update({ status: "processing", processing_at: new Date().toISOString(), approved_by: run.approved_by || actor, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .in("status", ["draft", "approved", "hold"])
      .select("id");
    if (!claimed || claimed.length === 0) {
      // Someone else already claimed it — skip silently (idempotent).
      results.push({ runId, cleanerId: cid, cleanerName, netCents: net, sentCents: 0, status: "skipped", reason: "Already processing/paid" });
      continue;
    }

    // Manual (non-Stripe) method: record as paid, no transfer.
    if (run.__manual) {
      await admin.from("payroll_runs").update({
        status: "paid", sent_amount_cents: send, sent_at: new Date().toISOString(), executed_at: new Date().toISOString(), executed_by: actor, updated_at: new Date().toISOString(),
      }).eq("id", runId);
      await markPaidJobs(runId);
      await audit(admin, { run_id: runId, action: "execute_manual", detail: `${String(run.payment_method)} ${send}${overridden ? ` (override of ${net})` : ""}`, actor });
      paidCount++; netPaid += send;
      results.push({ runId, cleanerId: cid, cleanerName, netCents: net, sentCents: send, status: "paid" });
      await syncRunToOps(admin, runId, cleanerName);
      continue;
    }

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: send,
          currency: "usd",
          destination: run.__stripeId as string,
          description: `Novara payroll ${period} — ${cleanerName}`,
          metadata: { payroll_run_id: runId, cleaner_id: cid, pay_period: period, overridden: String(overridden) },
        },
        // Idempotency key includes the amount so a corrected re-send after a
        // failure isn't blocked, while a true double-click (same amount) is.
        { idempotencyKey: `payroll_run_${runId}_${send}` },
      );
      await admin.from("payroll_runs").update({
        status: "paid",
        stripe_transfer_id: transfer.id,
        sent_amount_cents: send,
        sent_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        executed_by: actor,
        sent_by: actor,
        failure_reason: null,
        updated_at: new Date().toISOString(),
      }).eq("id", runId);
      await markPaidJobs(runId);
      await audit(admin, { run_id: runId, action: "execute_stripe", detail: `${transfer.id} ${send}${overridden ? ` (override of ${net})` : ""}`, actor });
      paidCount++; netPaid += send;
      results.push({ runId, cleanerId: cid, cleanerName, netCents: net, sentCents: send, status: "paid", transferId: transfer.id });
      await syncRunToOps(admin, runId, cleanerName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("payroll_runs").update({ status: "failed", failure_reason: msg, updated_at: new Date().toISOString() }).eq("id", runId);
      await audit(admin, { run_id: runId, action: "execute_failed", detail: msg.slice(0, 400), actor });
      failedCount++;
      results.push({ runId, cleanerId: cid, cleanerName, netCents: net, sentCents: 0, status: "failed", reason: msg });
      await syncRunToOps(admin, runId, cleanerName);
    }
  }

  return {
    ok: true, period,
    totals: { payable: payable.length, blocked, paidCount, failedCount, netPaidCents: netPaid },
    results,
  };
}

// ─── Clawback: reverse part/all of a paid transfer ─────────────────────────
//
// If too much was sent, pull funds back from the contractor's connected account
// to the platform via a Stripe transfer reversal. Amount is admin-entered and
// capped at the un-recovered portion of what was sent. Recorded + audited.
export async function clawbackRun(
  admin: DB,
  opts: { runId: string; amountCents: number; reason?: string | null; actor?: string | null },
): Promise<ClawbackResult> {
  const runId = String(opts.runId || "");
  const actor = opts.actor || null;
  const amount = Math.round(Number(opts.amountCents) || 0);
  if (!runId) return { ok: false, reason: "runId required" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Enter an amount greater than $0." };

  const { data: run } = await admin.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return { ok: false, reason: "Run not found" };
  const transferId = run.stripe_transfer_id as string | null;
  if (!transferId) return { ok: false, reason: "This run has no Stripe transfer to reverse." };
  if (!["sent", "paid", "cleared"].includes(String(run.status))) {
    return { ok: false, reason: `Run is not in a paid state (status: ${run.status}).` };
  }

  // Cap at what's still recoverable (sent minus already clawed back).
  const sent = Number(run.sent_amount_cents ?? run.net_cents) || 0;
  const already = Number(run.clawed_back_cents) || 0;
  const recoverable = Math.max(0, sent - already);
  if (amount > recoverable) {
    return { ok: false, reason: `You can claw back at most $${(recoverable / 100).toFixed(2)} (already recovered $${(already / 100).toFixed(2)} of $${(sent / 100).toFixed(2)}).` };
  }

  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) return { ok: false, reason: "STRIPE_SECRET_KEY not configured" };
  const stripeEnv = (await resolveSecret(admin, "STRIPE_ENV")) || "test";
  const guardErr = envGuard(stripeEnv, key);
  if (guardErr) return { ok: false, reason: guardErr };
  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  // Record the attempt first so we have a stable idempotency key.
  const { data: cb, error: cbErr } = await admin.from("payroll_clawbacks").insert({
    run_id: runId,
    cleaner_id: run.cleaner_id,
    amount_cents: amount,
    stripe_transfer_id: transferId,
    reason: (opts.reason || "").toString().trim() || null,
    created_by: actor,
    status: "completed",
  }).select("id").single();
  if (cbErr) return { ok: false, reason: cbErr.message };

  try {
    const reversal = await stripe.transfers.createReversal(
      transferId,
      {
        amount,
        description: `Payroll clawback — run ${runId.slice(0, 8)}`,
        metadata: { payroll_run_id: runId, clawback_id: cb.id, reason: (opts.reason || "").toString().slice(0, 200) },
      },
      { idempotencyKey: `payroll_clawback_${cb.id}` },
    );
    const newTotal = already + amount;
    await admin.from("payroll_clawbacks").update({ stripe_reversal_id: reversal.id }).eq("id", cb.id);
    await admin.from("payroll_runs").update({ clawed_back_cents: newTotal, updated_at: new Date().toISOString() }).eq("id", runId);
    await audit(admin, { run_id: runId, action: "clawback", detail: `${reversal.id} -${amount}${opts.reason ? ` (${opts.reason})` : ""}`, actor });
    try {
      await notifyDiscordClawback(admin, { runId, amount, reason: opts.reason, reversalId: reversal.id });
    } catch (_) { /* non-blocking */ }
    return { ok: true, reversalId: reversal.id, amountCents: amount, clawedBackTotalCents: newTotal };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("payroll_clawbacks").update({ status: "failed", failure_reason: msg }).eq("id", cb.id);
    await audit(admin, { run_id: runId, action: "clawback_failed", detail: msg.slice(0, 400), actor });
    return { ok: false, reason: msg };
  }
}

async function notifyDiscordClawback(admin: DB, info: { runId: string; amount: number; reason?: string | null; reversalId: string }) {
  // Lazy import to keep clawback self-contained; discord is best-effort.
  const { notifyDiscord } = await import("./discord.ts");
  await notifyDiscord(admin, {
    title: "Payroll clawback executed",
    color: 15158332,
    fields: [
      { name: "Run", value: info.runId.slice(0, 8), inline: true },
      { name: "Amount", value: `$${(info.amount / 100).toFixed(2)}`, inline: true },
      { name: "Reversal", value: info.reversalId, inline: false },
      { name: "Reason", value: (info.reason || "—").toString().slice(0, 400), inline: false },
    ],
  });
}

async function syncRunToOps(admin: DB, runId: string, cleanerName: string) {
  try {
    const { data: fresh } = await admin.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
    if (!fresh) return;
    const ok = await syncPayrollRunToOps(admin, fresh, cleanerName);
    if (ok) await admin.from("payroll_runs").update({ airtable_synced_at: new Date().toISOString() }).eq("id", runId);
  } catch (_) { /* non-blocking */ }
}
