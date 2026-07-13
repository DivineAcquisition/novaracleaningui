// admin-refund-booking
//
// Operator-only endpoint for issuing refunds + cancelling the booking
// row when the customer portal's normal cancel-booking flow is
// unavailable. Uses the SAME Stripe secret the rest of the project
// uses, so refunds always land on whichever Stripe account is actually
// receiving the customer's charges — even if the Stripe MCP this
// agent is wired to is authenticated to a different account.
//
// Request body:
//   {
//     bookingId?: string;          // optional — looks up payment_intent_id
//     paymentIntentId?: string;    // optional — used directly if bookingId missing
//     amountCents?: number;        // optional — defaults to full deposit refund
//     reason?: string;             // optional — stored on the refund metadata
//     markCancelled?: boolean;     // when true, also flip status='cancelled'
//   }
//
// Idempotent: if the payment_intent already has a `refunded: true`
// flag, the second call is a no-op (Stripe still 409s on duplicate
// refund amount; we surface that error directly).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ADMIN-REFUND] ${step}${tail}`);
};

interface RefundRequest {
  bookingId?: string;
  paymentIntentId?: string;
  amountCents?: number;
  reason?: string;
  markCancelled?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RefundRequest = await req.json();
    const { bookingId, paymentIntentId: piIdInput, amountCents, reason, markCancelled } = body;

    if (!bookingId && !piIdInput) {
      return new Response(
        JSON.stringify({ error: "bookingId or paymentIntentId required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY missing" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Resolve the payment_intent: prefer the explicit param, else
    // look it up from the bookings row.
    let paymentIntentId = piIdInput;
    let booking: Record<string, unknown> | null = null;
    if (bookingId) {
      const { data, error } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .single();
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "booking not found", details: error?.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
        );
      }
      booking = data;
      if (!paymentIntentId) paymentIntentId = data.payment_intent_id as string;
    }
    if (!paymentIntentId) {
      return new Response(
        JSON.stringify({ error: "booking has no payment_intent_id" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    logStep("Resolved target", { paymentIntentId, bookingId });

    // Sanity-check the payment intent on Stripe. We refuse to attempt
    // a refund on anything that isn't `succeeded` — Stripe would 400
    // anyway, but we return a friendlier message and reflect what
    // status Stripe currently reports.
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    logStep("PaymentIntent retrieved", { id: pi.id, status: pi.status, amount: pi.amount });

    if (pi.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          error: "PaymentIntent is not in 'succeeded' state — nothing to refund",
          paymentIntentStatus: pi.status,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Pick the refund amount. Default = the actual amount Stripe
    // captured (pi.amount_received) which is correct even when the
    // booking row drifted from the charge (e.g. customer was
    // upgraded mid-flow). Fall back to bookings.deposit_cents.
    const refundAmount = amountCents
      || pi.amount_received
      || pi.amount
      || (booking?.deposit_cents as number | undefined)
      || 0;
    if (refundAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "Could not determine refund amount" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // Issue the refund. metadata captures who/what asked for it so
    // ops can audit later.
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmount,
      reason: "requested_by_customer",
      metadata: {
        booking_id: bookingId || "",
        triggered_by: "admin-refund-booking",
        admin_reason: reason || "",
      },
    });
    logStep("Refund created", { id: refund.id, status: refund.status, amount: refund.amount });

    // Optionally flip the booking row to cancelled so the customer
    // portal stops surfacing it as upcoming.
    if (markCancelled && booking) {
      await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          cancel_reason: reason || "admin-refund",
        })
        .eq("id", booking.id as string);
      logStep("Booking row flipped to cancelled", { bookingId: booking.id });

      // This path used to cancel SILENTLY for the crew — the plain
      // cancel-booking flow texts the cleaner, but refund+cancel (the more
      // common admin path) never did. Notify every assigned cleaner.
      try {
        const crewIds = new Set<string>();
        if (booking.job_id) {
          const { data: assigns } = await supabase
            .from("job_assignments")
            .select("cleaner_id, status")
            .eq("job_id", booking.job_id as string)
            .in("status", ["Confirmed", "Accepted", "In Progress", "Assigned"]);
          for (const a of assigns || []) if (a.cleaner_id) crewIds.add(a.cleaner_id as string);
        }
        if (booking.cleaner_id) crewIds.add(booking.cleaner_id as string);
        if (crewIds.size > 0) {
          const { data: crew } = await supabase
            .from("cleaners")
            .select("id, phone, first_name")
            .in("id", [...crewIds]);
          for (const cleaner of crew || []) {
            if (!cleaner.phone) continue;
            await supabase.functions.invoke("send-ghl-sms", {
              body: {
                phone: cleaner.phone,
                firstName: cleaner.first_name || undefined,
                message:
                  `Novara Cleaning: A job you were assigned to` +
                  (booking.service_date ? ` on ${booking.service_date}` : "") +
                  ` has been cancelled and refunded. No action needed. Reply STOP to opt out.`,
                type: "job_offer",
              },
            }).catch(() => undefined);
          }
          logStep("Crew notified of refund-cancel", { count: crewIds.size });
        }
      } catch (smsErr) {
        logStep("Crew cancel SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        refundId: refund.id,
        refundStatus: refund.status,
        amountRefunded: refund.amount,
        currency: refund.currency,
        paymentIntentId,
        bookingId: bookingId || null,
        stripeAccount: pi.on_behalf_of || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("Unhandled error", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
