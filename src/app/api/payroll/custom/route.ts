// ─── POST /api/payroll/custom — Simplified custom payouts ───────────────────
//
// One endpoint backing the simplified Payroll module:
//   • action "jobs"     → candidate jobs (real bookings) + revenue + cleaner +
//                         any existing custom payout, for the payout form.
//   • action "summary"  → roster (per-cleaner payout for week/month/year),
//                         org-wide totals + profit, and recent payouts.
//   • action "submit"   → record a custom payout for a job, compute profit + %
//                         paid out, notify the contractor (email + SMS that
//                         their payout is pending), and sync to Airtable.
//   • action "mark_paid"→ flip a pending payout to paid (re-syncs Airtable).
//
// Admin/VA gated server-side via requireAdmin. All money is integer cents.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
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

// deno/node — fire an edge function with the service-role key. Best-effort.
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
        return NextResponse.json(await submitPayout(supabase, body, principal.userId));
      case "mark_paid":
        return NextResponse.json(await markPaid(supabase, body));
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

  const cleanerMap = new Map<string, { name: string; email: string | null; phone: string | null; pct: number }>();
  if (cleanerIds.length) {
    const { data: cs } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, pay_percentage")
      .in("id", cleanerIds);
    for (const c of cs || []) {
      cleanerMap.set(String(c.id), {
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
        email: c.email,
        phone: c.phone,
        pct: Number(c.pay_percentage) || 35,
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
      };
    });

    return {
      bookingId: b.id,
      bookingNumber: b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : null,
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

// ─── submit: record a custom payout + notify + airtable ────────────────────
interface CrewPayInput {
  cleanerId: string;
  amountCents: number;
}

async function submitPayout(
  supabase: ReturnType<typeof getAdminSupabase>,
  body: Record<string, unknown>,
  userId: string,
) {
  const bookingId = String(body.bookingId || "");
  const note = body.note ? String(body.note) : null;
  if (!bookingId) return { error: "bookingId required" };

  // Accept either the new per-cleaner array (`cleaners`) or the legacy single
  // (`cleanerId` + `amountCents`).
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

  // Resolve cleaner contact info for the whole crew.
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
    ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
    : "your recent job";

  // Upsert the single per-booking payout row (carrying the crew breakdown).
  const { data: existing } = await supabase
    .from("manual_payouts")
    .select("id")
    .eq("booking_id", bookingId)
    .neq("status", "cancelled")
    .maybeSingle();

  const primary = breakdown.find((b) => b.cleanerId === booking.cleaner_id) || breakdown[0];
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
    created_by: userId,
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

  // Mirror the primary cleaner's pay onto the booking for the other views.
  await supabase
    .from("bookings")
    .update({ cleaner_payout_cents: primary?.amountCents ?? totalCents })
    .eq("id", bookingId)
    .then(() => undefined, () => undefined);

  // ─── Notify each cleaner: their payout is pending ────────────────────────
  let emailSent = 0;
  let smsSent = 0;
  for (const b of breakdown) {
    const dollars = (b.amountCents / 100).toFixed(2);
    const firstName = b.cleanerName.split(" ")[0] || "there";
    const cleanerPct = pct(b.amountCents, revenueCents);
    if (b.cleanerEmail) {
      const ok = await notify(supabase, "send-cleaner-email", {
        type: "payout_pending",
        email: b.cleanerEmail,
        data: { cleanerFirstName: firstName, bookingId, bookingLabel, serviceDate, amount: b.amountCents, pctPaid: cleanerPct },
      });
      if (ok) emailSent++;
    }
    if (b.cleanerPhone) {
      const msg = `Novara: Your payout of $${dollars} for ${bookingLabel} is pending and on its way. Thanks for the great work! Reply STOP to opt out.`;
      const ok = await notify(supabase, "send-ghl-sms", {
        phone: b.cleanerPhone,
        email: b.cleanerEmail || undefined,
        firstName,
        message: msg,
        type: "cleaner_payout_pending",
      });
      if (ok) smsSent++;
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

  // ─── Sync to Airtable (Jobs table, locked to the total + crew size) ──────
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
    summary: `Custom payout $${(totalCents / 100).toFixed(2)} (${pctPaid}% of revenue) across ${breakdown.length} cleaner(s) — ${bookingLabel}`,
    data: { payoutId, totalCents, revenueCents, profitCents, pctPaid, crew: breakdown.length, emailSent, smsSent, airtableSynced },
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

// ─── mark_paid: flip a pending payout to paid ──────────────────────────────
async function markPaid(supabase: ReturnType<typeof getAdminSupabase>, body: Record<string, unknown>) {
  const id = String(body.id || "");
  if (!id) return { error: "id required" };
  const { data: row, error } = await supabase
    .from("manual_payouts")
    .update({ status: "paid", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, booking_id, amount_cents, cleaner_breakdown")
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
