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

  // Existing custom payouts for these bookings.
  const payoutByBooking = new Map<string, { amount_cents: number; status: string; pct_paid: number }>();
  if (bookingIds.length) {
    const { data: mps } = await supabase
      .from("manual_payouts")
      .select("booking_id, amount_cents, status, pct_paid")
      .in("booking_id", bookingIds)
      .neq("status", "cancelled");
    for (const m of mps || []) {
      if (m.booking_id) payoutByBooking.set(String(m.booking_id), m as never);
    }
  }

  const jobs = rows.map((b) => {
    const revenueCents = Number(b.final_charge_cents || b.total_estimate_cents || 0);
    const jid = b.job_id ? String(b.job_id) : null;
    const crew = (jid && assignsByJob.get(jid)) || (b.cleaner_id ? [String(b.cleaner_id)] : []);
    const primaryId = b.cleaner_id ? String(b.cleaner_id) : crew[0] || null;
    const primary = primaryId ? cleanerMap.get(primaryId) : null;
    const suggestedPct = primary?.pct || 35;
    const existing = payoutByBooking.get(String(b.id)) || null;
    return {
      bookingId: b.id,
      bookingNumber: b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : null,
      status: b.status,
      serviceType: b.service_type,
      serviceDate: b.service_date,
      completedAt: b.completed_at,
      customer: `${b.first_name || ""} ${b.last_name || ""}`.trim(),
      revenueCents,
      cleanerId: primaryId,
      cleanerName: primary?.name || null,
      cleanerCount: crew.length || 1,
      // A sensible default payout to pre-fill the form.
      suggestedPayoutCents: Math.round((revenueCents * suggestedPct) / 100),
      suggestedPct,
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
      "id, booking_id, cleaner_id, cleaner_name, service_date, revenue_cents, amount_cents, profit_cents, pct_paid, status, note, created_at, paid_at",
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

    const key = String(p.cleaner_id || p.cleaner_name || "unassigned");
    const r = roster.get(key) || {
      cleanerId: (p.cleaner_id as string) || null,
      cleanerName: (p.cleaner_name as string) || "Unassigned",
      week: 0, month: 0, year: 0, all: 0, jobs: 0,
    };
    r.all += amt;
    r.jobs += 1;
    if (inYear) r.year += amt;
    if (inMonth) r.month += amt;
    if (inWeek) r.week += amt;
    roster.set(key, r);
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
async function submitPayout(
  supabase: ReturnType<typeof getAdminSupabase>,
  body: Record<string, unknown>,
  userId: string,
) {
  const bookingId = String(body.bookingId || "");
  const amountCents = Math.round(Number(body.amountCents));
  const note = body.note ? String(body.note) : null;
  if (!bookingId) return { error: "bookingId required" };
  if (!Number.isFinite(amountCents) || amountCents < 0) return { error: "amountCents must be a non-negative integer" };

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_date, completed_at, first_name, last_name, total_estimate_cents, final_charge_cents, cleaner_id, job_id, num_cleaners_assigned",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found" };

  const revenueCents = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);
  if (amountCents > revenueCents && revenueCents > 0) {
    // Allow but flag — paying more than revenue is unusual.
  }

  // Resolve the cleaner to pay (explicit override, else the booking's cleaner).
  const cleanerId = body.cleanerId ? String(body.cleanerId) : (booking.cleaner_id as string | null);
  let cleaner: { id: string; name: string; email: string | null; phone: string | null } | null = null;
  if (cleanerId) {
    const { data: c } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, email, phone")
      .eq("id", cleanerId)
      .maybeSingle();
    if (c) {
      cleaner = {
        id: String(c.id),
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
        email: c.email,
        phone: c.phone,
      };
    }
  }

  const profitCents = revenueCents - amountCents;
  const pctPaid = pct(amountCents, revenueCents);
  const serviceDate = (booking.service_date as string) || (booking.completed_at as string)?.slice(0, 10) || null;

  // Upsert: replace any existing active payout for this booking.
  const { data: existing } = await supabase
    .from("manual_payouts")
    .select("id, email_sent_at, sms_sent_at")
    .eq("booking_id", bookingId)
    .neq("status", "cancelled")
    .maybeSingle();

  const rowFields = {
    booking_id: bookingId,
    cleaner_id: cleaner?.id || null,
    cleaner_name: cleaner?.name || null,
    cleaner_email: cleaner?.email || null,
    cleaner_phone: cleaner?.phone || null,
    service_date: serviceDate,
    revenue_cents: revenueCents,
    amount_cents: amountCents,
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
      .from("manual_payouts")
      .update(rowFields)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updErr) throw updErr;
    payoutId = upd.id;
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("manual_payouts")
      .insert(rowFields)
      .select("id")
      .single();
    if (insErr) throw insErr;
    payoutId = ins.id;
  }

  // Mirror the agreed payout onto the booking so other payroll views agree.
  await supabase
    .from("bookings")
    .update({ cleaner_payout_cents: amountCents })
    .eq("id", bookingId)
    .then(() => undefined, () => undefined);

  // ─── Notify the contractor: payout pending for this amount ───────────────
  const dollars = (amountCents / 100).toFixed(2);
  const firstName = cleaner?.name?.split(" ")[0] || "there";
  const bookingLabel = booking.booking_number ? `NOV-${String(booking.booking_number).padStart(5, "0")}` : "your recent job";
  let emailSent = false;
  let smsSent = false;

  if (cleaner?.email) {
    emailSent = await notify(supabase, "send-cleaner-email", {
      type: "payout_pending",
      email: cleaner.email,
      data: {
        cleanerFirstName: firstName,
        bookingId,
        bookingLabel,
        serviceDate,
        amount: amountCents,
        pctPaid,
      },
    });
  }
  if (cleaner?.phone) {
    const msg = `Novara: Your payout of $${dollars} for ${bookingLabel} is pending and on its way. Thanks for the great work! Reply STOP to opt out.`;
    smsSent = await notify(supabase, "send-ghl-sms", {
      phone: cleaner.phone,
      email: cleaner.email || undefined,
      firstName,
      message: msg,
      type: "cleaner_payout_pending",
    });
  }

  await supabase
    .from("manual_payouts")
    .update({
      email_sent_at: emailSent ? new Date().toISOString() : null,
      sms_sent_at: smsSent ? new Date().toISOString() : null,
    })
    .eq("id", payoutId)
    .then(() => undefined, () => undefined);

  // ─── Sync to Airtable (Jobs table, locked to the custom amount) ──────────
  let airtableSynced = false;
  try {
    const recId = await syncManualPayoutJob(bookingId, amountCents, "pending");
    airtableSynced = !!recId;
    if (airtableSynced) {
      await supabase
        .from("manual_payouts")
        .update({ airtable_synced_at: new Date().toISOString() })
        .eq("id", payoutId)
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
    summary: `Custom payout $${dollars} (${pctPaid}% of revenue) logged for ${cleaner?.name || "cleaner"} — ${bookingLabel}`,
    data: { payoutId, amountCents, revenueCents, profitCents, pctPaid, emailSent, smsSent, airtableSynced },
  }).then(() => undefined, () => undefined);

  return {
    ok: true,
    payout: {
      id: payoutId,
      amountCents,
      revenueCents,
      profitCents,
      pctPaid,
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
    .select("id, booking_id, amount_cents")
    .single();
  if (error) throw error;

  if (row.booking_id) {
    try {
      await syncManualPayoutJob(String(row.booking_id), Number(row.amount_cents) || 0, "paid");
    } catch {
      /* non-blocking */
    }
  }
  return { ok: true };
}
