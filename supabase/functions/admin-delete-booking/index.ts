import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

// admin-delete-booking
//
// Hard-deletes a booking from the admin Bookings tab. The customer is
// DELIBERATELY NOT notified (no SMS / email / GHL lost-stage) — this is an
// internal cleanup action, distinct from cancel-booking (which refunds +
// notifies). Admin/VA only.
//
// FK handling (verified against the live schema):
//   • CASCADE children (booking_emails_sent, cleaner_ratings, payouts,
//     ghl_sync_log, sms_intents, testimonial_offers, email_retry_queue) drop
//     automatically.
//   • SET NULL children (events, customer_credits, service_agreements, …) null
//     out automatically.
//   • NO ACTION children would BLOCK the delete, so we clear them first:
//       referrals (booking_id / referred_booking_id),
//       testimonial_offers.redeemed_booking_id,
//       webhook_failures.booking_id.
//   • The linked dispatch job + its assignments are removed so dispatch
//     doesn't show an orphaned job.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function parseTimeSlot(slot: string | null): { start: string | null } {
  if (!slot) return { start: null };
  const m = slot.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!m) return { start: null };
  let hour = parseInt(m[1], 10);
  const mer = m[3];
  if (mer) {
    const u = mer.toUpperCase();
    if (u === "PM" && hour < 12) hour += 12;
    if (u === "AM" && hour === 12) hour = 0;
  }
  return { start: `${String(hour).padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}:00` };
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only");
  return u.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const actorId = await ensureAdminOrVa(admin, req);
    const { bookingId } = await req.json();
    if (!bookingId) throw new Error("bookingId is required");

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("id, service_date, time_slot, job_id")
      .eq("id", bookingId)
      .single();
    if (bErr || !booking) throw new Error("Booking not found");

    console.log("[admin-delete-booking] deleting", { bookingId, actorId });

    // Free the availability slot this booking was holding (best-effort).
    try {
      const { start } = parseTimeSlot(booking.time_slot);
      if (booking.service_date && start) {
        const { data: slot } = await admin
          .from("availability_slots")
          .select("id, current_bookings")
          .eq("service_date", booking.service_date)
          .eq("start_time", start)
          .maybeSingle();
        if (slot) {
          await admin
            .from("availability_slots")
            .update({ current_bookings: Math.max(0, (slot.current_bookings || 0) - 1), updated_at: new Date().toISOString() })
            .eq("id", slot.id);
        }
      }
    } catch (e) {
      console.error("[admin-delete-booking] slot release failed (non-critical):", e);
    }

    // Clear NO-ACTION FK references that would otherwise block the delete.
    try { await admin.from("referrals").delete().or(`booking_id.eq.${bookingId},referred_booking_id.eq.${bookingId}`); } catch (e) { console.error("referrals clear:", e); }
    try { await admin.from("testimonial_offers").update({ redeemed_booking_id: null }).eq("redeemed_booking_id", bookingId); } catch (e) { console.error("testimonial_offers clear:", e); }
    try { await admin.from("webhook_failures").delete().eq("booking_id", bookingId); } catch (e) { console.error("webhook_failures clear:", e); }

    // Remove the linked dispatch job + assignments so dispatch has no orphan.
    if (booking.job_id) {
      try { await admin.from("job_assignments").delete().eq("job_id", booking.job_id); } catch (e) { console.error("job_assignments clear:", e); }
      try { await admin.from("jobs").delete().eq("id", booking.job_id); } catch (e) { console.error("job delete (non-critical):", e); }
    }

    const { error: delErr } = await admin.from("bookings").delete().eq("id", bookingId);
    if (delErr) {
      console.error("[admin-delete-booking] delete failed", delErr);
      throw new Error(delErr.message || "Delete failed");
    }

    console.log("[admin-delete-booking] deleted ok", { bookingId });
    return new Response(
      JSON.stringify({ success: true, deleted: bookingId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[admin-delete-booking] ERROR", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
