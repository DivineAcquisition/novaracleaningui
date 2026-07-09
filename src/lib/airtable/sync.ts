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

/** Upsert a client by Supabase customer id. */
export async function syncClientById(customerId: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase.from("customers").select("*").eq("id", customerId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return syncClient(customerToClientInput(data));
}

/** Upsert a client by email (used when only the email is known). */
export async function syncClientByEmail(email: string): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from("customers").select("*").eq("email", email).maybeSingle();
  if (!data) return null;
  return syncClient(customerToClientInput(data));
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
  const input = bookingToJobInput(booking, cleaners, { entrySource: opts?.entrySource });
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
    transferId?: string;
  }
  const runs = new Map<string, RunAcc>();
  const cleanerIds = new Set<string>();
  const needServiceDate = new Set<string>();

  const acc = (cleanerId: string, monday: string): RunAcc => {
    const key = `${cleanerId}_${monday}`;
    let r = runs.get(key);
    if (!r) {
      r = { cleanerId, monday, grossCents: 0, bonusCents: 0, bookingIds: new Set(), components: 0, paidComponents: 0 };
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
      if (String(p.status) === "paid") r.paidComponents += 1;
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
    if (String(e.status) === "paid") r.paidComponents += 1;
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
        status: r.components > 0 && r.paidComponents === r.components ? "Paid" : "Pending",
        stripeTransferId: r.transferId,
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
