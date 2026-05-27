// finalize-booking
//
// Two things confirm a NovaraCleaning booking:
//   1. Payment cleared (stripe-webhook → payment_intent.succeeded)
//   2. The customer answered the home-detail questionnaire on
//      /book/details (address, city, state, bedrooms, bathrooms,
//      dwelling_type)
//
// Either step can happen first. Whoever reaches the second milestone
// calls this function to actually CONFIRM the booking and fire the
// downstream actions.
//
// All downstream side effects (emails, SMS, dispatch, GCal, GHL,
// Zapier, post-booking SMS) live in `_shared/post-confirm-booking.ts`
// so the customer flow (this file) and the VA flow (`book-as-va`)
// stay 1:1.
//
// The function is idempotent — it bails out early if the booking is
// already confirmed (or still missing one of the gates). This lets
// stripe-webhook AND PropertyDetails both safely invoke it without
// double-charging or double-sending.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { runPostConfirmFanout } from "../_shared/post-confirm-booking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[FINALIZE-BOOKING] ${step}${tail}`);
};

interface FinalizeRequest {
  bookingId: string;
  /** Optional trigger label for observability (e.g. "stripe_webhook", "property_details_save"). */
  trigger?: string;
}

const REQUIRED_DETAIL_FIELDS: ReadonlyArray<keyof Record<string, unknown>> = [
  "address",
  "city",
  "state",
  "bedrooms",
  "bathrooms",
  "dwelling_type",
];

function hasAllDetails(booking: Record<string, unknown>): boolean {
  return REQUIRED_DETAIL_FIELDS.every((f) => {
    const v = booking[f];
    if (v === null || v === undefined) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  });
}

function paymentCleared(booking: Record<string, unknown>): boolean {
  if (booking.uses_credit === true) return true;
  if (booking.payment_received_at) return true;
  if (booking.status === "confirmed" || booking.status === "completed") return true;
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, trigger = "unknown" }: FinalizeRequest = await req.json();
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Finalize requested", { bookingId, trigger });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchErr || !booking) {
      logStep("Booking not found", { bookingId, error: fetchErr });
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (booking.status === "confirmed" || booking.status === "completed") {
      logStep("Booking already confirmed — no-op", {
        bookingId,
        status: booking.status,
      });
      return new Response(
        JSON.stringify({ success: true, status: booking.status, alreadyConfirmed: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (booking.status === "cancelled") {
      logStep("Booking cancelled — skip finalize", { bookingId });
      return new Response(
        JSON.stringify({ success: false, status: "cancelled", reason: "cancelled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (!paymentCleared(booking)) {
      logStep("Waiting on payment — cannot finalize yet", {
        bookingId,
        status: booking.status,
      });
      return new Response(
        JSON.stringify({
          success: false,
          status: booking.status,
          reason: "payment_pending",
          message: "Payment has not cleared yet. Booking will finalize automatically once Stripe confirms.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    if (!hasAllDetails(booking)) {
      logStep("Home details missing — cannot finalize yet", {
        bookingId,
        status: booking.status,
        missing: REQUIRED_DETAIL_FIELDS.filter((f) => !booking[f]),
      });
      if (booking.status === "pending_payment") {
        await supabase
          .from("bookings")
          .update({ status: "pending_details" })
          .eq("id", bookingId)
          .eq("status", "pending_payment");
      }
      return new Response(
        JSON.stringify({
          success: false,
          status: "pending_details",
          reason: "details_missing",
          message: "Home details are required to finalize the booking.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Both gates passed — promote the booking to confirmed.
    const { error: updateErr } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .in("status", ["pending_payment", "pending_details", "booked"]);

    if (updateErr) {
      logStep("Confirm update failed, retrying without confirmed_at", { error: updateErr });
      await supabase
        .from("bookings")
        .update({ status: "confirmed" })
        .eq("id", bookingId)
        .in("status", ["pending_payment", "pending_details", "booked"]);
    }

    logStep("Booking promoted to confirmed", { bookingId });

    // Hand off to the shared post-confirm helper. This is the same
    // helper book-as-va invokes, so the customer + admin flows stay
    // bit-for-bit identical from this point on (emails, SMS, dispatch,
    // GCal, GHL, Zapier, post-booking SMS).
    await runPostConfirmFanout(
      supabase,
      { ...booking, status: "confirmed" },
      { source: "customer" },
    );

    return new Response(
      JSON.stringify({ success: true, status: "confirmed", bookingId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("Unhandled error", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
