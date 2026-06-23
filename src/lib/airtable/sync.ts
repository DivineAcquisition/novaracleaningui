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
  groupPayoutsIntoRuns,
  type CleanerRow,
} from "./sources/supabase";
import { syncClient, syncJob, syncPayrollRun } from "./mappers";
import { ENTRY_SOURCE } from "./schema";

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
 * Build + upsert all weekly payroll runs from the payouts table. Aggregates
 * per cleaner + pay period (Mon–Sun).
 */
export async function syncAllPayrollRuns(limit = 1000): Promise<number> {
  const supabase = getAdminSupabase();
  const { data: payouts } = await supabase
    .from("payouts")
    .select("id, cleaner_id, booking_id, cleaner_payout_cents, status, stripe_transfer_id, processed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = payouts || [];
  if (!rows.length) return 0;

  // Attach each payout's service date (for pay-period bucketing) + cleaner name.
  const bookingIds = Array.from(new Set(rows.map((p) => p.booking_id).filter(Boolean))) as string[];
  const cleanerIds = Array.from(new Set(rows.map((p) => p.cleaner_id).filter(Boolean))) as string[];

  const serviceDateByBooking: Record<string, string> = {};
  if (bookingIds.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, service_date")
      .in("id", bookingIds);
    for (const b of bookings || []) serviceDateByBooking[b.id] = b.service_date || "";
  }

  const cleanerNameById: Record<string, string> = {};
  if (cleanerIds.length) {
    const { data: cleaners } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name")
      .in("id", cleanerIds);
    for (const c of cleaners || []) {
      cleanerNameById[c.id] = `${c.first_name || ""} ${c.last_name || ""}`.trim();
    }
  }

  const enriched = rows.map((p) => ({
    ...p,
    service_date: p.booking_id ? serviceDateByBooking[p.booking_id] : null,
  }));

  const runs = groupPayoutsIntoRuns(enriched, cleanerNameById);
  let ok = 0;
  for (const run of runs) {
    try {
      await syncPayrollRun(run);
      ok++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[airtable] payroll run ${run.runId} failed:`, (err as Error).message);
    }
  }
  return ok;
}

export const DEFAULT_LIVE_ENTRY_SOURCE = ENTRY_SOURCE.webhook;
