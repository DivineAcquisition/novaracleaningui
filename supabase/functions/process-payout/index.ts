import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { 
  getEstimatedHours, 
  calculateCleanerPayout,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS 
} from "../_shared/payout-utils.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PROCESS-PAYOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    
    logStep("Processing payout for booking", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Get booking and cleaner details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        cleaners (
          id,
          stripe_account_id,
          payouts_enabled,
          first_name,
          last_name,
          email,
          completed_bookings,
          total_earnings_cents
        )
      `)
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    const cleaner = booking.cleaners;
    
    if (!cleaner || !cleaner.stripe_account_id) {
      throw new Error("Cleaner not properly configured");
    }

    if (!cleaner.payouts_enabled) {
      throw new Error("Cleaner payouts not enabled");
    }

    if (booking.payout_status === "completed") {
      logStep("Payout already processed");
      return new Response(
        JSON.stringify({ success: true, message: "Payout already completed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    logStep("Booking and cleaner validated");

    // Recalculate cleaner payout using hourly rate at payout time
    const estimatedHours = booking.estimated_duration_hours || getEstimatedHours(booking.home_size_id);
    const cleanerHourlyRateCents = booking.cleaner_hourly_rate_cents || DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    const cleanerPayoutCents = calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);
    const platformFeeCents = booking.total_estimate_cents - cleanerPayoutCents;

    logStep("Recalculated payout (hourly-based)", {
      estimatedHours,
      hourlyRate: cleanerHourlyRateCents / 100,
      cleanerPayoutCents,
      platformFeeCents,
      totalAmount: booking.total_estimate_cents
    });

    // Create payout record
    const { data: payoutRecord, error: payoutInsertError } = await supabase
      .from("payouts")
      .insert({
        booking_id: bookingId,
        cleaner_id: cleaner.id,
        total_booking_amount_cents: booking.total_estimate_cents,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        stripe_account_id: cleaner.stripe_account_id,
        status: "processing",
      })
      .select()
      .single();

    if (payoutInsertError) throw payoutInsertError;

    logStep("Created payout record", { payoutId: payoutRecord.id });

    // Update booking payout status
    await supabase
      .from("bookings")
      .update({ payout_status: "processing" })
      .eq("id", bookingId);

    // Create Stripe transfer
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
          estimated_hours: String(estimatedHours),
          hourly_rate_cents: String(cleanerHourlyRateCents),
        },
      });

      logStep("Transfer created", { transferId: transfer.id });

      // Update payout record with success
      await supabase
        .from("payouts")
        .update({
          status: "completed",
          stripe_transfer_id: transfer.id,
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutRecord.id);

      // Update booking payout status
      await supabase
        .from("bookings")
        .update({ payout_status: "completed" })
        .eq("id", bookingId);

      // Update cleaner earnings using recalculated payout amount
      await supabase
        .from("cleaners")
        .update({
          completed_bookings: cleaner.completed_bookings + 1,
          total_earnings_cents: cleaner.total_earnings_cents + cleanerPayoutCents,
        })
        .eq("id", cleaner.id);

      logStep("Payout completed successfully");

      return new Response(
        JSON.stringify({
          success: true,
          transfer_id: transfer.id,
          amount_cents: cleanerPayoutCents,
          amount_dollars: (cleanerPayoutCents / 100).toFixed(2),
          estimated_hours: estimatedHours,
          hourly_rate: cleanerHourlyRateCents / 100,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    } catch (transferError) {
      const errorMessage = transferError instanceof Error ? transferError.message : String(transferError);
      logStep("Transfer failed", { error: errorMessage });

      // Update payout record with failure
      await supabase
        .from("payouts")
        .update({
          status: "failed",
          failed_reason: errorMessage,
          retry_count: payoutRecord.retry_count + 1,
        })
        .eq("id", payoutRecord.id);

      // Update booking payout status
      await supabase
        .from("bookings")
        .update({ payout_status: "failed" })
        .eq("id", bookingId);

      throw transferError;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
