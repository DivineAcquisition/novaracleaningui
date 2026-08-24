// ─── reassign-booking-cleaner ───────────────────────────────────────────────
//
// Contractor portal "hand this clean to someone in my crew" action. A cleaner
// who is currently assigned to a booking can re-assign it to ANOTHER cleaner in
// the SAME crew — no ops involvement required. We verify:
//   • the booking is currently assigned to `fromCleanerId` (the caller), and
//   • `toCleanerId` shares a (non-null) crew_id with the caller, and is active.
//
// On success we move bookings.cleaner_id, mirror the change onto any
// job_assignments row, leave a dispatch note, and notify the new cleaner
// (email + SMS). The public portal has no JWT, so `fromCleanerId` is the
// credential the same way the rest of /contractor/* works.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { notifyCleanerOfAssignment } from "../_shared/notify-cleaner-assignment.ts";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { accountCompliance, logComplianceBlock } from "../_shared/commercial-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId: string | undefined = body?.bookingId;
    const fromCleanerId: string | undefined = body?.fromCleanerId;
    const toCleanerId: string | undefined = body?.toCleanerId;

    if (!bookingId || !fromCleanerId || !toCleanerId) {
      return json({ error: "bookingId, fromCleanerId and toCleanerId are required" }, 400);
    }
    if (fromCleanerId === toCleanerId) {
      return json({ error: "Pick a different crew member" }, 400);
    }

    // The booking must currently belong to the caller.
    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("id, booking_number, first_name, last_name, address, city, state, zip_code, service_type, service_date, time_slot, arrival_window, total_estimate_cents, final_charge_cents, num_cleaners_assigned, cleaner_id, status, job_id, business_account_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return json({ error: "Booking not found" }, 404);
    if (booking.cleaner_id !== fromCleanerId) {
      return json({ error: "This job isn't assigned to you anymore." }, 403);
    }

    // Commercial compliance: a hand-off is a reassignment, and reassignment is
    // a dispatch point. If the client's certificate has lapsed since this job
    // was booked, nobody goes — including the crewmate being handed it.
    if (booking.business_account_id) {
      const compliance = await accountCompliance(admin, String(booking.business_account_id));
      if (!compliance.ok) {
        await logComplianceBlock(admin, {
          compliance,
          action: "Crew hand-off",
          bookingId: booking.id,
          detail: { from_cleaner_id: fromCleanerId, to_cleaner_id: toCleanerId },
        });
        return json({
          error:
            "This job is on hold — the client's certificate of insurance isn't current, so it can't be " +
            "handed to anyone right now. The office has been told.",
          code: "account_compliance_blocked",
        }, 409);
      }
    }
    if (["completed", "cancelled"].includes(String(booking.status))) {
      return json({ error: `Can't hand off a ${booking.status} job.` }, 400);
    }

    // Both cleaners must be in the SAME (non-null) crew.
    const { data: from } = await admin
      .from("cleaners").select("id, crew_id, first_name").eq("id", fromCleanerId).maybeSingle();
    const { data: to } = await admin
      .from("cleaners")
      .select("id, crew_id, status, email, phone, first_name, last_name, pay_percentage")
      .eq("id", toCleanerId).maybeSingle();

    if (!from?.crew_id) return json({ error: "You're not in a crew yet — ask the office to add you." }, 400);
    if (!to) return json({ error: "Crew member not found" }, 404);
    if (to.crew_id !== from.crew_id) return json({ error: "That cleaner isn't in your crew." }, 400);
    if (to.status && !["active"].includes(String(to.status))) {
      return json({ error: "That crew member isn't active." }, 400);
    }

    // Move the booking.
    const { error: upErr } = await admin
      .from("bookings")
      .update({
        cleaner_id: toCleanerId,
        num_cleaners_assigned: Math.max(1, Number(booking.num_cleaners_assigned) || 1),
        dispatch_notes: `CREW HANDOFF — ${from.first_name || fromCleanerId} → ${to.first_name || toCleanerId}`,
      })
      .eq("id", bookingId)
      .eq("cleaner_id", fromCleanerId); // optimistic guard
    if (upErr) throw upErr;

    // Mirror onto any job_assignments rows for this job.
    if (booking.job_id) {
      await admin
        .from("job_assignments")
        .update({ cleaner_id: toCleanerId })
        .eq("job_id", booking.job_id)
        .eq("cleaner_id", fromCleanerId);
    }

    // Notify the new cleaner (email + SMS).
    try {
      await notifyCleanerOfAssignment(admin, booking, to, { role: "Lead" });
    } catch (e) {
      console.error("[reassign-booking-cleaner] notify new cleaner failed", e);
    }

    // Courtesy text to the cleaner who handed it off.
    try {
      const { data: fromFull } = await admin
        .from("cleaners").select("phone, first_name").eq("id", fromCleanerId).maybeSingle();
      if (fromFull?.phone) {
        const dateLabel = formatServiceDate(booking.service_date) || "the upcoming clean";
        const windowLabel = formatTimeSlot(booking.time_slot || booking.arrival_window);
        const when = windowLabel ? `${dateLabel}, ${windowLabel}` : dateLabel;
        await sendSms(admin, {
          toPhone: fromFull.phone,
          message: `Novara: you handed off ${booking.first_name || "the"} clean (${when}) to ${to.first_name || "your crewmate"}. They've been notified.`,
          type: "confirmation",
        });
      }
    } catch (e) {
      console.error("[reassign-booking-cleaner] notify from cleaner failed", e);
    }

    return json({ success: true, bookingId, toCleanerId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[reassign-booking-cleaner] ERROR", msg);
    return json({ error: msg }, 400);
  }
});
