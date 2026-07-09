// ─── Manual payout → Airtable Jobs sync ────────────────────────────────────
//
// The simplified Payroll module records custom payouts in Supabase
// (public.manual_payouts). To keep the Airtable "Client & Revenue Ops" base in
// sync we push the underlying job into the Jobs table with the EXACT custom
// payout the admin typed (locking payPerCleaner / pool to that figure) plus the
// payout's payment status. We reuse the proven syncJob mapper so the Job→Client
// link still resolves.

import { getAdminSupabase } from "./sources/admin-client";
import { bookingToClientInput, mapServiceType, nyDate, type CleanerRow } from "./sources/supabase";
import { syncClientById } from "./sync";
import { syncClient, syncJob } from "./mappers";
import { ENTRY_SOURCE, PAYMENT_STATUS } from "./schema";

const ASSIGNMENT_STATUSES = ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"];

/**
 * Upsert the Airtable Job for a booking, locking the cleaner pay to the custom
 * payout amount (cents) and reflecting the payout's status.
 */
export async function syncManualPayoutJob(
  bookingId: string,
  amountCents: number,
  status: "pending" | "paid" | "cancelled",
  cleanerCountOverride?: number,
): Promise<string | null> {
  const supabase = getAdminSupabase();
  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "id, booking_number, status, service_type, service_date, completed_at, email, first_name, last_name, phone, city, state, zip_code, final_charge_cents, total_estimate_cents, cleaner_payout_cents, num_cleaners_assigned, booking_channel, membership_plan, job_id, customer_id, cleaner_id",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  // Make sure the linked client exists first so the Job→Client link resolves.
  let clientSynced = false;
  if (booking.customer_id && /^[0-9a-f-]{36}$/i.test(String(booking.customer_id))) {
    clientSynced = (await syncClientById(booking.customer_id).catch(() => null)) != null;
  }
  if (!clientSynced) {
    const clientInput = bookingToClientInput(booking);
    if (clientInput) await syncClient(clientInput).catch(() => null);
  }

  // Resolve the assigned cleaners (names + tier %) for the Job row.
  let cleaners: CleanerRow[] = [];
  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", booking.job_id)
      .in("status", ASSIGNMENT_STATUSES);
    const ids = Array.from(
      new Set((assigns || []).map((a: { cleaner_id: string | null }) => a.cleaner_id).filter(Boolean)),
    ) as string[];
    if (ids.length) {
      const { data: cs } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, pay_tier, pay_percentage")
        .in("id", ids);
      cleaners = (cs || []) as CleanerRow[];
    }
  }
  if (cleaners.length === 0 && booking.cleaner_id) {
    const { data: c } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, pay_tier, pay_percentage")
      .eq("id", booking.cleaner_id)
      .maybeSingle();
    if (c) cleaners = [c as CleanerRow];
  }

  const customerPaidCents = booking.final_charge_cents ?? booking.total_estimate_cents ?? 0;
  const numberOfCleaners = Math.max(
    1,
    cleanerCountOverride ?? booking.num_cleaners_assigned ?? (cleaners.length || 1),
  );
  const cleanerName = cleaners
    .map((c) => `${c.first_name || ""} ${c.last_name || ""}`.trim())
    .filter(Boolean)
    .join(", ");
  const dateCompleted = nyDate(booking.completed_at) || nyDate(booking.service_date);
  const paymentStatus =
    status === "paid"
      ? PAYMENT_STATUS.paid
      : status === "cancelled"
        ? PAYMENT_STATUS.failed
        : PAYMENT_STATUS.pending;

  return syncJob({
    jobId: booking.id,
    dateCompleted,
    serviceType: mapServiceType(booking.service_type, booking.membership_plan),
    customerPaidCents,
    cleanerName: cleanerName || undefined,
    numberOfCleaners,
    // Lock the Airtable pay to the exact custom amount the admin typed.
    cleanerPayPoolCents: amountCents,
    payPerCleanerCents: Math.round(amountCents / numberOfCleaners),
    paymentStatus,
    entrySource: ENTRY_SOURCE.admin,
    clientEmail: booking.email || undefined,
  });
}
