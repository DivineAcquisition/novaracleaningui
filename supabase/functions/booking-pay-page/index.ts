// ─── booking-pay-page ───────────────────────────────────────────────────────
//
// Backend for the custom deposit checkout page (try.novaracleaning.com/pay/
// <token>) that internal bookings send instead of a raw Stripe Checkout link.
//
// The page's flow — and the LEGAL GATE — is enforced HERE, server-side:
//
//   1. get    { token }                  → booking summary + agreement status
//   2. sign   { token, name, agreed, pdfBase64 }
//        Records the signed One-Time Service Agreement (all checkboxes must
//        be true + signed PDF required). Delegates storage to the existing
//        store-service-agreement function (private bucket + Drive copy).
//   3. intent { token }                  → Stripe clientSecret for the deposit
//        REFUSES (403) unless a fully-accepted agreement row exists for this
//        booking — so payment without the legal step is impossible, even for
//        a caller hitting the API directly.
//
// The PaymentIntent charges the deposit AND saves the card off-session
// (setup_future_usage) on the booking's Stripe customer, and stamps
// bookings.payment_intent_id + customer_id. That keeps the whole existing
// machine working unchanged:
//   • stripe-webhook payment_intent.succeeded → payment_received_at + confirm
//   • prepare-completion-hold (S-5 cron)      → manual-capture pre-auth hold
//   • completion capture + payouts            → untouched

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[booking-pay-page] ${s}${d ? " " + JSON.stringify(d) : ""}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const BOOKING_COLS =
  "id, booking_number, status, service_type, service_date, time_slot, arrival_window, " +
  "first_name, last_name, email, phone, address, city, state, zip_code, " +
  "total_estimate_cents, deposit_cents, payment_intent_id, customer_id, " +
  "payment_received_at, pay_page_token, cancelled_at";

// deno-lint-ignore no-explicit-any
async function loadBooking(supabase: any, token: string): Promise<Row | null> {
  if (!token || token.length < 16) return null;
  const { data } = await supabase
    .from("bookings")
    .select(BOOKING_COLS)
    .eq("pay_page_token", token)
    .maybeSingle();
  return data || null;
}

// The legal gate: a service_agreements row for this booking with every
// required acceptance flag true AND source = 'pay_page'. The source filter
// matters: the VA booking screen used to record a "verbally agreed" row at
// booking time (source 'va_phone'), which made the pay page think the legal
// step was already done and skip straight to payment. Only the customer's
// own signature on THIS page satisfies the gate.
// deno-lint-ignore no-explicit-any
async function agreementAccepted(supabase: any, bookingId: string): Promise<boolean> {
  const { data } = await supabase
    .from("service_agreements")
    .select("id, agreed_terms, agreed_disclaimer, agreed_service_agreement")
    .eq("booking_id", bookingId)
    .eq("source", "pay_page")
    .eq("agreed_terms", true)
    .eq("agreed_disclaimer", true)
    .eq("agreed_service_agreement", true)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

function depositDueCents(b: Row): number {
  const dep = Number(b.deposit_cents) || 0;
  if (dep > 0) return dep;
  return Number(b.total_estimate_cents) || 0;
}

function summarize(b: Row, signed: boolean) {
  const total = Number(b.total_estimate_cents) || 0;
  const due = depositDueCents(b);
  return {
    bookingId: b.id,
    bookingNumber: b.booking_number ?? null,
    status: b.status,
    firstName: b.first_name || "",
    lastName: b.last_name || "",
    email: b.email || "",
    serviceType: b.service_type || "Cleaning",
    serviceDate: b.service_date || null,
    timeSlot: b.time_slot || b.arrival_window || null,
    city: b.city || "",
    state: b.state || "",
    totalCents: total,
    depositCents: due,
    remainingCents: Math.max(0, total - due),
    agreementSigned: signed,
    paid: !!b.payment_received_at,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const supabase: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String((body as Row)?.action || "get");
    const token = String((body as Row)?.token || "").trim();

    const booking = await loadBooking(supabase, token);
    if (!booking) return json({ ok: false, error: "not_found" }, 404);
    if (booking.status === "cancelled") return json({ ok: false, error: "cancelled" }, 410);

    // ── get: summary + agreement/payment status ─────────────────────────
    if (action === "get") {
      const signed = await agreementAccepted(supabase, booking.id);
      return json({ ok: true, booking: summarize(booking, signed) });
    }

    // ── sign: record the accepted + signed agreement ────────────────────
    if (action === "sign") {
      const agreed = (body as Row)?.agreed || {};
      const name = String((body as Row)?.name || "").trim();
      const pdfBase64 = String((body as Row)?.pdfBase64 || "");

      // Every legal component MUST be accepted, and the signed PDF must exist.
      if (!agreed.terms || !agreed.disclaimer || !agreed.serviceAgreement) {
        return json({ ok: false, error: "all_policies_must_be_accepted" }, 400);
      }
      if (!name) return json({ ok: false, error: "signature_name_required" }, 400);
      if (!pdfBase64 || pdfBase64.length < 500) {
        return json({ ok: false, error: "signed_agreement_pdf_required" }, 400);
      }

      const { data: res, error } = await supabase.functions.invoke("store-service-agreement", {
        body: {
          bookingId: booking.id,
          email: booking.email,
          name,
          serviceType: booking.service_type || "Cleaning",
          source: "pay_page",
          agreed: {
            terms: true,
            disclaimer: true,
            refund: Boolean(agreed.refund ?? true),
            serviceAgreement: true,
          },
          pdfBase64,
        },
      });
      const failed = error || (res && (res as Row).error);
      if (failed) {
        log("agreement store failed", { failed: String((failed as Row)?.message || failed) });
        return json({ ok: false, error: "agreement_store_failed" }, 500);
      }

      await supabase.from("events").insert({
        event_type: "booking.pay_page_signed",
        booking_id: booking.id,
        source: "booking-pay-page",
        summary: `Customer signed the service agreement on the pay page (${name})`,
        data: { agreementId: (res as Row)?.id || null },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, signed: true });
    }

    // ── intent: mint/reuse the deposit PaymentIntent (LEGAL-GATED) ──────
    if (action === "intent") {
      if (booking.payment_received_at) {
        return json({ ok: true, paid: true, booking: summarize(booking, true) });
      }

      // HARD GATE — no accepted agreement, no payment. Ever.
      const signed = await agreementAccepted(supabase, booking.id);
      if (!signed) return json({ ok: false, error: "agreement_required" }, 403);

      const amountCents = depositDueCents(booking);
      if (amountCents <= 0) return json({ ok: false, error: "nothing_due" }, 400);

      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ ok: false, error: "payments_not_configured" }, 500);
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // Reuse a pending PI when we already minted one for this booking.
      if (booking.payment_intent_id) {
        try {
          const existing = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
          if (existing.status === "succeeded") {
            return json({ ok: true, paid: true, booking: summarize(booking, true) });
          }
          if (
            ["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status) &&
            existing.amount === amountCents
          ) {
            return json({ ok: true, clientSecret: existing.client_secret, amountCents });
          }
        } catch (_) { /* stale/foreign PI — mint a fresh one below */ }
      }

      // Resolve/create the Stripe customer (the saved-card anchor the
      // prepare-completion-hold cron looks up later).
      let customerId: string | null =
        typeof booking.customer_id === "string" && booking.customer_id.startsWith("cus_")
          ? booking.customer_id
          : null;
      if (!customerId && booking.email) {
        const found = await stripe.customers.list({ email: booking.email, limit: 1 });
        customerId = found.data[0]?.id ?? null;
      }
      if (!customerId) {
        const created = await stripe.customers.create({
          email: booking.email || undefined,
          name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined,
          phone: booking.phone || undefined,
          address: booking.address
            ? { line1: booking.address, city: booking.city, state: booking.state, postal_code: booking.zip_code }
            : undefined,
        });
        customerId = created.id;
      }

      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "usd",
        customer: customerId,
        // Save the card for the later manual-capture pre-auth hold.
        setup_future_usage: "off_session",
        automatic_payment_methods: { enabled: true },
        receipt_email: booking.email || undefined,
        description: `NOV-${String(booking.booking_number || "").padStart(5, "0")} — Deposit (Novara Cleaning)`,
        metadata: {
          booking_id: booking.id,
          booking_number: String(booking.booking_number || ""),
          purpose: "deposit_preauth",
          source: "pay_page",
        },
      });

      // Stamp so stripe-webhook (payment_intent.succeeded → confirm) and
      // prepare-completion-hold (customer lookup) both just work.
      await supabase
        .from("bookings")
        .update({ payment_intent_id: pi.id, customer_id: customerId })
        .eq("id", booking.id);

      return json({ ok: true, clientSecret: pi.client_secret, amountCents });
    }

    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[booking-pay-page]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
