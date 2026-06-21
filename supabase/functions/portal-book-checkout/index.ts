import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { getServiceFinalPrice, getHomeSize } from "../_shared/pricing.ts";

// ─── Member-portal hosted checkout ──────────────────────────────────────
//
// The authenticated customer portal (app.novaracleaning.com/portal/book)
// lets Glow members book in-app. Standard cleans paid for with a
// membership credit are confirmed instantly client-side ($0, no Stripe).
//
// This function handles the cases that DO need a card:
//   • a credit booking upgraded to a Deep Clean  → charge the deep-clean
//     surcharge (DEEP_CLEAN_UPSELL_CENTS)
//   • a member with no credits booking an extra clean → charge the full
//     service price (v4 pricing)
//
// It returns a Stripe-hosted Checkout Session URL (mode: payment) so the
// portal never has to re-implement the embedded Elements flow that the
// public funnel uses. The amount is ALWAYS computed server-side from the
// booking's home size / service type — the client cannot influence it.
//
// Two actions:
//   action: "create"  → make the session, stamp checkout_session_id, return url
//   action: "verify"  → after Stripe redirects back, confirm the booking
//                       (idempotent) so the portal/account shows it as
//                       confirmed without depending on webhook latency.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEEP_CLEAN_UPSELL_CENTS = 6500;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PORTAL-BOOK-CHECKOUT] ${step}${detailsStr}`);
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ─── Authenticate the caller (must be a signed-in customer) ──────────
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const email = userData?.user?.email?.toLowerCase();
    if (!email) {
      return json({ error: "Not authenticated" }, 401);
    }

    const body = await req.json();
    const action = body.action || "create";

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const origin = req.headers.get("origin") || "https://app.novaracleaning.com";

    // ─── VERIFY ──────────────────────────────────────────────────────────
    if (action === "verify") {
      const sessionId: string | undefined = body.sessionId;
      if (!sessionId) return json({ error: "sessionId required" }, 400);

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const paid = session.payment_status === "paid" || session.status === "complete";

      const { data: booking } = await supabase
        .from("bookings")
        .select("*")
        .eq("checkout_session_id", sessionId)
        .maybeSingle();

      if (!booking) return json({ error: "Booking not found for session" }, 404);
      if ((booking.email || "").toLowerCase() !== email) {
        return json({ error: "Forbidden" }, 403);
      }

      if (paid && booking.status !== "confirmed") {
        await supabase
          .from("bookings")
          .update({
            status: "confirmed",
            payment_intent_id: (session.payment_intent as string) || booking.payment_intent_id,
          })
          .eq("id", booking.id);
        logStep("Booking confirmed via verify", { bookingId: booking.id });
      }

      return json({
        paid,
        status: paid ? "confirmed" : booking.status,
        bookingId: booking.id,
      });
    }

    // ─── CREATE ──────────────────────────────────────────────────────────
    const bookingId: string | undefined = body.bookingId;
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bErr || !booking) return json({ error: "Booking not found" }, 404);
    if ((booking.email || "").toLowerCase() !== email) {
      return json({ error: "Forbidden" }, 403);
    }

    const homeSizeId: string = booking.home_size_id;
    const serviceType: string = booking.service_type || "standard";
    const usesCredit = booking.uses_credit === true;

    if (!getHomeSize(homeSizeId)) {
      return json({ error: `Invalid home size: ${homeSizeId}` }, 400);
    }

    // Server-authoritative amount.
    let amountCents: number;
    let label: string;
    if (usesCredit) {
      // Credit covers the standard clean; only the deep-clean surcharge is due.
      amountCents = DEEP_CLEAN_UPSELL_CENTS;
      label = "Deep Clean Upgrade (membership credit applied)";
    } else {
      // No credit — full v4 service price, paid in full up front.
      const price = getServiceFinalPrice(homeSizeId, serviceType, "B");
      amountCents = Math.round(price * 100);
      label = `${serviceType === "deep" ? "Deep Clean" : "Standard Clean"} (${homeSizeId.replace("_", "-")} sqft)`;
    }

    if (!amountCents || amountCents < 100) {
      return json({ error: "Nothing to charge for this booking" }, 400);
    }

    // Reuse an existing Stripe customer when we can (keeps cards on file).
    let customerId: string | undefined;
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length > 0) customerId = customers.data[0].id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: label },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/portal/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/portal/book`,
      payment_intent_data: { setup_future_usage: "off_session" },
      metadata: {
        booking_id: booking.id,
        kind: "portal_booking",
        uses_credit: String(usesCredit),
      },
    });

    await supabase
      .from("bookings")
      .update({ checkout_session_id: session.id })
      .eq("id", booking.id);

    logStep("Portal checkout session created", { bookingId: booking.id, amountCents });

    return json({ url: session.url, sessionId: session.id, amountCents });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json({ error: message }, 500);
  }
});
