// ─── cleaner-drop-job ───────────────────────────────────────────────────────
//
// Contractor portal "drop this job" action. The assigned cleaner gives a job
// back to the office:
//
//   • verifies the booking currently belongs to the caller (cleanerId is the
//     credential, same auth model as the rest of /contractor/*),
//   • un-assigns them (bookings.cleaner_id → null, job_assignments row →
//     'needs_reassignment' so the dispatch loop ignores it),
//   • bumps cleaners.cancellation_count (feeds assignment priority scoring),
//   • inserts a 'job.dropped' events row → the DB trigger posts an URGENT
//     reassign alert to the Discord Dispatch channel with an @Operations ping,
//   • emails the admin inbox (Resend, best-effort),
//   • flags drops made <48h before the service window as LATE DROPS in every
//     notification (they hit reliability hardest).
//
// Body: { bookingId: string, cleanerId: string, reason?: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAIL = "admin@novaracleaning.com";
const LATE_DROP_HOURS = 48;

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// Hours until the booking's service date (ET-naive: date at midnight local to
// the server is good enough for the 48h late-drop classification).
function hoursUntilService(serviceDate: string | null, timeSlot: string | null): number | null {
  if (!serviceDate) return null;
  const startHour = /^(\d{1,2})/.exec(String(timeSlot || ""))?.[1];
  const dt = new Date(`${serviceDate}T${String(startHour || "8").padStart(2, "0")}:00:00-04:00`);
  if (Number.isNaN(dt.getTime())) return null;
  return (dt.getTime() - Date.now()) / 36e5;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "");
    const cleanerId = String(body?.cleanerId || "");
    const reason = String(body?.reason || "").trim().slice(0, 400);
    if (!bookingId || !cleanerId) return json({ error: "bookingId and cleanerId are required" }, 400);

    // The booking must currently belong to the caller.
    const { data: booking } = await admin
      .from("bookings")
      .select("id, booking_number, cleaner_id, job_id, status, service_date, time_slot, arrival_window, first_name, last_name, address, city, state, total_estimate_cents")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ error: "Booking not found" }, 404);
    if (booking.cleaner_id !== cleanerId) return json({ error: "This job is not assigned to you" }, 403);
    if (["completed", "cancelled", "pending_review"].includes(String(booking.status))) {
      return json({ error: "This job can no longer be dropped" }, 400);
    }

    const { data: cleaner } = await admin
      .from("cleaners")
      .select("id, first_name, last_name, cancellation_count")
      .eq("id", cleanerId)
      .maybeSingle();
    const cleanerName = `${cleaner?.first_name || ""} ${cleaner?.last_name || ""}`.trim() || "Contractor";

    const hrs = hoursUntilService(booking.service_date, booking.time_slot || booking.arrival_window);
    const lateDrop = hrs != null && hrs < LATE_DROP_HOURS;

    // ── Un-assign (atomic guard on cleaner_id so a double-tap can't race) ──
    const { data: claimed } = await admin
      .from("bookings")
      .update({
        cleaner_id: null,
        num_cleaners_assigned: 0,
        dispatch_notes: `Dropped by ${cleanerName} ${new Date().toISOString().slice(0, 16)}Z${reason ? ` — "${reason}"` : ""}. URGENT: needs reassignment.`,
      })
      .eq("id", bookingId)
      .eq("cleaner_id", cleanerId)
      .select("id");
    if (!claimed || claimed.length === 0) return json({ error: "Job already dropped or reassigned" }, 409);

    // Park any assignment row so dispatch loops ignore it.
    if (booking.job_id) {
      await admin
        .from("job_assignments")
        .update({ status: "needs_reassignment" })
        .eq("job_id", booking.job_id)
        .eq("cleaner_id", cleanerId)
        .then(() => undefined, () => undefined);
    }

    // ── Reliability: count the drop (late drops weigh on future assignment) ──
    await admin
      .from("cleaners")
      .update({ cancellation_count: (Number(cleaner?.cancellation_count) || 0) + 1 })
      .eq("id", cleanerId)
      .then(() => undefined, () => undefined);

    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : bookingId.slice(0, 8);
    const customer = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Customer";
    const when = `${booking.service_date || "TBD"}${booking.time_slot ? ` · ${booking.time_slot}` : ""}`;
    const where = [booking.address, booking.city, booking.state].filter(Boolean).join(", ");

    // ── Discord (Dispatch channel via events routing trigger) ──
    await admin.from("events").insert({
      event_type: "job.dropped",
      booking_id: bookingId,
      cleaner_id: cleanerId,
      source: "cleaner-drop-job",
      summary:
        `🚨 ${lateDrop ? "LATE DROP (<48h)" : "Job dropped"} — ${cleanerName} dropped ${bookingRef} (${customer}, ${when}). ` +
        `URGENT: reassign required.${reason ? ` Reason: "${reason}"` : ""}`,
      data: { bookingRef, customer, when, where, reason: reason || null, lateDrop, hoursUntilService: hrs },
    }).then(() => undefined, () => undefined);

    // ── Admin email (best-effort) ──
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "Novara Dispatch <hello@novaracleaning.com>",
          to: [ADMIN_EMAIL],
          subject: `🚨 ${lateDrop ? "LATE DROP (<48h)" : "Job dropped"} — ${bookingRef} needs URGENT reassignment`,
          html: `
            <h2 style="color:#dc2626;margin:0 0 12px">${lateDrop ? "Late drop — less than 48 hours before service" : "Job dropped by contractor"}</h2>
            <p><strong>${cleanerName}</strong> dropped <strong>${bookingRef}</strong>. This job needs urgent reassignment.</p>
            <table style="border-collapse:collapse;font-size:14px">
              <tr><td style="padding:4px 12px 4px 0;color:#64748b">Customer</td><td>${customer}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#64748b">When</td><td>${when}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#64748b">Where</td><td>${where || "—"}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#64748b">Reason</td><td>${reason || "—"}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#64748b">Hours until service</td><td>${hrs != null ? Math.max(0, Math.round(hrs)) : "—"}</td></tr>
            </table>
            <p style="margin-top:14px"><a href="https://admin.novaracleaning.com/admin/dispatch" style="background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open Dispatch console</a></p>
          `,
        });
      }
    } catch (emailErr) {
      console.warn("[cleaner-drop-job] admin email failed (non-blocking)", emailErr instanceof Error ? emailErr.message : String(emailErr));
    }

    return json({ ok: true, dropped: true, lateDrop });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cleaner-drop-job]", msg);
    return json({ error: msg }, 500);
  }
});
