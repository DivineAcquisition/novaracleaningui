// ─── send-remaining-balance-invoice ──────────────────────────────────────
//
// Creates and sends a Stripe Invoice for the remaining balance on a
// deposit-paid booking. Intended as a safety net for the new flow where
// stripe-webhook is supposed to off-session-charge the saved card when
// the cleaner marks the booking complete, but the customer wants/needs
// a hosted invoice link emailed to them (e.g. waiting for a check, or
// preferring a manual click-to-pay flow).
//
// Idempotent: if the booking row already has `stripe_invoice_id`, the
// function returns the existing `hosted_invoice_url` without creating
// a duplicate invoice.
//
// Body:
//   { bookingId: "uuid" }
// Response:
//   { success: true, invoiceId, hostedInvoiceUrl }
//
// Reads the Stripe secret via the DB-override layer (`app_secrets`) so
// a key rotation propagates on next cold start.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[REMAINING-BALANCE-INVOICE] ${step}${tail}`);
};

interface InvoiceRequest {
  bookingId: string;
  /** When true, charge saved card off-session instead of sending invoice. */
  chargeOffSession?: boolean;
  /** Optional override — when omitted, uses total - deposit. */
  amountCents?: number;
  /** Optional override for the auto-collect days. Defaults to days
   *  until the service date (capped at 30). */
  daysUntilDue?: number;
}

// Inline copy of resolveSecret so the function has no relative
// dependencies — keeps deployment simple via the MCP deploy tool.
async function resolveStripeKey(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", "STRIPE_SECRET_KEY")
      .maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
  return value;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: InvoiceRequest = await req.json();
    const { bookingId, amountCents, daysUntilDue, chargeOffSession } = body;
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
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
      logStep("Booking not found", { bookingId });
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }


    const remaining = amountCents ??
      Math.max(
        0,
        (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0),
      );

    if (chargeOffSession) {
      if (remaining <= 0) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "no-balance" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const stripeKey = await resolveStripeKey(supabase);
      if (!stripeKey) {
        return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY missing" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        });
      }
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
      await stripe.customers.retrieve(customerId);

      const pms = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      const pmId = pms.data[0]?.id;
      if (!pmId) throw new Error("No saved card on file for off-session charge");

      const bookingRef = booking.booking_number
        ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
        : `BK-${String(bookingId).slice(0, 8)}`;

      const charge = await stripe.paymentIntents.create({
        amount: remaining,
        currency: "usd",
        customer: customerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        description: `${bookingRef} — Remaining balance (${booking.service_type || "cleaning"} on ${booking.service_date})`,
        metadata: {
          booking_id: String(bookingId),
          booking_number: String(booking.booking_number ?? ""),
          chargeType: "balance_auto_charge",
        },
      });

      if (charge.status !== "succeeded") {
        throw new Error(`Charge status: ${charge.status}`);
      }

      await supabase.from("bookings").update({
        customer_id: customerId,
        payment_intent_id: charge.id,
        final_charge_cents: booking.total_estimate_cents,
        payment_received_at: booking.payment_received_at || new Date().toISOString(),
      }).eq("id", bookingId);

      await supabase
        .from("webhook_failures")
        .update({ resolved: true })
        .eq("booking_id", bookingId)
        .eq("webhook_url", "stripe:balance_auto_charge");

      logStep("Off-session charge succeeded", {
        paymentIntentId: charge.id,
        amountCents: remaining,
        customerId,
      });

      return new Response(
        JSON.stringify({
          success: true,
          charged: true,
          paymentIntentId: charge.id,
          amountCents: remaining,
          customerId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Already invoiced? Return the existing url so the UI can show it
    // without spamming Stripe (and the customer's inbox).
    if (booking.stripe_invoice_id && booking.hosted_invoice_url) {
      logStep("Invoice already exists", {
        invoiceId: booking.stripe_invoice_id,
      });
      return new Response(
        JSON.stringify({
          success: true,
          invoiceId: booking.stripe_invoice_id,
          hostedInvoiceUrl: booking.hosted_invoice_url,
          existing: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (remaining <= 0) {
      logStep("No remaining balance", {
        total: booking.total_estimate_cents,
        deposit: booking.deposit_cents,
      });
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "no-balance" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const stripeKey = await resolveStripeKey(supabase);
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "STRIPE_SECRET_KEY missing" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Resolve / create the Stripe customer so the invoice has a
    // billing target. If the booking row already has a customer_id
    // that starts with cus_ we reuse it; otherwise we look up by
    // email and create if missing.
    let customerId: string | null = null;
    if (
      booking.customer_id && typeof booking.customer_id === "string" &&
      booking.customer_id.startsWith("cus_")
    ) {
      customerId = booking.customer_id;
    } else {
      const found = await stripe.customers.list({
        email: booking.email,
        limit: 1,
      });
      if (found.data.length > 0) {
        customerId = found.data[0].id;
      } else {
        const created = await stripe.customers.create({
          email: booking.email,
          name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() ||
            undefined,
          phone: booking.phone || undefined,
        });
        customerId = created.id;
      }
    }

    // Default: due in N days, where N = days between today and the
    // service date (rounded up, capped between 0 and 30). For
    // services already in the past, we send `due_date = today`.
    const computedDays = (() => {
      if (typeof daysUntilDue === "number") return Math.max(0, daysUntilDue);
      if (booking.service_date) {
        const svc = new Date(`${booking.service_date}T12:00:00`).getTime();
        const now = Date.now();
        const diffDays = Math.ceil((svc - now) / 86400000);
        return Math.min(30, Math.max(0, diffDays));
      }
      return 7;
    })();

    const description =
      `Remaining balance for ${booking.service_type || "cleaning"} on ${booking.service_date} ` +
      (booking.address ? `@ ${booking.address}` : "");
    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : `BK-${String(bookingId).slice(0, 8)}`;

    // 1. Add an upcoming invoice item, then create the invoice with
    //    pending_invoice_items_behavior='include'. This is the
    //    standard Stripe pattern for billing a custom amount.
    await stripe.invoiceItems.create({
      customer: customerId!,
      amount: remaining,
      currency: "usd",
      description: `${bookingRef} — ${description}`,
    });

    const invoice = await stripe.invoices.create({
      customer: customerId!,
      collection_method: "send_invoice",
      days_until_due: computedDays,
      pending_invoice_items_behavior: "include",
      description,
      metadata: {
        booking_id: String(bookingId),
        booking_number: booking.booking_number
          ? String(booking.booking_number)
          : "",
        purpose: "remaining_balance",
      },
      auto_advance: true,
    });

    if (!invoice.id) {
      throw new Error("Stripe did not return an invoice id");
    }

    // Finalize so the hosted url is generated, then send.
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: true,
    });
    await stripe.invoices.sendInvoice(invoice.id);

    const hostedInvoiceUrl = finalized.hosted_invoice_url || null;

    // Persist on the booking row so the confirmation page (and the
    // admin tools) can deep-link to the hosted invoice.
    await supabase
      .from("bookings")
      .update({
        stripe_invoice_id: invoice.id,
        hosted_invoice_url: hostedInvoiceUrl,
      })
      .eq("id", bookingId);

    logStep("Invoice created and sent", {
      invoiceId: invoice.id,
      hostedInvoiceUrl,
      amountCents: remaining,
    });

    return new Response(
      JSON.stringify({
        success: true,
        invoiceId: invoice.id,
        hostedInvoiceUrl,
        amountCents: remaining,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
