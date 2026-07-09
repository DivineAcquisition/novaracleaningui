// ─── Sync orchestration: Supabase source → mappers → Airtable ─────────────────
//
// Fetches the full source record(s) with the service-role client, builds the
// normalized mapper input via the source adapters, and upserts into Airtable.
// Used by the webhook route (live triggers) and the backfill script.

import { getAdminSupabase } from "./sources/admin-client";
import {
  bookingToClientInput,
  bookingToJobInput,
  customerToClientInput,
  type CleanerRow,
} from "./sources/supabase";
import { syncClient, syncJob, syncPayrollRun } from "./mappers";
import { ENTRY_SOURCE, JOB_FIELDS, PAYROLL_RUN_FIELDS, TABLES } from "./schema";
import { deleteRecords, listRecords } from "./client";
import { payPeriodMonday, payPeriodSunday } from "./pay";

const ASSIGNMENT_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"];

const AGREEMENT_TYPE_BY_AUDIENCE: Record<string, string> = {
  one_time: "One-Time",
  membership: "Recurring",
  str_host: "STR Partnership",
};

/**
 * Hunt down the client's remaining data points so every Airtable column that
 * CAN be filled IS filled: lifecycle from real booking history, agreement date
 * + type from DocuSeal, payment method from Stripe.
 */
async function clientEnrichment(email: string, customer?: {
  membership_status?: string | null;
  membership_plan?: string | null;
}): Promise<Partial<import("./mappers/types").ClientInput>> {
  const supabase = getAdminSupabase();
  const extra: Partial<import("./mappers/types").ClientInput> = {};

  // Lifecycle from actual booking history.
  try {
    const { data: bks } = await supabase
      .from("bookings")
      .select("status")
      .eq("email", email)
      .limit(100);
    const statuses = (bks || []).map((b) => String(b.status || "").toLowerCase());
    const isMember =
      String(customer?.membership_status || "") === "active" ||
      (customer?.membership_plan && customer.membership_plan !== "none");
    extra.lifecycleStage = isMember
      ? "Member"
      : statuses.includes("completed")
        ? "Active"
        : statuses.length > 0
          ? "Quoted"
          : "Lead";
  } catch {
    /* best-effort */
  }

  // Signed agreement (date + type) from DocuSeal.
  try {
    const { data: subs } = await supabase
      .from("docuseal_submissions")
      .select("audience, status, created_at")
      .ilike("submitter_email", email)
      .in("audience", ["one_time", "membership", "str_host"])
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1);
    const sub = (subs || [])[0];
    if (sub) {
      extra.agreementSignedDate = String(sub.created_at || "").slice(0, 10) || undefined;
      extra.agreementType = AGREEMENT_TYPE_BY_AUDIENCE[String(sub.audience)] || undefined;
    }
  } catch {
    /* best-effort */
  }

  return extra;
}

/** Upsert a client by Supabase customer id. */
export async function syncClientById(customerId: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const extra = await clientEnrichment(data.email, data);
  return syncClient(customerToClientInput(data, extra));
}

/** Upsert a client by email (used when only the email is known). */
export async function syncClientByEmail(email: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from("customers").select("*").eq("email", email).maybeSingle();
  if (!data) return null;
  const extra = await clientEnrichment(email, data);
  return syncClient(customerToClientInput(data, extra));
}

/** Resolve the cleaners assigned to a booking via its dispatch job. */
async function cleanersForBooking(jobId: string | null | undefined): Promise<CleanerRow[]> {
  if (!jobId) return [];
  const supabase = getAdminSupabase();
  const { data: assigns } = await supabase
    .from("job_assignments")
    .select("cleaner_id, status")
    .eq("job_id", jobId)
    .in("status", ASSIGNMENT_STATUSES);
  const ids = Array.from(
    new Set((assigns || []).map((a: { cleaner_id: string | null }) => a.cleaner_id).filter(Boolean)),
  ) as string[];
  if (!ids.length) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, pay_tier, pay_percentage")
    .in("id", ids);
  return (cleaners || []) as CleanerRow[];
}

/**
 * Upsert a job from a booking id. Ensures the client exists first so the
 * Job→Client link resolves on the first pass.
 */
export async function syncJobByBookingId(
  bookingId: string,
  opts?: { entrySource?: string },
): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_type, service_date, completed_at, email, first_name, last_name, phone, city, state, zip_code, final_charge_cents, total_estimate_cents, cleaner_payout_cents, num_cleaners_assigned, booking_channel, membership_plan, job_id, customer_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return null;

  // Make sure the linked client exists so the Job→Client link resolves on the
  // first pass. Prefer the full customer record; fall back to the booking's own
  // contact fields when there's no matching customer row (guest/imported).
  let clientSynced = false;
  if (booking.customer_id) {
    clientSynced = (await syncClientById(booking.customer_id).catch(() => null)) != null;
  }
  if (!clientSynced) {
    const clientInput = bookingToClientInput(booking);
    if (clientInput) await syncClient(clientInput).catch(() => null);
  }

  const cleaners = await cleanersForBooking(booking.job_id);

  // ── Authoritative pay from the REAL ledgers (custom payout + extra pay) ──
  // The tier-% estimate is only a fallback; when money was actually recorded
  // for this job, Airtable must show exactly that.
  const [{ data: payout }, { data: extras }] = await Promise.all([
    supabase
      .from("manual_payouts")
      .select("amount_cents, status, cleaner_breakdown, cleaner_name")
      .eq("booking_id", bookingId)
      .neq("status", "cancelled")
      .maybeSingle(),
    supabase
      .from("job_extra_pay")
      .select("total_cents, status")
      .eq("booking_id", bookingId)
      .neq("status", "failed"),
  ]);

  const extraCents = (extras || []).reduce((s, e) => s + (Number(e.total_cents) || 0), 0);
  const breakdown = Array.isArray(payout?.cleaner_breakdown) ? payout?.cleaner_breakdown : [];
  const crewCount = Math.max(cleaners.length, breakdown.length, Number(booking.num_cleaners_assigned) || 0, 0);

  let poolCents: number | undefined;
  let perCleanerCents: number | undefined;
  let paymentStatus: string | undefined;
  if (payout) {
    poolCents = (Number(payout.amount_cents) || 0) + extraCents;
    perCleanerCents = Math.round(poolCents / Math.max(1, crewCount));
    const extrasAllPaid = (extras || []).every((e) => String(e.status) === "paid");
    paymentStatus = String(payout.status) === "paid" && extrasAllPaid ? "Paid" : "Pending";
  } else if (extraCents > 0) {
    poolCents = extraCents;
    perCleanerCents = Math.round(extraCents / Math.max(1, crewCount));
    paymentStatus = (extras || []).every((e) => String(e.status) === "paid") ? "Paid" : "Pending";
  } else {
    // No money recorded yet — the job hasn't been paid regardless of booking status.
    paymentStatus = String(booking.status || "").toLowerCase() === "cancelled" ? "Failed" : "Pending";
  }

  const input = bookingToJobInput(booking, cleaners, {
    entrySource: opts?.entrySource,
    cleanerPayPoolCents: poolCents,
    payPerCleanerCents: perCleanerCents,
    paymentStatus,
    numberOfCleaners: crewCount || undefined,
  });
  if (!input.cleanerName && payout?.cleaner_name) input.cleanerName = String(payout.cleaner_name);
  return syncJob(input);
}

/**
 * Build + upsert all weekly payroll runs (Mon–Sun per cleaner) from the two
 * REAL pay ledgers only:
 *   • manual_payouts  → Custom Payout amounts   (Gross Pay)
 *   • job_extra_pay   → Extra Pay (supplies / mileage / surge / OT / job value) (Bonus)
 * Every field is filled (cleaner, period, jobs, gross, bonus, deduction, net,
 * method, status, transfer id) and the run is linked to its Jobs rows. Stale
 * runs (from older sources) are purged so the table mirrors these two ledgers
 * exactly.
 */
export async function syncAllPayrollRuns(limit = 1000): Promise<number> {
  const supabase = getAdminSupabase();

  interface RunAcc {
    cleanerId: string;
    monday: string;
    grossCents: number;
    bonusCents: number;
    bookingIds: Set<string>;
    components: number;
    paidComponents: number;
    customCount: number;
    extraCount: number;
    lastPaidAt?: string;
    transferId?: string;
  }
  const runs = new Map<string, RunAcc>();
  const cleanerIds = new Set<string>();
  const needServiceDate = new Set<string>();

  const acc = (cleanerId: string, monday: string): RunAcc => {
    const key = `${cleanerId}_${monday}`;
    let r = runs.get(key);
    if (!r) {
      r = { cleanerId, monday, grossCents: 0, bonusCents: 0, bookingIds: new Set(), components: 0, paidComponents: 0, customCount: 0, extraCount: 0 };
      runs.set(key, r);
    }
    return r;
  };

  // ── Source 1: custom payouts (per booking, with per-cleaner breakdown) ──
  const { data: payouts } = await supabase
    .from("manual_payouts")
    .select("id, booking_id, cleaner_id, cleaner_name, cleaner_breakdown, service_date, amount_cents, status, created_at, paid_at")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  // ── Source 2: extra pay (per booking + cleaner) ──
  const { data: extras } = await supabase
    .from("job_extra_pay")
    .select("id, booking_id, cleaner_id, total_cents, status, stripe_transfer_id, created_at, paid_at")
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(limit);

  // Resolve booking service dates for extra-pay bucketing.
  for (const e of extras || []) if (e.booking_id) needServiceDate.add(String(e.booking_id));
  const serviceDateByBooking: Record<string, string> = {};
  if (needServiceDate.size) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, service_date")
      .in("id", Array.from(needServiceDate));
    for (const b of bookings || []) serviceDateByBooking[b.id] = b.service_date || "";
  }

  for (const p of payouts || []) {
    const date = (p.service_date || p.created_at || "").slice(0, 10);
    if (!date) continue;
    const monday = payPeriodMonday(date);
    const breakdown = Array.isArray(p.cleaner_breakdown) && p.cleaner_breakdown.length
      ? (p.cleaner_breakdown as { cleanerId?: string; amountCents?: number }[])
      : p.cleaner_id
        ? [{ cleanerId: String(p.cleaner_id), amountCents: Number(p.amount_cents) || 0 }]
        : [];
    for (const b of breakdown) {
      const cid = String(b.cleanerId || "");
      if (!cid) continue;
      cleanerIds.add(cid);
      const r = acc(cid, monday);
      r.grossCents += Number(b.amountCents) || 0;
      if (p.booking_id) r.bookingIds.add(String(p.booking_id));
      r.components += 1;
      r.customCount += 1;
      if (String(p.status) === "paid") {
        r.paidComponents += 1;
        const paidDate = String(p.paid_at || "").slice(0, 10);
        if (paidDate && (!r.lastPaidAt || paidDate > r.lastPaidAt)) r.lastPaidAt = paidDate;
      }
    }
  }

  for (const e of extras || []) {
    const cid = String(e.cleaner_id || "");
    if (!cid) continue;
    const date = ((e.booking_id && serviceDateByBooking[String(e.booking_id)]) || e.paid_at || e.created_at || "").slice(0, 10);
    if (!date) continue;
    cleanerIds.add(cid);
    const r = acc(cid, payPeriodMonday(date));
    r.bonusCents += Number(e.total_cents) || 0;
    if (e.booking_id) r.bookingIds.add(String(e.booking_id));
    r.components += 1;
    r.extraCount += 1;
    if (String(e.status) === "paid") {
      r.paidComponents += 1;
      const paidDate = String(e.paid_at || "").slice(0, 10);
      if (paidDate && (!r.lastPaidAt || paidDate > r.lastPaidAt)) r.lastPaidAt = paidDate;
    }
    if (e.stripe_transfer_id && !r.transferId) r.transferId = String(e.stripe_transfer_id);
  }

  // Cleaner display names.
  const cleanerNameById: Record<string, string> = {};
  if (cleanerIds.size) {
    const { data: cleaners } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name")
      .in("id", Array.from(cleanerIds));
    for (const c of cleaners || []) {
      cleanerNameById[c.id] = `${c.first_name || ""} ${c.last_name || ""}`.trim();
    }
  }

  // Map booking ids → Airtable Job record ids so runs link to their Jobs.
  const jobRecordIdByBookingId: Record<string, string> = {};
  try {
    const jobRecords = await listRecords(TABLES.jobs);
    for (const j of jobRecords) {
      const jobId = String(j.fields[JOB_FIELDS.jobId] || "");
      if (jobId) jobRecordIdByBookingId[jobId] = j.id;
    }
  } catch {
    /* links are best-effort */
  }

  // Upsert every run with all fields filled.
  const keepRunIds = new Set<string>();
  let ok = 0;
  for (const r of runs.values()) {
    const runId = `${r.cleanerId}_${r.monday}`;
    keepRunIds.add(runId);
    const gross = Math.round(r.grossCents) / 100;
    const bonus = Math.round(r.bonusCents) / 100;
    const jobRecordIds = Array.from(r.bookingIds)
      .map((bid) => jobRecordIdByBookingId[bid])
      .filter(Boolean) as string[];
    const allPaid = r.components > 0 && r.paidComponents === r.components;
    const noteParts: string[] = [];
    if (r.customCount > 0) noteParts.push(`Custom payouts ×${r.customCount}: $${gross.toFixed(2)}`);
    if (r.extraCount > 0) noteParts.push(`Extra pay ×${r.extraCount} (supplies/mileage/surge/OT/job value): $${bonus.toFixed(2)}`);
    try {
      await syncPayrollRun({
        runId,
        cleanerName: cleanerNameById[r.cleanerId] || "Cleaner",
        periodStart: r.monday,
        periodEnd: payPeriodSunday(r.monday),
        totalJobs: r.bookingIds.size || r.components,
        grossPay: gross,
        bonus,
        deduction: 0,
        netPay: gross + bonus,
        paymentMethod: "Manual",
        status: allPaid ? "Paid" : "Pending",
        sentAt: allPaid ? r.lastPaidAt : undefined,
        stripeTransferId: r.transferId,
        notes: noteParts.join(" · ") || undefined,
        jobRecordIds,
      });
      ok++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[airtable] payroll run ${runId} failed:`, (err as Error).message);
    }
  }

  // Purge stale runs (built from retired sources) so the table mirrors the
  // custom-pay + extra-pay ledgers exactly.
  try {
    const existing = await listRecords(TABLES.payrollRuns);
    const stale = existing
      .filter((rec) => !keepRunIds.has(String(rec.fields[PAYROLL_RUN_FIELDS.runId] || "")))
      .map((rec) => rec.id);
    if (stale.length) await deleteRecords(TABLES.payrollRuns, stale);
  } catch {
    /* purge is best-effort */
  }

  return ok;
}

export const DEFAULT_LIVE_ENTRY_SOURCE = ENTRY_SOURCE.webhook;
