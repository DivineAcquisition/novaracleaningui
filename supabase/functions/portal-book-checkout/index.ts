import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { getServiceFinalPrice, getHomeSize } from "../_shared/pricing.ts";
import { runPostConfirmFanout } from "../_shared/post-confirm-booking.ts";

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

/**
 * Run the shared post-confirm fan-out for a freshly-confirmed in-app
 * booking. WITHOUT this, member portal bookings confirmed here never
 * reach GHL (send-zapier-webhook), the confirmation email/SMS, dispatch,
 * the Google Calendar, or the post-booking referral SMS — i.e. "no data
 * mapped, no comms". Idempotent + non-blocking: the helper gates on
 * bookings.confirmation_email_sent and swallows downstream failures so a
 * GHL/email hiccup can never fail the customer's checkout.
 */
// deno-lint-ignore no-explicit-any
async function fanoutConfirmedBooking(supabase: any, bookingId: string): Promise<void> {
  try {
    const { data: fresh } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();
    if (!fresh) return;
    await runPostConfirmFanout(supabase, fresh, { source: "customer" });
    logStep("post-confirm fan-out complete", { bookingId });
  } catch (err) {
    logStep("post-confirm fan-out failed (non-blocking)", {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
            confirmed_at: new Date().toISOString(),
            payment_intent_id: (session.payment_intent as string) || booking.payment_intent_id,
          })
          .eq("id", booking.id);
        logStep("Booking confirmed via verify", { bookingId: booking.id });
        await fanoutConfirmedBooking(supabase, booking.id);
      }

      return json({
        paid,
        status: paid ? "confirmed" : booking.status,
        bookingId: booking.id,
      });
    }

    // ─── CONFIRM ─────────────────────────────────────────────────────────
    // Free ($0) membership-credit bookings are inserted already-confirmed
    // client-side without ever touching Stripe. They still need the full
    // post-confirm fan-out (GHL sync, confirmation email/SMS, auto-dispatch,
    // Google Calendar, post-booking SMS) — otherwise a member books in-app
    // and nothing maps to GHL and no cleaner is ever dispatched. This action
    // runs that fan-out for an already-confirmed booking the caller owns.
    if (action === "confirm") {
      const confirmBookingId: string | undefined = body.bookingId;
      if (!confirmBookingId) return json({ error: "bookingId required" }, 400);

      const { data: booking } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", confirmBookingId)
        .maybeSingle();

      if (!booking) return json({ error: "Booking not found" }, 404);
      if ((booking.email || "").toLowerCase() !== email) {
        return json({ error: "Forbidden" }, 403);
      }
      // Only fan out for bookings that are actually confirmed — never
      // promote a pending_payment booking to confirmed for free here.
      if (booking.status !== "confirmed") {
        return json({ confirmed: false, status: booking.status, bookingId: booking.id });
      }
      if (!booking.confirmed_at) {
        await supabase
          .from("bookings")
          .update({ confirmed_at: new Date().toISOString() })
          .eq("id", booking.id);
      }
      await fanoutConfirmedBooking(supabase, booking.id);
      return json({ confirmed: true, status: "confirmed", bookingId: booking.id });
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

    // Recognize the customer by email and find a saved card.
    let customerId: string | undefined;
    let savedPaymentMethod: string | undefined;
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length > 0) {
      const cust = customers.data[0];
      customerId = cust.id;
      const defaultPm =
        (typeof cust.invoice_settings?.default_payment_method === "string"
          ? cust.invoice_settings.default_payment_method
          : undefined) ||
        (typeof cust.default_source === "string" ? cust.default_source : undefined);
      if (defaultPm) {
        savedPaymentMethod = defaultPm;
      } else {
        const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        if (pms.data.length > 0) savedPaymentMethod = pms.data[0].id;
      }
    }

    const piMetadata = {
      booking_id: booking.id,
      kind: "portal_booking",
      uses_credit: String(usesCredit),
    };

    // ── Existing customer with a card on file → charge instantly
    //    off-session. No card re-entry, no redirect. Falls back to hosted
    //    Checkout if the card needs authentication (3DS) or is declined.
    if (customerId && savedPaymentMethod) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: customerId,
          payment_method: savedPaymentMethod,
          off_session: true,
          confirm: true,
          description: label,
          metadata: piMetadata,
        });
        if (pi.status === "succeeded") {
          await supabase
            .from("bookings")
            .update({
              status: "confirmed",
              confirmed_at: new Date().toISOString(),
              payment_intent_id: pi.id,
            })
            .eq("id", booking.id);
          logStep("Charged saved card off-session", { bookingId: booking.id, amountCents });
          await fanoutConfirmedBooking(supabase, booking.id);
          return json({ paid: true, instant: true, bookingId: booking.id, amountCents });
        }
        logStep("Saved-card PI not succeeded, falling back to Checkout", { status: pi.status });
      } catch (e) {
        logStep("Off-session charge failed, falling back to Checkout", {
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ── New customer (or no saved card / off-session declined) → hosted
    //    Stripe Checkout Session that stores the card for next time, so the
    //    customer never has to re-enter it on future in-app bookings.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      customer_creation: customerId ? undefined : "always",
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
      metadata: piMetadata,
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
