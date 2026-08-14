// ─── POST /api/payroll/custom — Simplified custom payouts ───────────────────
//
// One endpoint backing the simplified Payroll module:
//   • action "jobs"            → candidate jobs (real bookings) + revenue + crew
//   • action "summary"         → roster + totals + recent custom payouts
//   • action "submit"          → record a custom payout, notify the cleaner
//                                (email + SMS), sync Airtable. No Stripe transfer.
//   • action "mark_paid"       → flip pending → paid (bookkeeping + Airtable)
//   • action "run_preview"     → pending Extra Pay for Run Payroll (Stripe)
//   • action "execute_pending" → Stripe Connect transfers for Extra Pay
//
// Custom Payout Stripe transfers are paused on purpose. Re-enable later by
// calling executeLines on submit / includeCustom on collectPendingLines.
//
// Admin/VA gated server-side via requireAdmin. All money is integer cents.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError, type AdminPrincipal } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncManualPayoutJob } from "@/lib/airtable/manual-payout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSIGNMENT_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"];

function pct(amountCents: number, revenueCents: number): number {
  if (!revenueCents || revenueCents <= 0) return 0;
  return Math.round((amountCents / revenueCents) * 10000) / 100;
}

function startOfWeek(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = c.getDay(); // 0=Sun
  c.setDate(c.getDate() + (dow === 0 ? -6 : 1 - dow)); // Monday
  return c;
}

async function notify(
  supabase: ReturnType<typeof getAdminSupabase>,
  fn: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke(fn, { body });
    return !error;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  try {
    switch (action) {
      case "jobs":
        return NextResponse.json(await listJobs(supabase, body));
      case "summary":
        return NextResponse.json(await buildSummary(supabase));
      case "submit":
        return NextResponse.json(await submitPayout(supabase, body, principal));
      case "mark_paid":
        return NextResponse.json(await markPaid(supabase, body));
      case "run_preview":
        return NextResponse.json(await runPreview(supabase));
      case "execute_pending":
        return NextResponse.json(await executePending(supabase, body, principal));
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[payroll/custom]", action, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── jobs: candidate jobs for the payout form ──────────────────────────────
async function listJobs(
  supabase: ReturnType<typeof getAdminSupabase>,
  body: Record<string, unknown>,
) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - Number(body.days || 120));
  const fromYmd = from.toISOString().slice(0, 10);

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_type, service_date, completed_at, first_name, last_name, email, total_estimate_cents, final_charge_cents, cleaner_payout_cents, cleaner_id, job_id, num_cleaners_assigned",
    )
    .in("status", ["completed", "pending_review", "confirmed", "in_progress"])
    .gte("service_date", fromYmd)
    .order("service_date", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = bookings || [];
  const cleanerIds = Array.from(
    new Set(rows.map((b) => b.cleaner_id).filter(Boolean)),
  ) as string[];
  const jobIds = rows.map((b) => b.job_id).filter(Boolean) as string[];
  const bookingIds = rows.map((b) => b.id);

  // Assigned cleaners via dispatch jobs (covers multi-cleaner crews).
  const assignsByJob = new Map<string, string[]>();
  if (jobIds.length) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("job_id, cleaner_id, status")
      .in("job_id", jobIds)
      .in("status", ASSIGNMENT_STATUSES);
    for (const a of assigns || []) {
      if (!a.cleaner_id) continue;
      const list = assignsByJob.get(String(a.job_id)) || [];
      list.push(String(a.cleaner_id));
      assignsByJob.set(String(a.job_id), list);
      if (!cleanerIds.includes(String(a.cleaner_id))) cleanerIds.push(String(a.cleaner_id));
    }
  }

  const cleanerMap = new Map<string, {
    name: string;
    email: string | null;
    phone: string | null;
    pct: number;
    stripeAccountId: string | null;
    payoutsEnabled: boolean;
  }>();
  if (cleanerIds.length) {
    const { data: cs } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, pay_percentage, stripe_account_id, payouts_enabled")
      .in("id", cleanerIds);
    for (const c of cs || []) {
      cleanerMap.set(String(c.id), {
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
        email: c.email,
        phone: c.phone,
        pct: Number(c.pay_percentage) || 35,
        stripeAccountId: (c.stripe_account_id as string) || null,
        payoutsEnabled: !!c.payouts_enabled,
      });
    }
  }

  // Existing custom payouts for these bookings (with per-cleaner breakdown).
  const payoutByBooking = new Map<
    string,
    { amount_cents: number; status: string; pct_paid: number; cleaner_breakdown: Array<{ cleanerId: string; amountCents: number }> }
  >();
  if (bookingIds.length) {
    const { data: mps } = await supabase
      .from("manual_payouts")
      .select("booking_id, amount_cents, status, pct_paid, cleaner_breakdown")
      .in("booking_id", bookingIds)
      .neq("status", "cancelled");
    for (const m of mps || []) {
      if (m.booking_id) payoutByBooking.set(String(m.booking_id), m as never);
    }
  }

  const jobs = rows.map((b) => {
    const revenueCents = Number(b.final_charge_cents || b.total_estimate_cents || 0);
    const jid = b.job_id ? String(b.job_id) : null;
    // The actual crew on the job: dispatch assignments if present, else the
    // booking's primary cleaner. De-duped, primary cleaner listed first.
    const crewIds = Array.from(
      new Set([
        ...(b.cleaner_id ? [String(b.cleaner_id)] : []),
        ...((jid && assignsByJob.get(jid)) || []),
      ]),
    );
    const existing = payoutByBooking.get(String(b.id)) || null;
    const existingByCleaner = new Map<string, number>();
    for (const e of existing?.cleaner_breakdown || []) {
      if (e?.cleanerId) existingByCleaner.set(String(e.cleanerId), Number(e.amountCents) || 0);
    }

    const crew = crewIds.map((id) => {
      const c = cleanerMap.get(id);
      const pct = c?.pct || 35;
      // Default per-cleaner pay = revenue-share split evenly across the crew.
      const evenShare = crewIds.length > 0
        ? Math.round((revenueCents * pct) / 100 / crewIds.length)
        : Math.round((revenueCents * pct) / 100);
      return {
        id,
        name: c?.name || "Cleaner",
        hasContact: !!(c?.email || c?.phone),
        suggestedPayoutCents: existingByCleaner.get(id) ?? evenShare,
        alreadyPaid: existingByCleaner.has(id),
        stripeAccountId: c?.stripeAccountId || null,
        payoutsEnabled: !!c?.payoutsEnabled,
      };
    });

    return {
      bookingId: b.id,
      bookingNumber: b.booking_number ? `NVC-${String(b.booking_number).padStart(4, "0")}` : null,
      status: b.status,
      serviceType: b.service_type,
      serviceDate: b.service_date,
      completedAt: b.completed_at,
      customer: `${b.first_name || ""} ${b.last_name || ""}`.trim(),
      revenueCents,
      cleanerCount: crew.length,
      crew,
      existingPayout: existing
        ? { amountCents: existing.amount_cents, status: existing.status, pctPaid: existing.pct_paid }
        : null,
    };
  });

  return { ok: true, jobs };
}

// ─── summary: roster + totals + profit + recent ────────────────────────────
async function buildSummary(supabase: ReturnType<typeof getAdminSupabase>) {
  const { data: payouts, error } = await supabase
    .from("manual_payouts")
    .select(
      "id, booking_id, cleaner_id, cleaner_name, cleaner_breakdown, service_date, revenue_cents, amount_cents, profit_cents, pct_paid, status, note, created_at, paid_at",
    )
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const now = new Date();
  const weekStart = startOfWeek(now).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

  const totals = { week: 0, month: 0, year: 0, all: 0 };
  const revenueTotals = { week: 0, month: 0, year: 0, all: 0 };
  const profitTotals = { week: 0, month: 0, year: 0, all: 0 };
  const pendingCount = { count: 0, cents: 0 };

  const roster = new Map<
    string,
    { cleanerId: string | null; cleanerName: string; week: number; month: number; year: number; all: number; jobs: number }
  >();

  for (const p of payouts || []) {
    const t = new Date(p.created_at as string).getTime();
    const amt = Number(p.amount_cents) || 0;
    const rev = Number(p.revenue_cents) || 0;
    const prof = Number(p.profit_cents) || 0;
    const inWeek = t >= weekStart;
    const inMonth = t >= monthStart;
    const inYear = t >= yearStart;

    totals.all += amt;
    revenueTotals.all += rev;
    profitTotals.all += prof;
    if (inYear) { totals.year += amt; revenueTotals.year += rev; profitTotals.year += prof; }
    if (inMonth) { totals.month += amt; revenueTotals.month += rev; profitTotals.month += prof; }
    if (inWeek) { totals.week += amt; revenueTotals.week += rev; profitTotals.week += prof; }
    if (p.status === "pending") { pendingCount.count += 1; pendingCount.cents += amt; }

    // Roster is PER CLEANER: spread each payout across its crew breakdown so a
    // multi-cleaner job credits each cleaner their own share. Falls back to the
    // single cleaner_id/name (legacy rows or single-cleaner jobs).
    const breakdown = Array.isArray(p.cleaner_breakdown) && p.cleaner_breakdown.length > 0
      ? (p.cleaner_breakdown as Array<{ cleanerId: string; cleanerName: string; amountCents: number }>)
      : [{ cleanerId: (p.cleaner_id as string) || "", cleanerName: (p.cleaner_name as string) || "Unassigned", amountCents: amt }];
    for (const member of breakdown) {
      const memberAmt = Number(member.amountCents) || 0;
      const key = String(member.cleanerId || member.cleanerName || "unassigned");
      const r = roster.get(key) || {
        cleanerId: member.cleanerId || null,
        cleanerName: member.cleanerName || "Unassigned",
        week: 0, month: 0, year: 0, all: 0, jobs: 0,
      };
      r.all += memberAmt;
      r.jobs += 1;
      if (inYear) r.year += memberAmt;
      if (inMonth) r.month += memberAmt;
      if (inWeek) r.week += memberAmt;
      roster.set(key, r);
    }
  }

  const recent = (payouts || []).slice(0, 40).map((p) => ({
    id: p.id,
    bookingId: p.booking_id,
    cleanerName: p.cleaner_name,
    serviceDate: p.service_date,
    revenueCents: p.revenue_cents,
    amountCents: p.amount_cents,
    profitCents: p.profit_cents,
    pctPaid: p.pct_paid,
    status: p.status,
    note: p.note,
    createdAt: p.created_at,
    paidAt: p.paid_at,
  }));

  return {
    ok: true,
    totals,
    revenueTotals,
    profitTotals,
    pending: pendingCount,
    roster: Array.from(roster.values()).sort((a, b) => b.year - a.year),
    recent,
  };
}

// ─── Stripe Connect transfer helper ─────────────────────────────────────────
type SB = ReturnType<typeof getAdminSupabase>;

interface TransferResult {
  ok: boolean;
  transferId?: string;
  amountCents?: number;
  cleanerName?: string;
  emailSent?: boolean;
  error?: string;
  availableUsd?: number;
  pendingUsd?: number;
}

async function invokePayCleanerTransfer(
  supabase: SB,
  body: Record<string, unknown>,
): Promise<TransferResult> {
  const { data, error } = await supabase.functions.invoke("pay-cleaner-transfer", { body });
  const d = (data || {}) as Record<string, unknown>;
  if (d.success === true || d.ok === true) {
    return {
      ok: true,
      transferId: d.transferId ? String(d.transferId) : undefined,
      amountCents: d.amountCents != null ? Number(d.amountCents) : undefined,
      cleanerName: d.cleanerName ? String(d.cleanerName) : undefined,
      emailSent: !!d.emailSent,
      availableUsd: d.availableUsd != null ? Number(d.availableUsd) : undefined,
      pendingUsd: d.pendingUsd != null ? Number(d.pendingUsd) : undefined,
    };
  }
  const msg = String(d.error || error?.message || "Stripe transfer failed");
  return {
    ok: false,
    error: msg,
    availableUsd: d.availableUsd != null ? Number(d.availableUsd) : undefined,
    pendingUsd: d.pendingUsd != null ? Number(d.pendingUsd) : undefined,
  };
}

interface TransferIdEntry {
  cleanerId: string;
  amountCents: number;
  transferId?: string;
  status: "paid" | "failed";
  error?: string;
}

function asTransferIds(raw: unknown): TransferIdEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const r = x as Record<string, unknown>;
    const status: TransferIdEntry["status"] = r.status === "paid" || !!r.transferId ? "paid" : "failed";
    return {
      cleanerId: String(r.cleanerId || ""),
      amountCents: Math.round(Number(r.amountCents) || 0),
      transferId: r.transferId ? String(r.transferId) : undefined,
      status,
      error: r.error ? String(r.error) : undefined,
    };
  }).filter((x) => x.cleanerId);
}

function paidCleanerIds(entries: TransferIdEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.status === "paid" && e.transferId).map((e) => e.cleanerId));
}

interface PendingLine {
  kind: "custom" | "extra";
  id: string;
  cleanerId: string;
  cleanerName: string;
  amountCents: number;
  bookingId: string | null;
  bookingLabel: string;
  serviceDate: string | null;
  note: string | null;
  extraLabel?: string;
}

function bookingRef(n: unknown): string | null {
  if (n == null || n === "") return null;
  return `NVC-${String(n).padStart(4, "0")}`;
}

async function collectPendingLines(
  supabase: SB,
  filter: {
    cleanerId?: string | null;
    payoutId?: string | null;
    extraPayId?: string | null;
    /** Stripe for Custom Payout is paused; pass true to re-enable. */
    includeCustom?: boolean;
  } = {},
): Promise<PendingLine[]> {
  const lines: PendingLine[] = [];
  const onlyExtra = !!filter.extraPayId && !filter.payoutId;
  const onlyCustom = !!filter.payoutId && !filter.extraPayId;

  if (!onlyExtra && filter.includeCustom) {

  let pq = supabase
    .from("manual_payouts")
    .select("id, booking_id, cleaner_id, cleaner_name, cleaner_breakdown, amount_cents, service_date, transfer_ids, note, status")
    .eq("status", "pending");
  if (filter.payoutId) pq = pq.eq("id", filter.payoutId);
  const { data: payouts, error: pErr } = await pq;
  if (pErr) throw pErr;

  const bookingIds = Array.from(new Set((payouts || []).map((p) => p.booking_id).filter(Boolean))) as string[];
  const bookingNum = new Map<string, string>();
  if (bookingIds.length) {
    const { data: bks } = await supabase.from("bookings").select("id, booking_number").in("id", bookingIds);
    for (const b of bks || []) {
      const ref = bookingRef(b.booking_number);
      if (ref) bookingNum.set(String(b.id), ref);
    }
  }

  for (const p of payouts || []) {
    const already = paidCleanerIds(asTransferIds(p.transfer_ids));
    const breakdown = Array.isArray(p.cleaner_breakdown) && p.cleaner_breakdown.length > 0
      ? (p.cleaner_breakdown as Array<{ cleanerId?: string; cleanerName?: string; amountCents?: number }>)
      : [{ cleanerId: String(p.cleaner_id || ""), cleanerName: String(p.cleaner_name || "Cleaner"), amountCents: Number(p.amount_cents) || 0 }];
    const label = (p.booking_id && bookingNum.get(String(p.booking_id))) || "Custom payout";
    for (const b of breakdown) {
      const cid = String(b.cleanerId || "");
      const amt = Math.round(Number(b.amountCents) || 0);
      if (!cid || amt <= 0) continue;
      if (already.has(cid)) continue;
      if (filter.cleanerId && cid !== filter.cleanerId) continue;
      lines.push({
        kind: "custom",
        id: String(p.id),
        cleanerId: cid,
        cleanerName: String(b.cleanerName || p.cleaner_name || "Cleaner"),
        amountCents: amt,
        bookingId: p.booking_id ? String(p.booking_id) : null,
        bookingLabel: label,
        serviceDate: (p.service_date as string) || null,
        note: (p.note as string) || null,
      });
    }
  }
  }

  if (!onlyCustom) {
  let eq = supabase
    .from("job_extra_pay")
    .select("id, booking_id, cleaner_id, total_cents, note, status, stripe_transfer_id, supply_cents, mileage_cents, surge_cents, overtime_cents, job_value_cents")
    .in("status", ["pending", "failed"]);
  if (filter.extraPayId) eq = eq.eq("id", filter.extraPayId);
  if (filter.cleanerId) eq = eq.eq("cleaner_id", filter.cleanerId);
  const { data: extras, error: eErr } = await eq;
  if (eErr) throw eErr;

  const extraBookingIds = Array.from(new Set((extras || []).map((r) => r.booking_id).filter(Boolean))) as string[];
  const extraCleanerIds = Array.from(new Set((extras || []).map((r) => r.cleaner_id).filter(Boolean))) as string[];
  const extraBk = new Map<string, { ref: string | null; date: string | null }>();
  const extraNames = new Map<string, string>();
  if (extraBookingIds.length) {
    const { data: bks } = await supabase
      .from("bookings")
      .select("id, booking_number, service_date")
      .in("id", extraBookingIds);
    for (const b of bks || []) {
      extraBk.set(String(b.id), { ref: bookingRef(b.booking_number), date: (b.service_date as string) || null });
    }
  }
  if (extraCleanerIds.length) {
    const { data: cs } = await supabase.from("cleaners").select("id, first_name, last_name").in("id", extraCleanerIds);
    for (const c of cs || []) {
      extraNames.set(String(c.id), `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner");
    }
  }

  for (const r of extras || []) {
    if (r.stripe_transfer_id) continue;
    const amt = Math.round(Number(r.total_cents) || 0);
    if (amt <= 0) continue;
    const cid = String(r.cleaner_id);
    if (filter.cleanerId && cid !== filter.cleanerId) continue;
    const parts = [
      Number(r.supply_cents) ? "supplies" : "",
      Number(r.mileage_cents) ? "mileage" : "",
      Number(r.surge_cents) ? "surge" : "",
      Number(r.overtime_cents) ? "overtime" : "",
      Number(r.job_value_cents) ? "job value" : "",
    ].filter(Boolean);
    const bk = r.booking_id ? extraBk.get(String(r.booking_id)) : null;
    lines.push({
      kind: "extra",
      id: String(r.id),
      cleanerId: cid,
      cleanerName: extraNames.get(cid) || "Cleaner",
      amountCents: amt,
      bookingId: r.booking_id ? String(r.booking_id) : null,
      bookingLabel: bk?.ref || "Extra pay",
      serviceDate: bk?.date || null,
      note: (r.note as string) || null,
      extraLabel: parts.join(", ") || "Extra pay",
    });
  }
  }

  return lines;
}

async function applyTransferToLedger(supabase: SB, line: PendingLine, result: TransferResult) {
  if (line.kind === "custom") {
    const { data: row } = await supabase
      .from("manual_payouts")
      .select("id, transfer_ids, cleaner_breakdown, booking_id, amount_cents")
      .eq("id", line.id)
      .maybeSingle();
    if (!row) return;
    const entries = asTransferIds(row.transfer_ids);
    const next: TransferIdEntry = {
      cleanerId: line.cleanerId,
      amountCents: line.amountCents,
      transferId: result.transferId,
      status: result.ok && result.transferId ? "paid" : "failed",
      error: result.ok ? undefined : result.error,
    };
    const idx = entries.findIndex((e) => e.cleanerId === line.cleanerId);
    if (idx >= 0) entries[idx] = next;
    else entries.push(next);

    const breakdown = Array.isArray(row.cleaner_breakdown) ? row.cleaner_breakdown as Array<{ cleanerId?: string; amountCents?: number }> : [];
    const owedIds = breakdown
      .filter((b) => String(b.cleanerId || "") && Math.round(Number(b.amountCents) || 0) > 0)
      .map((b) => String(b.cleanerId));
    const paid = paidCleanerIds(entries);
    const allPaid = owedIds.length > 0 && owedIds.every((id) => paid.has(id));

    await supabase.from("manual_payouts").update({
      transfer_ids: entries,
      status: allPaid ? "paid" : "pending",
      paid_at: allPaid ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      email_sent_at: result.emailSent ? new Date().toISOString() : undefined,
    }).eq("id", line.id);

    if (allPaid && row.booking_id) {
      try {
        await syncManualPayoutJob(String(row.booking_id), Number(row.amount_cents) || 0, "paid", owedIds.length);
      } catch { /* non-blocking */ }
    }
    return;
  }

  if (result.ok && result.transferId) {
    await supabase.from("job_extra_pay").update({
      status: "paid",
      stripe_transfer_id: result.transferId,
      paid_at: new Date().toISOString(),
      failure_reason: null,
    }).eq("id", line.id);
  } else {
    await supabase.from("job_extra_pay").update({
      status: "failed",
      failure_reason: result.error || "Stripe transfer failed",
    }).eq("id", line.id);
  }
}

async function executeLines(
  supabase: SB,
  lines: PendingLine[],
  principal: AdminPrincipal,
): Promise<{ ok: boolean; halted?: boolean; error?: string; availableUsd?: number; neededCents?: number; results: Array<PendingLine & TransferResult> }> {
  const neededCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const bal = await invokePayCleanerTransfer(supabase, { action: "balance" });
  if (!bal.ok) {
    return { ok: false, halted: true, error: bal.error || "Could not verify Stripe balance. No transfers were sent.", results: [] };
  }
  const availableUsd = Number(bal.availableUsd) || 0;
  if (neededCents > 0 && availableUsd < neededCents) {
    return {
      ok: false,
      halted: true,
      error: `Insufficient Stripe balance: $${(availableUsd / 100).toFixed(2)} available, $${(neededCents / 100).toFixed(2)} needed. No transfers were sent.`,
      availableUsd,
      neededCents,
      results: [],
    };
  }

  const results: Array<PendingLine & TransferResult> = [];
  for (const line of lines) {
    const res = await invokePayCleanerTransfer(supabase, {
      cleanerId: line.cleanerId,
      amountCents: line.amountCents,
      bookingId: line.bookingId,
      label: `Novara ${line.kind === "extra" ? "extra pay" : "payout"} — ${line.bookingLabel} — ${line.cleanerName}`,
      bookingLabel: line.bookingLabel,
      source: line.kind === "extra" ? "extra_pay" : "custom_payout",
      sourceLabel: line.kind === "extra" ? `Extra Pay${line.extraLabel ? ` (${line.extraLabel})` : ""}` : "Custom Payout",
      idempotencyKey: `${line.kind}_${line.id}_${line.cleanerId}_${line.amountCents}`,
      notifyAdminEmail: principal.email,
    });
    await applyTransferToLedger(supabase, line, res);
    results.push({ ...line, ...res });
  }
  return { ok: results.every((r) => r.ok), availableUsd, neededCents, results };
}

// ─── submit: record a custom payout, notify cleaner, no Stripe ─────────────
interface CrewPayInput {
  cleanerId: string;
  amountCents: number;
}

async function submitPayout(
  supabase: SB,
  body: Record<string, unknown>,
  principal: AdminPrincipal,
) {
  const bookingId = String(body.bookingId || "");
  const note = body.note ? String(body.note) : null;
  if (!bookingId) return { error: "bookingId required" };

  let crewInput: CrewPayInput[] = [];
  if (Array.isArray(body.cleaners)) {
    crewInput = (body.cleaners as Array<Record<string, unknown>>)
      .map((c) => ({ cleanerId: String(c.cleanerId || ""), amountCents: Math.round(Number(c.amountCents)) }))
      .filter((c) => c.cleanerId && Number.isFinite(c.amountCents) && c.amountCents >= 0);
  } else if (body.cleanerId != null) {
    const amt = Math.round(Number(body.amountCents));
    if (String(body.cleanerId) && Number.isFinite(amt) && amt >= 0) {
      crewInput = [{ cleanerId: String(body.cleanerId), amountCents: amt }];
    }
  }
  if (crewInput.length === 0) return { error: "Select at least one cleaner with a payout amount" };

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_date, completed_at, first_name, last_name, total_estimate_cents, final_charge_cents, cleaner_id, job_id, num_cleaners_assigned",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found" };

  const revenueCents = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);
  const serviceDate = (booking.service_date as string) || (booking.completed_at as string)?.slice(0, 10) || null;

  const ids = crewInput.map((c) => c.cleanerId);
  const { data: cleanersData } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, email, phone")
    .in("id", ids);
  const cleanerById = new Map<string, { name: string; email: string | null; phone: string | null }>();
  for (const c of cleanersData || []) {
    cleanerById.set(String(c.id), {
      name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
      email: c.email,
      phone: c.phone,
    });
  }

  const breakdown = crewInput.map((c) => {
    const info = cleanerById.get(c.cleanerId);
    return {
      cleanerId: c.cleanerId,
      cleanerName: info?.name || "Cleaner",
      cleanerEmail: info?.email || null,
      cleanerPhone: info?.phone || null,
      amountCents: c.amountCents,
    };
  });

  const totalCents = breakdown.reduce((s, b) => s + b.amountCents, 0);
  const profitCents = revenueCents - totalCents;
  const pctPaid = pct(totalCents, revenueCents);
  const bookingLabel = booking.booking_number
    ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
    : "your recent job";

  const { data: existing } = await supabase
    .from("manual_payouts")
    .select("id, status, transfer_ids")
    .eq("booking_id", bookingId)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existing?.status === "paid") {
    return { error: "This job is already marked paid. Use Extra Pay for an additional amount." };
  }

  const primary = breakdown.find((b) => b.cleanerId === booking.cleaner_id) || breakdown[0];
  const existingTransfers = asTransferIds(existing?.transfer_ids);
  const rowFields = {
    booking_id: bookingId,
    cleaner_id: breakdown.length === 1 ? breakdown[0].cleanerId : null,
    cleaner_name: breakdown.map((b) => b.cleanerName).join(", "),
    cleaner_email: breakdown.length === 1 ? breakdown[0].cleanerEmail : null,
    cleaner_phone: breakdown.length === 1 ? breakdown[0].cleanerPhone : null,
    cleaner_breakdown: breakdown.map((b) => ({ cleanerId: b.cleanerId, cleanerName: b.cleanerName, amountCents: b.amountCents })),
    service_date: serviceDate,
    revenue_cents: revenueCents,
    amount_cents: totalCents,
    profit_cents: profitCents,
    pct_paid: pctPaid,
    status: "pending" as const,
    note,
    transfer_ids: existingTransfers,
    created_by: principal.userId,
    updated_at: new Date().toISOString(),
  };

  let payoutId: string;
  if (existing?.id) {
    const { data: upd, error: updErr } = await supabase
      .from("manual_payouts").update(rowFields).eq("id", existing.id).select("id").single();
    if (updErr) throw updErr;
    payoutId = upd.id;
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("manual_payouts").insert(rowFields).select("id").single();
    if (insErr) throw insErr;
    payoutId = ins.id;
  }

  await supabase
    .from("bookings")
    .update({ cleaner_payout_cents: primary?.amountCents ?? totalCents })
    .eq("id", bookingId)
    .then(() => undefined, () => undefined);

  let emailSent = 0;
  let smsSent = 0;
  for (const member of breakdown) {
    if (member.amountCents <= 0) continue;
    const dollars = (member.amountCents / 100).toFixed(2);
    const firstName = member.cleanerName.split(" ")[0] || "there";
    const memberPct = pct(member.amountCents, revenueCents);
    if (member.cleanerEmail) {
      const ok = await notify(supabase, "send-cleaner-email", {
        type: "payout_pending",
        email: member.cleanerEmail,
        data: {
          cleanerFirstName: firstName,
          bookingId,
          bookingLabel,
          serviceDate,
          amount: member.amountCents,
          pctPaid: memberPct,
        },
      });
      if (ok) emailSent += 1;
    }
    if (member.cleanerPhone) {
      const msg = `Novara: Your payout of $${dollars} for ${bookingLabel} is pending and on its way. Thanks for the great work! Reply STOP to opt out.`;
      const ok = await notify(supabase, "send-ghl-sms", {
        phone: member.cleanerPhone,
        email: member.cleanerEmail || undefined,
        firstName,
        message: msg,
        type: "cleaner_payout_pending",
      });
      if (ok) smsSent += 1;
    }
  }

  await supabase
    .from("manual_payouts")
    .update({
      email_sent_at: emailSent > 0 ? new Date().toISOString() : null,
      sms_sent_at: smsSent > 0 ? new Date().toISOString() : null,
    })
    .eq("id", payoutId)
    .then(() => undefined, () => undefined);

  let airtableSynced = false;
  try {
    const recId = await syncManualPayoutJob(bookingId, totalCents, "pending", breakdown.length);
    airtableSynced = !!recId;
    if (airtableSynced) {
      await supabase
        .from("manual_payouts").update({ airtable_synced_at: new Date().toISOString() }).eq("id", payoutId)
        .then(() => undefined, () => undefined);
    }
  } catch (atErr) {
    // eslint-disable-next-line no-console
    console.warn("[payroll/custom] airtable sync failed (non-blocking)", (atErr as Error).message);
  }

  await supabase.from("events").insert({
    event_type: "payroll.custom_payout",
    booking_id: bookingId,
    source: "payroll-custom",
    summary: `Custom payout $${(totalCents / 100).toFixed(2)} logged for ${breakdown.length} cleaner(s) — ${bookingLabel}`,
    data: {
      payoutId, totalCents, revenueCents, profitCents, pctPaid,
      crew: breakdown.length, emailSent, smsSent, airtableSynced,
    },
  }).then(() => undefined, () => undefined);

  return {
    ok: true,
    payout: {
      id: payoutId,
      amountCents: totalCents,
      revenueCents,
      profitCents,
      pctPaid,
      cleanerCount: breakdown.length,
      status: "pending",
      emailSent,
      smsSent,
      airtableSynced,
    },
  };
}

async function markPaid(supabase: SB, body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) return { error: "id required" };
  const { data: row, error } = await supabase
    .from("manual_payouts")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, booking_id, amount_cents, cleaner_breakdown, cleaner_id, cleaner_phone, cleaner_name")
    .single();
  if (error) throw error;

  if (row.booking_id) {
    try {
      const crewCount = Array.isArray(row.cleaner_breakdown) ? row.cleaner_breakdown.length : undefined;
      await syncManualPayoutJob(String(row.booking_id), Number(row.amount_cents) || 0, "paid", crewCount);
    } catch {
      /* non-blocking */
    }
  }
  return { ok: true };
}

async function runPreview(supabase: SB) {
  const [lines, bal, { data: cleaners }] = await Promise.all([
    collectPendingLines(supabase),
    invokePayCleanerTransfer(supabase, { action: "balance" }),
    supabase.from("cleaners").select("id, first_name, last_name, stripe_account_id, payouts_enabled, email"),
  ]);

  const cleanerMeta = new Map<string, { name: string; stripeAccountId: string | null; payoutsEnabled: boolean }>();
  for (const c of cleaners || []) {
    cleanerMeta.set(String(c.id), {
      name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
      stripeAccountId: (c.stripe_account_id as string) || null,
      payoutsEnabled: !!c.payouts_enabled,
    });
  }

  const byCleaner = new Map<string, {
    cleanerId: string;
    cleanerName: string;
    stripeAccountId: string | null;
    payoutsEnabled: boolean;
    connectReady: boolean;
    customCents: number;
    extraCents: number;
    totalCents: number;
    items: PendingLine[];
  }>();

  for (const line of lines) {
    const meta = cleanerMeta.get(line.cleanerId);
    const row = byCleaner.get(line.cleanerId) || {
      cleanerId: line.cleanerId,
      cleanerName: meta?.name || line.cleanerName,
      stripeAccountId: meta?.stripeAccountId || null,
      payoutsEnabled: !!meta?.payoutsEnabled,
      connectReady: !!(meta?.stripeAccountId && meta?.payoutsEnabled),
      customCents: 0,
      extraCents: 0,
      totalCents: 0,
      items: [],
    };
    row.items.push(line);
    row.totalCents += line.amountCents;
    if (line.kind === "extra") row.extraCents += line.amountCents;
    else row.customCents += line.amountCents;
    byCleaner.set(line.cleanerId, row);
  }

  const roster = Array.from(byCleaner.values()).sort((a, b) => b.totalCents - a.totalCents);
  return {
    ok: true,
    balance: {
      availableUsd: Number(bal.availableUsd) || 0,
      pendingUsd: Number((bal as TransferResult & { pendingUsd?: number }).pendingUsd) || 0,
      error: bal.error || null,
    },
    totals: {
      customCents: roster.reduce((s, r) => s + r.customCents, 0),
      extraCents: roster.reduce((s, r) => s + r.extraCents, 0),
      owedCents: roster.reduce((s, r) => s + r.totalCents, 0),
      cleaners: roster.length,
    },
    cleaners: roster,
  };
}

async function executePending(
  supabase: SB,
  body: Record<string, unknown>,
  principal: AdminPrincipal,
) {
  const lines = await collectPendingLines(supabase, {
    cleanerId: body.cleanerId ? String(body.cleanerId) : null,
    payoutId: body.payoutId ? String(body.payoutId) : null,
    extraPayId: body.extraPayId ? String(body.extraPayId) : null,
  });
  if (lines.length === 0) return { ok: true, paidCount: 0, failedCount: 0, results: [] };
  const exec = await executeLines(supabase, lines, principal);
  const paidCount = exec.results.filter((r) => r.ok).length;
  return {
    ok: exec.ok && !exec.halted,
    halted: exec.halted,
    error: exec.error || null,
    availableUsd: exec.availableUsd,
    neededCents: exec.neededCents,
    paidCount,
    failedCount: exec.results.length - paidCount,
    results: exec.results.map((r) => ({
      kind: r.kind,
      id: r.id,
      cleanerId: r.cleanerId,
      cleanerName: r.cleanerName,
      amountCents: r.amountCents,
      bookingLabel: r.bookingLabel,
      ok: r.ok,
      transferId: r.transferId,
      error: r.error,
    })),
  };
}
