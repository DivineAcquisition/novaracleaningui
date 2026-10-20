// booking-confirm-comms
//
// Restores the customer-facing comms that get SKIPPED on the public funnel:
// the auto-finalize DB trigger pre-sets status='confirmed', so finalize-booking
// no-ops and never runs runPostConfirmFanout (no confirmation email / SMS /
// account SMS / dispatch). This self-contained function — fired by an
// AFTER-UPDATE trigger on the confirm transition — sends them idempotently.
//
// Body: { bookingId }. Idempotent via bookings.confirmation_email_sent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendBookingConfirmationComms } from "../_shared/booking-customer-comms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const log = (s: string, d?: unknown) =>
  console.log(`[BOOKING-COMMS] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { bookingId } = await req.json();
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const { data: b } = await supabase.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!b) return json({ error: "Booking not found" }, 404);
    if (b.status !== "confirmed" && b.status !== "completed") return json({ ok: true, skipped: `status=${b.status}` });
    if (b.confirmation_email_sent) return json({ ok: true, alreadySent: true });

    // Confirmation email, personal checklist (email + text), and the one
    // confirmation text. The helper claims bookings.confirmation_email_sent,
    // so the webhook and the finalize fan-out cannot send them again.
    // Stripe sends the receipt. Nothing here sends a second one.
    const comms = await sendBookingConfirmationComms(supabase, b);
    log("customer comms", comms);

    // Account-link SMS + dispatch (each idempotent on their own).
    const invoke = (fn: string, body: Record<string, unknown>) =>
      fetch(`${url}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}` },
        body: JSON.stringify(body),
      }).catch((e) => log(`${fn} failed`, e instanceof Error ? e.message : String(e)));
    await invoke("send-post-booking-sms", { bookingId: b.id });
    await invoke("auto-dispatch-booking", { bookingId: b.id });

    return json({ ok: true, sent: comms.claimed, heldForPayment: comms.held, checklist: comms.checklist });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
