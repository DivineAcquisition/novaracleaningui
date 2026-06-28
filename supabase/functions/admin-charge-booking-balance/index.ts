// ─── admin-charge-booking-balance ────────────────────────────────────────
//
// Ops: off-session charge remaining balance on the Stripe account tied to
// STRIPE_SECRET_KEY (env / app_secrets). Idempotent when
// balance_payment_intent_id is already set on the booking row.
//
// Body: { bookingId: string, force?: boolean }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { resolveOffSessionPaymentMethod } from "../_shared/resolve-off-session-payment-method.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) => {
  console.log(`[ADMIN-CHARGE-BALANCE] ${step}${details ? ` ${JSON.stringify(details)}` : ""}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const bookingId = String(body.bookingId || "");
    const force = Boolean(body.force);
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const remainingCents = Math.max(
      0,
      (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0),
    );
    if (remainingCents <= 0) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "no-balance" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existingBalancePi = booking.payment_intent_id as string | null;
    if (existingBalancePi?.startsWith("pi_") && !force) {
      const stripeKeyCheck = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      if (stripeKeyCheck) {
        try {
          const stripeCheck = new Stripe(stripeKeyCheck, { apiVersion: "2025-08-27.basil" });
          const existing = await stripeCheck.paymentIntents.retrieve(existingBalancePi);
          if (existing.status === "succeeded" && (existing.amount_received || 0) >= remainingCents) {
            return new Response(JSON.stringify({
              success: true,
              alreadyCharged: true,
              paymentIntentId: existingBalancePi,
            }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } catch (_) { /* proceed */ }
      }
    }

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    let customerId: string | null = null;
    if (booking.customer_id && String(booking.customer_id).startsWith("cus_")) {
      customerId = booking.customer_id;
    }
    const { data: custRow } = await supabase
      .from("customers")
      .select("stripe_customer_id")
      .eq("email", booking.email)
      .maybeSingle();
    if (!customerId && custRow?.stripe_customer_id?.startsWith("cus_")) {
      customerId = custRow.stripe_customer_id;
    }
    if (!customerId) {
      const found = await stripe.customers.list({ email: booking.email, limit: 1 });
      customerId = found.data[0]?.id ?? null;
    }
    if (!customerId) throw new Error(`No Stripe customer for ${booking.email}`);

    // Verify customer exists on this Stripe account
    await stripe.customers.retrieve(customerId);

    const pmId = await resolveOffSessionPaymentMethod(stripe, customerId);
    if (!pmId) throw new Error("No saved card on file for off-session charge");

    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : `BK-${bookingId.slice(0, 8)}`;

    const charge = await stripe.paymentIntents.create({
      amount: remainingCents,
      currency: "usd",
      customer: customerId,
      payment_method: pmId,
      off_session: true,
      confirm: true,
      description: `${bookingRef} — Remaining balance (${booking.service_type || "cleaning"} on ${booking.service_date})`,
      metadata: {
        booking_id: bookingId,
        booking_number: String(booking.booking_number ?? ""),
        chargeType: "balance_auto_charge",
      },
    }, {
      // Dedupe concurrent / repeat balance charges for the same booking +
      // amount so the customer is never double-charged. `force` callers
      // still re-key off the amount, and a different balance (post
      // adjustment) gets a fresh key.
      idempotencyKey: `balance-${bookingId}-${remainingCents}`,
    });

    if (charge.status !== "succeeded") {
      throw new Error(`Charge status: ${charge.status}`);
    }

    const patch: Record<string, unknown> = {
      customer_id: customerId,
      payment_intent_id: charge.id,
      final_charge_cents: booking.total_estimate_cents,
      payment_received_at: booking.payment_received_at || new Date().toISOString(),
      team_notes: [
        (booking.team_notes as string | null) || "",
        `Balance $${(remainingCents / 100).toFixed(2)} charged off-session ${charge.id} (${new Date().toISOString().slice(0, 10)}).`,
      ].filter(Boolean).join("\n"),
    };

    await supabase.from("bookings").update(patch).eq("id", bookingId);

    await supabase
      .from("webhook_failures")
      .update({ resolved: true })
      .eq("booking_id", bookingId)
      .eq("webhook_url", "stripe:balance_auto_charge");

    const result = {
      success: true,
      paymentIntentId: charge.id,
      amountCents: remainingCents,
      customerId,
      paymentMethodId: pmId,
      bookingRef,
    };
    log("charged", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
