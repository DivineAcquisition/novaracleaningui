// ─── process-payout ─────────────────────────────────────────────────────
//
// Releases a Stripe Connect transfer to the cleaner who completed the
// booking and stamps the payouts ledger.
//
// Called from:
//   * the bookings_auto_payout_on_completion trigger (status → completed)
//   * the admin Payroll page "Pay now" button (one-click manual release)
//   * the admin Cleaners drawer "Trigger payout" button
//
// Idempotent — short-circuits if booking.payout_status is already
// 'completed' or 'processing', and if a payouts row already exists with
// status in ('completed','processing').

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  getEstimatedHours,
  calculateCleanerPayout,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS,
} from "../_shared/payout-utils.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

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
        `*, cleaners(id, stripe_account_id, payouts_enabled, first_name, last_name, email, phone, completed_bookings, total_earnings_cents)`,
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

    const estimatedHours =
      booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const cleanerHourlyRateCents =
      booking.cleaner_hourly_rate_cents || DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const cleanerPayoutCents =
      booking.cleaner_payout_cents ||
      calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);
    const platformFeeCents = Math.max(
      0,
      (booking.final_charge_cents || booking.total_estimate_cents || 0) -
        cleanerPayoutCents,
    );

    logStep("Computed payout", {
      estimatedHours,
      hourlyRate: cleanerHourlyRateCents / 100,
      cleanerPayoutCents,
      platformFeeCents,
    });

    const { data: payoutRecord, error: payoutInsertError } = await supabase
      .from("payouts")
      .insert({
        booking_id: bookingId,
        cleaner_id: cleaner.id,
        total_booking_amount_cents:
          booking.final_charge_cents || booking.total_estimate_cents || 0,
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
        description: `Payout for booking ${bookingId.substring(0, 8)} - ${estimatedHours}hrs @ $${cleanerHourlyRateCents / 100}/hr`,
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
