// payroll-admin
//
// Single admin/VA-gated entry point for ALL manual-payroll mutations. Every
// money figure (pool, per-cleaner pay, gross, net, pay period) is computed
// HERE on the server — never trusted from the client. Stripe transfers are
// idempotent (an existing stripe_transfer_id short-circuits a re-send).
//
// Actions:
//   create_job | update_job | delete_job | approve_jobs
//   build_runs | update_run | approve_run
//   send_payout | send_all
//   unlock_job
//
// Day-to-day payroll = enter jobs → approve → build weekly runs → send.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { resolveSecret } from "../_shared/app-secrets.ts";
import {
  calculateCleanerPoolCents,
  maxPayPercentage,
} from "../_shared/payout-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const log = (s: string, d?: unknown) =>
  console.log(`[payroll-admin] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type DB = any;

// ─── Pay-period helpers (Mon–Sun, computed from the calendar date) ─────────
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/** Monday (YYYY-MM-DD) of the week the given date falls in. */
function monday(dateInput: string): string {
  // Anchor at UTC noon of the calendar date so DST / tz never shifts the day.
  const datePart = String(dateInput).slice(0, 10);
  const d = new Date(`${datePart}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return ymd(d);
}
function sunday(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return ymd(d);
}

async function ensureAdminOrVa(admin: DB, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return u.user.id;
}

async function audit(admin: DB, row: { job_id?: string; run_id?: string; action: string; detail?: string; actor: string }) {
  try {
    await admin.from("payroll_job_audit").insert(row);
  } catch (_) { /* non-blocking */ }
}

// Fetch the selected cleaners' locked pay percentages.
async function loadCleanerPcts(admin: DB, cleanerIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (cleanerIds.length === 0) return map;
  const { data } = await admin
    .from("cleaners")
    .select("id, pay_percentage, pay_tier")
    .in("id", cleanerIds);
  for (const c of data || []) {
    const pct = Number(c.pay_percentage) ||
      (String(c.pay_tier).toLowerCase() === "elite" ? 45 : String(c.pay_tier).toLowerCase() === "proven" ? 40 : 35);
    map.set(String(c.id), pct);
  }
  return map;
}

// Recompute + persist a job's pay split for a set of cleaners. Returns the
// computed figures. Locks the tier % at the moment of save.
async function writeJobSplit(
  admin: DB,
  jobId: string,
  customerPaidCents: number,
  cleanerIds: string[],
  status: string,
): Promise<{ tierPct: number; poolCents: number; perCleanerCents: number }> {
  const pctMap = await loadCleanerPcts(admin, cleanerIds);
  const pcts = cleanerIds.map((id) => pctMap.get(id) ?? 35);
  const tierPct = maxPayPercentage(pcts.length ? pcts : [35]);
  const poolCents = calculateCleanerPoolCents(customerPaidCents, tierPct);
  const count = Math.max(1, cleanerIds.length);
  const perCleanerCents = Math.floor(poolCents / count);

  await admin.from("payroll_jobs").update({
    customer_paid_cents: customerPaidCents,
    cleaner_count: count,
    tier_pct_locked: tierPct,
    cleaner_pay_pool_cents: poolCents,
    pay_per_cleaner_cents: perCleanerCents,
    payment_status: status,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  // Replace the per-cleaner rows — but carry over any reimbursements already
  // recorded for a cleaner staying on the job (the delete/reinsert must never
  // wipe supplies/mileage the admin entered).
  const { data: priorLines } = await admin
    .from("payroll_job_cleaners")
    .select("cleaner_id, supply_reimbursement_cents, mileage_miles, mileage_rate_cents, mileage_reimbursement_cents, reimbursement_note")
    .eq("job_id", jobId);
  const priorByCleaner = new Map(
    (priorLines || []).map((l: Record<string, unknown>) => [String(l.cleaner_id), l]),
  );

  await admin.from("payroll_job_cleaners").delete().eq("job_id", jobId);
  if (cleanerIds.length > 0) {
    await admin.from("payroll_job_cleaners").insert(
      cleanerIds.map((cid) => {
        const prior = (priorByCleaner.get(cid) || {}) as Record<string, unknown>;
        return {
          job_id: jobId,
          cleaner_id: cid,
          pay_cents: perCleanerCents,
          payment_status: status,
          supply_reimbursement_cents: Number(prior.supply_reimbursement_cents) || 0,
          mileage_miles: Number(prior.mileage_miles) || 0,
          mileage_rate_cents: Number(prior.mileage_rate_cents) || 70,
          mileage_reimbursement_cents: Number(prior.mileage_reimbursement_cents) || 0,
          reimbursement_note: (prior.reimbursement_note as string) || null,
        };
      }),
    );
  }
  return { tierPct, poolCents, perCleanerCents };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const actor = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    switch (action) {
      // ─── Manual job entry ──────────────────────────────────────────────
      case "create_job": {
        const customerPaidCents = Math.max(0, Math.round(Number(body.customerPaidCents) || 0));
        const cleanerIds: string[] = Array.isArray(body.cleanerIds) ? body.cleanerIds.filter(Boolean) : [];
        const dateCompleted = String(body.dateCompleted || new Date().toISOString());
        if (cleanerIds.length === 0) return json({ error: "At least one cleaner is required." }, 400);
        if (customerPaidCents <= 0) return json({ error: "Customer paid amount is required." }, 400);

        const { data: job, error } = await admin.from("payroll_jobs").insert({
          date_completed: dateCompleted,
          customer_name: body.customerName || null,
          service_type: body.serviceType || "Standard",
          customer_paid_cents: customerPaidCents,
          pay_period: monday(dateCompleted),
          payment_status: "pending",
          entry_source: body.entrySource === "automated" ? "automated" : body.entrySource === "import" ? "import" : "manual",
          notes: body.notes || null,
          created_by: actor,
        }).select("id").single();
        if (error) throw error;

        const computed = await writeJobSplit(admin, job.id, customerPaidCents, cleanerIds, "pending");
        return json({ success: true, jobId: job.id, ...computed });
      }

      case "update_job": {
        const jobId = String(body.jobId || "");
        if (!jobId) return json({ error: "jobId required" }, 400);
        const { data: existing } = await admin.from("payroll_jobs").select("id, locked").eq("id", jobId).maybeSingle();
        if (!existing) return json({ error: "Job not found" }, 404);
        if (existing.locked) return json({ error: "Job is locked (attached to a sent/paid run). Use unlock_job first." }, 409);

        const customerPaidCents = Math.max(0, Math.round(Number(body.customerPaidCents) || 0));
        const cleanerIds: string[] = Array.isArray(body.cleanerIds) ? body.cleanerIds.filter(Boolean) : [];
        const dateCompleted = String(body.dateCompleted || new Date().toISOString());
        if (cleanerIds.length === 0) return json({ error: "At least one cleaner is required." }, 400);

        await admin.from("payroll_jobs").update({
          date_completed: dateCompleted,
          customer_name: body.customerName || null,
          service_type: body.serviceType || "Standard",
          pay_period: monday(dateCompleted),
          notes: body.notes || null,
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);

        const computed = await writeJobSplit(admin, jobId, customerPaidCents, cleanerIds, "pending");
        return json({ success: true, jobId, ...computed });
      }

      case "delete_job": {
        const jobId = String(body.jobId || "");
        if (!jobId) return json({ error: "jobId required" }, 400);
        const { data: existing } = await admin.from("payroll_jobs").select("id, locked").eq("id", jobId).maybeSingle();
        if (!existing) return json({ error: "Job not found" }, 404);
        if (existing.locked) return json({ error: "Job is locked — unlock before deleting." }, 409);
        await admin.from("payroll_jobs").delete().eq("id", jobId);
        return json({ success: true });
      }

      case "approve_jobs": {
        const jobIds: string[] = Array.isArray(body.jobIds) ? body.jobIds.filter(Boolean) : [];
        const payPeriod = body.payPeriod ? monday(String(body.payPeriod)) : null;
        let q = admin.from("payroll_jobs").update({ payment_status: "approved", updated_at: new Date().toISOString() }).eq("payment_status", "pending");
        if (jobIds.length > 0) q = q.in("id", jobIds);
        else if (payPeriod) q = q.eq("pay_period", payPeriod);
        else return json({ error: "Provide jobIds or payPeriod" }, 400);
        const { data: updated, error } = await q.select("id");
        if (error) throw error;
        const ids = (updated || []).map((r: { id: string }) => r.id);
        if (ids.length > 0) {
          await admin.from("payroll_job_cleaners").update({ payment_status: "approved" }).in("job_id", ids).eq("payment_status", "pending");
        }
        return json({ success: true, approved: ids.length });
      }

      // ─── Weekly run builder ────────────────────────────────────────────
      case "build_runs": {
        const period = monday(String(body.payPeriod || new Date().toISOString()));
        const periodEnd = sunday(period);

        // Approved jobs in the period → their per-cleaner lines.
        const { data: jobs } = await admin
          .from("payroll_jobs")
          .select("id")
          .eq("pay_period", period)
          .eq("payment_status", "approved");
        const jobIds = (jobs || []).map((j: { id: string }) => j.id);
        if (jobIds.length === 0) return json({ success: true, runs: 0, message: "No approved jobs in this period." });

        const { data: lines } = await admin
          .from("payroll_job_cleaners")
          .select("id, cleaner_id, pay_cents, job_id, supply_reimbursement_cents, mileage_reimbursement_cents")
          .in("job_id", jobIds)
          .eq("payment_status", "approved");

        // Group by cleaner.
        const byCleaner = new Map<string, { ids: string[]; gross: number; jobs: number; reimb: number }>();
        for (const l of lines || []) {
          const g = byCleaner.get(l.cleaner_id) || { ids: [], gross: 0, jobs: 0, reimb: 0 };
          g.ids.push(l.id);
          g.gross += Number(l.pay_cents) || 0;
          g.reimb += (Number(l.supply_reimbursement_cents) || 0) + (Number(l.mileage_reimbursement_cents) || 0);
          g.jobs += 1;
          byCleaner.set(l.cleaner_id, g);
        }
        if (byCleaner.size === 0) return json({ success: true, runs: 0, message: "No approved cleaner lines." });

        const cleanerIds = Array.from(byCleaner.keys());
        const { data: cleaners } = await admin
          .from("cleaners")
          .select("id, payment_method, stripe_account_id, payouts_enabled")
          .in("id", cleanerIds);
        const cleanerMap = new Map((cleaners || []).map((c: Record<string, unknown>) => [String(c.id), c]));

        let runCount = 0;
        for (const [cleanerId, g] of byCleaner) {
          const c = cleanerMap.get(cleanerId) || {};
          const method = String(c.payment_method || "stripe_connect");
          const stripeId = (c.stripe_account_id as string) || null;
          // Block stripe runs with no connected account → hold.
          const needsStripe = method === "stripe_connect";
          const status = needsStripe && !stripeId ? "hold" : "draft";

          // Preserve any existing bonus/deduction on a rebuild.
          const { data: prior } = await admin
            .from("payroll_runs")
            .select("id, bonus_cents, deduction_cents, status, stripe_transfer_id")
            .eq("cleaner_id", cleanerId)
            .eq("pay_period_start", period)
            .maybeSingle();
          // Never touch a run that already went out.
          if (prior && ["sent", "cleared"].includes(String(prior.status))) continue;

          const bonus = Number(prior?.bonus_cents) || 0;
          const deduction = Number(prior?.deduction_cents) || 0;
          const net = g.gross + bonus + g.reimb - deduction;

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
          if (runErr) { log("run upsert failed", runErr); continue; }

          // Link this cleaner's lines to the run.
          await admin.from("payroll_job_cleaners").update({ payroll_run_id: run.id }).in("id", g.ids);
          runCount++;
        }
        return json({ success: true, runs: runCount, period, periodEnd });
      }

      case "update_run": {
        const runId = String(body.runId || "");
        if (!runId) return json({ error: "runId required" }, 400);
        const { data: run } = await admin.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
        if (!run) return json({ error: "Run not found" }, 404);
        if (["sent", "cleared"].includes(String(run.status))) {
          return json({ error: "Run already sent — cannot edit." }, 409);
        }
        const bonus = Math.max(0, Math.round(Number(body.bonusCents ?? run.bonus_cents) || 0));
        const deduction = Math.max(0, Math.round(Number(body.deductionCents ?? run.deduction_cents) || 0));
        const reimb = Number(run.reimbursement_cents) || 0;
        const net = (Number(run.gross_cents) || 0) + bonus + reimb - deduction;
        await admin.from("payroll_runs").update({
          bonus_cents: bonus,
          deduction_cents: deduction,
          net_cents: net,
          notes: body.notes ?? run.notes,
          updated_at: new Date().toISOString(),
        }).eq("id", runId);
        return json({ success: true, netCents: net });
      }

      // ─── Per-job supply + mileage reimbursements ───────────────────────
      // { action: "set_line_reimbursement", jobId, cleanerId,
      //   supplyCents?, mileageMiles?, mileageRateCents?, note? }
      // Updates the cleaner's line on the job and, when the line is attached
      // to a still-editable run, re-rolls the run's reimbursement + net.
      case "set_line_reimbursement": {
        const jobId = String(body.jobId || "");
        const cleanerId = String(body.cleanerId || "");
        if (!jobId || !cleanerId) return json({ error: "jobId and cleanerId required" }, 400);

        const { data: line } = await admin
          .from("payroll_job_cleaners")
          .select("id, payroll_run_id, payment_status, supply_reimbursement_cents, mileage_miles, mileage_rate_cents, reimbursement_note")
          .eq("job_id", jobId)
          .eq("cleaner_id", cleanerId)
          .maybeSingle();
        if (!line) return json({ error: "No payroll line for that job + cleaner." }, 404);
        if (String(line.payment_status) === "paid") {
          return json({ error: "This line was already paid — reimbursements can't be edited. Add a bonus on a future run instead." }, 409);
        }

        const supplyCents = Math.max(0, Math.round(Number(body.supplyCents ?? line.supply_reimbursement_cents) || 0));
        const mileageMiles = Math.max(0, Number(body.mileageMiles ?? line.mileage_miles) || 0);
        const mileageRateCents = Math.max(0, Math.round(Number(body.mileageRateCents ?? line.mileage_rate_cents) || 70));
        const mileageCents = Math.round(mileageMiles * mileageRateCents);
        const note = body.note !== undefined ? (String(body.note || "").slice(0, 500) || null) : line.reimbursement_note;

        await admin.from("payroll_job_cleaners").update({
          supply_reimbursement_cents: supplyCents,
          mileage_miles: mileageMiles,
          mileage_rate_cents: mileageRateCents,
          mileage_reimbursement_cents: mileageCents,
          reimbursement_note: note,
        }).eq("id", line.id);

        // Re-roll the linked run (if editable).
        let runNetCents: number | null = null;
        if (line.payroll_run_id) {
          const { data: run } = await admin
            .from("payroll_runs")
            .select("id, status, gross_cents, bonus_cents, deduction_cents")
            .eq("id", line.payroll_run_id)
            .maybeSingle();
          if (run && !["processing", "sent", "paid", "cleared"].includes(String(run.status))) {
            const { data: runLines } = await admin
              .from("payroll_job_cleaners")
              .select("supply_reimbursement_cents, mileage_reimbursement_cents")
              .eq("payroll_run_id", run.id);
            const reimbTotal = (runLines || []).reduce(
              (a: number, l: Record<string, unknown>) =>
                a + (Number(l.supply_reimbursement_cents) || 0) + (Number(l.mileage_reimbursement_cents) || 0),
              0,
            );
            runNetCents = (Number(run.gross_cents) || 0) + (Number(run.bonus_cents) || 0) + reimbTotal - (Number(run.deduction_cents) || 0);
            await admin.from("payroll_runs").update({
              reimbursement_cents: reimbTotal,
              net_cents: runNetCents,
              updated_at: new Date().toISOString(),
            }).eq("id", run.id);
          }
        }

        await admin.from("payroll_job_audit").insert({
          job_id: jobId,
          action: "set_reimbursement",
          detail: `cleaner ${cleanerId.slice(0, 8)}: supplies $${(supplyCents / 100).toFixed(2)}, ${mileageMiles} mi @ $${(mileageRateCents / 100).toFixed(2)}/mi = $${(mileageCents / 100).toFixed(2)}${note ? ` — ${note}` : ""}`,
          actor,
        }).then(() => undefined, () => undefined);

        return json({
          success: true,
          supplyCents,
          mileageMiles,
          mileageRateCents,
          mileageCents,
          totalReimbursementCents: supplyCents + mileageCents,
          runNetCents,
        });
      }

      case "approve_run": {
        const runId = String(body.runId || "");
        const { data: run } = await admin.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
        if (!run) return json({ error: "Run not found" }, 404);
        if (run.payment_method === "stripe_connect" && !run.stripe_connect_id) {
          await admin.from("payroll_runs").update({ status: "hold", updated_at: new Date().toISOString() }).eq("id", runId);
          return json({ error: "Cleaner has no Stripe Connect account — run set to hold.", status: "hold" }, 409);
        }
        await admin.from("payroll_runs").update({ status: "approved", approved_by: actor, updated_at: new Date().toISOString() }).eq("id", runId);
        await audit(admin, { run_id: runId, action: "approve_run", actor });
        return json({ success: true });
      }

      // ─── Payout ────────────────────────────────────────────────────────
      case "send_payout": {
        const runId = String(body.runId || "");
        const res = await sendOneRun(admin, runId, actor);
        return json(res, res.ok ? 200 : 400);
      }

      case "send_all": {
        const period = monday(String(body.payPeriod || new Date().toISOString()));
        const { data: runs } = await admin
          .from("payroll_runs")
          .select("id")
          .eq("pay_period_start", period)
          .eq("status", "approved");
        const results: Record<string, unknown>[] = [];
        for (const r of runs || []) {
          // Each run independent — one failure must not block the rest.
          const res = await sendOneRun(admin, r.id, actor);
          results.push({ runId: r.id, ...res });
        }
        return json({
          success: true,
          total: results.length,
          sent: results.filter((r) => r.ok).length,
          failed: results.filter((r) => !r.ok).length,
          results,
        });
      }

      // ─── Override / unlock ─────────────────────────────────────────────
      case "unlock_job": {
        const jobId = String(body.jobId || "");
        if (!jobId) return json({ error: "jobId required" }, 400);
        await admin.from("payroll_jobs").update({
          locked: false,
          payment_status: "approved",
          updated_at: new Date().toISOString(),
        }).eq("id", jobId);
        await admin.from("payroll_job_cleaners").update({
          payment_status: "approved",
          payroll_run_id: null,
        }).eq("job_id", jobId);
        await audit(admin, { job_id: jobId, action: "unlock_job", detail: body.reason || null, actor });
        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ error: msg }, 500);
  }
});

// ─── Send one run (Stripe transfer or manual), idempotent ──────────────────
async function sendOneRun(
  admin: DB,
  runId: string,
  actor: string,
): Promise<{ ok: boolean; status?: string; transferId?: string; error?: string; skipped?: boolean }> {
  const { data: run } = await admin.from("payroll_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return { ok: false, error: "Run not found" };

  // Idempotency: never fire a second transfer for the same run.
  if (run.stripe_transfer_id) {
    return { ok: true, skipped: true, status: run.status, transferId: run.stripe_transfer_id };
  }
  if (["sent", "cleared"].includes(String(run.status))) {
    return { ok: true, skipped: true, status: run.status };
  }
  if (run.status !== "approved") {
    return { ok: false, error: `Run must be approved before sending (status: ${run.status}).` };
  }

  const netCents = Number(run.net_cents) || 0;
  const markPaid = async (extra: Record<string, unknown>) => {
    await admin.from("payroll_runs").update({ ...extra, sent_by: actor, updated_at: new Date().toISOString() }).eq("id", runId);
    // Lock + mark this run's jobs/lines paid.
    const { data: lines } = await admin.from("payroll_job_cleaners").select("job_id").eq("payroll_run_id", runId);
    const jobIds = Array.from(new Set((lines || []).map((l: { job_id: string }) => l.job_id)));
    await admin.from("payroll_job_cleaners").update({ payment_status: "paid" }).eq("payroll_run_id", runId);
    if (jobIds.length > 0) {
      await admin.from("payroll_jobs").update({ payment_status: "paid", locked: true, updated_at: new Date().toISOString() }).in("id", jobIds);
    }
  };

  // Manual methods (ACH / Zelle / cash): tracked only, no Stripe call.
  const method = String(run.payment_method || "stripe_connect");
  if (method !== "stripe_connect") {
    await markPaid({ status: "sent", sent_at: new Date().toISOString() });
    await audit(admin, { run_id: runId, action: "send_payout_manual", detail: method, actor });
    return { ok: true, status: "sent" };
  }

  if (!run.stripe_connect_id) {
    await admin.from("payroll_runs").update({ status: "hold", updated_at: new Date().toISOString() }).eq("id", runId);
    return { ok: false, error: "No Stripe Connect account — set to hold." };
  }
  if (netCents <= 0) {
    await markPaid({ status: "sent", sent_at: new Date().toISOString() });
    return { ok: true, status: "sent" };
  }

  try {
    const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
    if (!stripeKey) return { ok: false, error: "STRIPE_SECRET_KEY missing" };
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const transfer = await stripe.transfers.create(
      {
        amount: netCents,
        currency: "usd",
        destination: run.stripe_connect_id,
        description: `Novara payroll run ${runId.slice(0, 8)} — ${run.pay_period_start}`,
        metadata: { payroll_run_id: runId, cleaner_id: run.cleaner_id, pay_period: run.pay_period_start },
      },
      // Stripe-level idempotency keyed on the run so a double-click never
      // produces two transfers even if our row check raced.
      { idempotencyKey: `payroll_run_${runId}` },
    );
    await markPaid({ status: "sent", sent_at: new Date().toISOString(), stripe_transfer_id: transfer.id });
    await audit(admin, { run_id: runId, action: "send_payout_stripe", detail: transfer.id, actor });
    return { ok: true, status: "sent", transferId: transfer.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("payroll_runs").update({ status: "failed", failure_reason: msg, updated_at: new Date().toISOString() }).eq("id", runId);
    return { ok: false, status: "failed", error: msg };
  }
}
