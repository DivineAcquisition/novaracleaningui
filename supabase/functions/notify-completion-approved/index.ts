// notify-completion-approved
//
// Closes a silent gap in the completion loop: when a cleaner marked a job
// done (pending_review) and the office finalized it (completed), the
// cleaner was never explicitly told their work was approved — they had to
// infer it from the status flip and pay movement.
//
// Invoked by the bookings AFTER UPDATE trigger on the
// pending_review → completed transition (see migration
// 20260713220000_contractor_ops_gap_fixes.sql). Texts every assigned crew
// member. Idempotent per booking via the events log.
//
// Body: { bookingId }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "");
    if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);

    const { data: booking } = await admin
      .from("bookings")
      .select("id, booking_number, status, cleaner_id, job_id, service_date, cleaner_marked_complete_at")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
    if (booking.status !== "completed") return json({ ok: true, skipped: `status:${booking.status}` });
    // Only celebrate reviews the cleaner actually submitted — admin
    // force-completions without a cleaner submission don't need this text.
    if (!booking.cleaner_marked_complete_at) return json({ ok: true, skipped: "not_cleaner_submitted" });

    // Idempotency: one approval SMS per booking, ever.
    const { data: prior } = await admin
      .from("events")
      .select("id")
      .eq("event_type", "cleaner.completion_approved")
      .eq("booking_id", bookingId)
      .limit(1);
    if (prior && prior.length > 0) return json({ ok: true, skipped: "already_sent" });

    const crewIds = new Set<string>();
    if (booking.job_id) {
      const { data: assigns } = await admin
        .from("job_assignments")
        .select("cleaner_id, status")
        .eq("job_id", booking.job_id)
        .in("status", ["Confirmed", "Accepted", "In Progress", "Completed"]);
      for (const a of assigns || []) if (a.cleaner_id) crewIds.add(a.cleaner_id);
    }
    if (booking.cleaner_id) crewIds.add(booking.cleaner_id);
    if (crewIds.size === 0) return json({ ok: true, skipped: "no_crew" });

    const { data: crew } = await admin
      .from("cleaners")
      .select("id, phone, first_name")
      .in("id", [...crewIds]);

    const ref = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : "your job";

    let sent = 0;
    for (const c of crew || []) {
      if (!c.phone) continue;
      const { error } = await admin.functions.invoke("send-ghl-sms", {
        body: {
          phone: c.phone,
          firstName: c.first_name || undefined,
          message: `✅ Novara: Your completion for ${ref} was reviewed and APPROVED. Your payout is processing — great work! Reply STOP to opt out.`,
          type: "cleaner_completion_approved",
        },
      });
      if (!error) sent++;
    }

    await admin.from("events").insert({
      event_type: "cleaner.completion_approved",
      booking_id: bookingId,
      source: "notify-completion-approved",
      summary: `Completion approved SMS sent to ${sent}/${crewIds.size} crew for ${ref}`,
      data: { crew: [...crewIds], sent },
    }).then(() => undefined, () => undefined);

    return json({ ok: true, sent, crew: crewIds.size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify-completion-approved]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
