// ─── process-payout ─────────────────────────────────────────────────────
//
// Releases a Stripe Connect transfer to the cleaner who completed the
// booking and stamps the payouts ledger.
//
// Called from:
//   * (legacy) the bookings_auto_payout_on_completion trigger — now a no-op
//     skip when source is db_trigger_auto_payout
//   * remaining admin retry paths that still target a booking
//
// Custom Payout / Extra Pay / Run Payroll use pay-cleaner-transfer instead
// (exact cents, Stripe Connect, balance-checked).
//
// Idempotent — short-circuits if booking.payout_status is already
// 'completed' or 'processing', and if a payouts row already exists with
// status in ('completed','processing').

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  calculateCleanerPayoutCents,
  DEFAULT_PAY_PERCENTAGE,
} from "../_shared/payout-utils.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { syncPayoutToAirtable } from "../_shared/airtable.ts";
import { jobValueForPay, customerChargeCents } from "../_shared/reclean.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PROCESS-PAYOUT] ${step}${tail}`);
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, source } = await req.json();
    if (!bookingId) return jsonResponse({ error: "bookingId required" }, 400);

    // Auto-payout on completion is disabled. Money moves only after an admin
    // confirms Custom Payout / Extra Pay and Run Payroll (or Custom Payout
    // confirm) fires an exact-amount Stripe Connect transfer.
    if (source === "db_trigger_auto_payout") {
      logStep("Skipping disabled auto-payout", { bookingId, source });
      return jsonResponse({ skipped: true, reason: "auto_payout_disabled_use_custom_payout" }, 200);
    }

    logStep("Processing payout", { bookingId, source });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return jsonResponse({ error: "STRIPE_SECRET_KEY missing" }, 500);
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `*, cleaners(id, stripe_account_id, payouts_enabled, first_name, last_name, email, phone, completed_bookings, total_earnings_cents, pay_percentage, pay_tier)`,
      )
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      return jsonResponse({ error: "Booking not found" }, 404);
    }

    const cleaner = booking.cleaners as {
      id: string;
      stripe_account_id: string | null;
      payouts_enabled: boolean | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      completed_bookings: number | null;
      total_earnings_cents: number | null;
      pay_percentage: number | null;
      pay_tier: string | null;
    } | null;

    if (!cleaner || !cleaner.stripe_account_id) {
      return jsonResponse(
        { skipped: true, reason: "cleaner not stripe-configured" },
        200,
      );
    }
    if (!cleaner.payouts_enabled) {
      return jsonResponse({ skipped: true, reason: "payouts_disabled" }, 200);
    }

    if (booking.payout_status === "completed") {
      return jsonResponse(
        { skipped: true, reason: "already_completed" },
        200,
      );
    }
    if (booking.payout_status === "processing") {
      return jsonResponse(
        { skipped: true, reason: "already_processing" },
        200,
      );
    }

    // Idempotency: if a successful or in-flight payouts row exists, bail.
    const { data: existingPayouts } = await supabase
      .from("payouts")
      .select("id, status, stripe_transfer_id, cleaner_payout_cents")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1);
    const latest = existingPayouts?.[0];
    if (latest && (latest.status === "completed" || latest.status === "processing")) {
      return jsonResponse(
        { skipped: true, reason: `payout_${latest.status}`, payoutId: latest.id },
        200,
      );
    }

    // Cleaner payout = revenue × pay_percentage. We prefer the value
    // already stamped on bookings.cleaner_payout_cents (set by
    // create-payment-intent at booking time and by complete-booking at
    // completion using the actual assigned cleaner's tier). Fallback
    // computes it fresh from the cleaner's current pay_percentage so a
    // missing column never blocks payout.
    // Re-cleans charge the customer $0; pay is computed from assessed scope
    // value. Never use the $0 customer charge as the payout basis.
    const payBasisCents = jobValueForPay(booking);
    const revenueCents = customerChargeCents(booking);
    const payPercentage = Number(cleaner.pay_percentage) || DEFAULT_PAY_PERCENTAGE;

    // For solo-cleaner bookings we treat cleaner_count = 1. Multi-
    // cleaner jobs already have per-assignment payouts written by
    // complete-booking, so this path only fires for the booking-level
    // ledger of the lead cleaner.
    const cleanerPayoutCents =
      booking.cleaner_payout_cents ||
      calculateCleanerPayoutCents(payBasisCents, payPercentage, 1);
    const platformFeeCents = Math.max(0, revenueCents - cleanerPayoutCents);

    logStep("Computed payout (revenue share)", {
      revenueCents,
      payPercentage,
      cleanerPayoutCents,
      platformFeeCents,
    });

    const { data: payoutRecord, error: payoutInsertError } = await supabase
      .from("payouts")
      .insert({
        booking_id: bookingId,
        cleaner_id: cleaner.id,
        total_booking_amount_cents: payBasisCents,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        stripe_account_id: cleaner.stripe_account_id,
        status: "processing",
      })
      .select()
      .single();
    if (payoutInsertError) throw payoutInsertError;

    await supabase
      .from("bookings")
      .update({ payout_status: "processing" })
      .eq("id", bookingId);

    try {
      const transfer = await stripe.transfers.create({
        amount: cleanerPayoutCents,
        currency: "usd",
        destination: cleaner.stripe_account_id,
        description: `Payout for booking ${bookingId.substring(0, 8)} - ${payPercentage}% revenue share`,
        metadata: {
          booking_id: bookingId,
          cleaner_id: cleaner.id,
          payout_id: payoutRecord.id,
          source: source || "manual",
        },
      });
      logStep("Transfer created", { transferId: transfer.id });

      await supabase
        .from("payouts")
        .update({
          status: "completed",
          stripe_transfer_id: transfer.id,
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutRecord.id);

      await supabase
        .from("bookings")
        .update({ payout_status: "completed" })
        .eq("id", bookingId);

      await supabase
        .from("cleaners")
        .update({
          completed_bookings: (cleaner.completed_bookings || 0) + 1,
          total_earnings_cents:
            (cleaner.total_earnings_cents || 0) + cleanerPayoutCents,
        })
        .eq("id", cleaner.id);

      // Notify the cleaner via GHL SMS. Best-effort.
      try {
        if (cleaner.phone) {
          await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ghl-sms`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
                phone: cleaner.phone,
                firstName: cleaner.first_name,
                message: `💸 Novara payout: $${(cleanerPayoutCents / 100).toFixed(2)} transferred to your Stripe account. Booking ${bookingId.substring(0, 8)}.`,
              }),
            },
          );
        }
      } catch (smsErr) {
        console.warn("[process-payout] payout SMS failed (non-blocking)", smsErr);
      }

      // Airtable insight mirror (payroll). No-ops unless configured.
      try {
        await syncPayoutToAirtable(supabase, payoutRecord.id);
      } catch (airErr) {
        console.warn("[process-payout] Airtable payroll sync failed (non-blocking)", airErr);
      }

      return jsonResponse({
        success: true,
        transfer_id: transfer.id,
        amount_cents: cleanerPayoutCents,
        amount_dollars: (cleanerPayoutCents / 100).toFixed(2),
        payout_id: payoutRecord.id,
      });
    } catch (transferError) {
      const errorMessage =
        transferError instanceof Error
          ? transferError.message
          : String(transferError);
      logStep("Transfer failed", { error: errorMessage });
      await supabase
        .from("payouts")
        .update({
          status: "failed",
          failed_reason: errorMessage,
          retry_count: (payoutRecord.retry_count || 0) + 1,
        })
        .eq("id", payoutRecord.id);
      await supabase
        .from("bookings")
        .update({ payout_status: "failed" })
        .eq("id", bookingId);
      // Mirror the failed payout to Airtable too. No-ops unless configured.
      try {
        await syncPayoutToAirtable(supabase, payoutRecord.id);
      } catch (_) { /* non-blocking */ }
      return jsonResponse(
        { error: errorMessage, payoutId: payoutRecord.id },
        502,
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? (error as { message?: string }).message || JSON.stringify(error)
          : String(error);
    console.error("[process-payout] error", errorMessage, error);
    return jsonResponse({ error: errorMessage }, 500);
  }
});
