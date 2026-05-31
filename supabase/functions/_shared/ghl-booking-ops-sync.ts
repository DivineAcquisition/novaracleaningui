// ─── GHL booking ops sync (contractor slots + team size + duration) ───────
//
// Lightweight PIT patch used after manual assign, cleaner accept, and dispatch.
// Full booking sync still runs via send-zapier-webhook; this keeps the six
// ops fields in sync even when only assignments change.

import {
  ghlIsConfigured,
  upsertContact,
  updateOpportunity,
  GHL_OPS_CLEARABLE_KEYS,
} from "./ghl-client.ts";
import {
  buildGhlOpsCustomFields,
  loadTeamCleanersForBooking,
  type BookingLikeForTeam,
} from "./ghl-booking-team.ts";

const log = (s: string, d?: unknown) =>
  console.log(`[ghl-booking-ops] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

export async function syncBookingOpsFieldsToGhl(
  supabase: any,
  bookingId: string,
): Promise<{ ok: boolean; contactId?: string; error?: string }> {
  if (!ghlIsConfigured()) {
    return { ok: false, error: "GHL not configured" };
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(`
      id, email, phone, first_name, last_name, address, city, state, zip_code,
      job_id, cleaner_id, home_size_id, estimated_duration_hours, num_cleaners_assigned,
      total_estimate_cents, final_charge_cents, deposit_cents, payment_option,
      ghl_contact_id, ghl_opportunity_id,
      cleaners:cleaner_id (first_name, last_name, phone, pay_tier, pay_percentage)
    `)
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !booking) {
    return { ok: false, error: error?.message || "booking not found" };
  }

  const teamCleaners = await loadTeamCleanersForBooking(supabase, booking as BookingLikeForTeam);
  const opsFields = buildGhlOpsCustomFields(booking as BookingLikeForTeam, teamCleaners);

  let contactId = (booking as any).ghl_contact_id as string | null;
  if (!contactId && booking.email) {
    contactId = await upsertContact({
      email: booking.email,
      phone: booking.phone,
      firstName: booking.first_name,
      lastName: booking.last_name,
      address1: booking.address,
      city: booking.city,
      state: booking.state,
      postalCode: booking.zip_code,
      source: "Novara Booking",
      customFieldsByKey: opsFields,
    });
  } else if (contactId) {
    await upsertContact({
      email: booking.email,
      phone: booking.phone,
      firstName: booking.first_name,
      lastName: booking.last_name,
      customFieldsByKey: opsFields,
    });
  }

  if (!contactId) {
    return { ok: false, error: "could not resolve GHL contact" };
  }

  const oppId = (booking as any).ghl_opportunity_id as string | null;
  if (oppId) {
    await updateOpportunity(oppId, { customFieldsByKey: opsFields });
  }

  try {
    const patch: Record<string, string> = { ghl_contact_id: contactId };
    if (oppId) patch.ghl_opportunity_id = oppId;
    await supabase.from("bookings").update(patch).eq("id", bookingId);
  } catch (e) {
    log("stamp ghl ids failed", e instanceof Error ? e.message : String(e));
  }

  log("synced ops fields", { bookingId, contactId, cleaners: teamCleaners.length });
  return { ok: true, contactId };
}

/** Invoke full booking webhook sync (all 60+ fields). */
export async function invokeFullBookingGhlSync(
  supabase: any,
  bookingId: string,
): Promise<void> {
  try {
    await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId } });
  } catch (e) {
    log("full sync invoke failed", e instanceof Error ? e.message : String(e));
  }
}
