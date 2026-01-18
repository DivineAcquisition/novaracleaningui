import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { 
  getEstimatedHours, 
  calculateCleanerPayout,
  DEFAULT_CLEANER_HOURLY_RATE_CENTS 
} from "../_shared/payout-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PROCESS-PAYOUT-FOR-CLEANER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, cleanerId } = await req.json();
    
    if (!bookingId || !cleanerId) {
      throw new Error("bookingId and cleanerId are required");
    }

    logStep("Processing payout", { bookingId, cleanerId });
    
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message || 'Unknown error'}`);
    }

    // Get cleaner details
    const { data: cleaner, error: cleanerError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("id", cleanerId)
      .single();

    if (cleanerError || !cleaner) {
      throw new Error(`Cleaner not found: ${cleanerError?.message || 'Unknown error'}`);
    }

    if (!cleaner.stripe_account_id) {
      throw new Error("Cleaner has no Stripe account configured");
    }

    if (!cleaner.payouts_enabled) {
      throw new Error("Cleaner payouts not enabled - Stripe onboarding incomplete");
    }

    logStep("Cleaner validated", { 
      cleanerId, 
      stripeAccountId: cleaner.stripe_account_id,
      payoutsEnabled: cleaner.payouts_enabled 
    });

    // Check for existing payout to prevent duplicates
    const { data: existingPayout } = await supabase
      .from("payouts")
      .select("id, status")
      .eq("booking_id", bookingId)
      .eq("cleaner_id", cleanerId)
      .maybeSingle();

    if (existingPayout) {
      logStep("Payout already exists", { 
        payoutId: existingPayout.id, 
        status: existingPayout.status 
      });
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Payout already processed",
          payoutId: existingPayout.id,
          status: existingPayout.status
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate payout amount using estimated hours and hourly rate
    const estimatedHours = booking.estimated_duration_hours || 
                          getEstimatedHours(booking.home_size_id);
    const cleanerHourlyRateCents = booking.cleaner_hourly_rate_cents || 
                                   cleaner.pay_rate_hr_cents || 
                                   DEFAULT_CLEANER_HOURLY_RATE_CENTS;
    
    // Each cleaner gets paid for the full job duration at their hourly rate
    const cleanerPayoutCents = calculateCleanerPayout(estimatedHours, cleanerHourlyRateCents);
    const platformFeeCents = Math.max(0, booking.total_estimate_cents - cleanerPayoutCents);

    logStep("Calculated payout", {
      estimatedHours,
      hourlyRate: cleanerHourlyRateCents / 100,
      cleanerPayoutCents,
      cleanerPayoutDollars: cleanerPayoutCents / 100,
      platformFeeCents
    });

    // Create payout record
    const { data: payoutRecord, error: payoutInsertError } = await supabase
      .from("payouts")
      .insert({
        booking_id: bookingId,
        cleaner_id: cleanerId,
        total_booking_amount_cents: booking.total_estimate_cents,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        stripe_account_id: cleaner.stripe_account_id,
        status: "processing",
        retry_count: 0,
      })
      .select()
      .single();

    if (payoutInsertError) {
      throw new Error(`Failed to create payout record: ${payoutInsertError.message}`);
    }

    logStep("Created payout record", { payoutId: payoutRecord.id });

    // Create Stripe transfer
    try {
      const transfer = await stripe.transfers.create({
        amount: cleanerPayoutCents,
        currency: "usd",
        destination: cleaner.stripe_account_id,
        description: `Payout for booking ${booking.booking_number || bookingId.substring(0, 8)} - ${estimatedHours}hrs @ $${cleanerHourlyRateCents / 100}/hr`,
        metadata: {
          booking_id: bookingId,
          booking_number: booking.booking_number || "",
          cleaner_id: cleanerId,
          cleaner_name: `${cleaner.first_name} ${cleaner.last_name}`,
          payout_id: payoutRecord.id,
          estimated_hours: String(estimatedHours),
          hourly_rate_cents: String(cleanerHourlyRateCents),
        },
      });

      logStep("Stripe transfer created", { transferId: transfer.id });

      // Update payout record with success
      await supabase
        .from("payouts")
        .update({
          status: "completed",
          stripe_transfer_id: transfer.id,
          processed_at: new Date().toISOString(),
        })
        .eq("id", payoutRecord.id);

      // Update cleaner earnings and stats
      await supabase
        .from("cleaners")
        .update({
          completed_bookings: (cleaner.completed_bookings || 0) + 1,
          total_earnings_cents: (cleaner.total_earnings_cents || 0) + cleanerPayoutCents,
          last_payout_at: new Date().toISOString(),
        })
        .eq("id", cleanerId);

      // Update booking payout status
      await supabase
        .from("bookings")
        .update({ payout_status: "completed" })
        .eq("id", bookingId);

      logStep("Database updated with payout success");

      // Send payout confirmation email to cleaner
      try {
        await supabase.functions.invoke('send-cleaner-email', {
          body: {
            cleanerId,
            templateType: 'payout_confirmation',
            data: {
              bookingId,
              bookingNumber: booking.booking_number,
              amount: cleanerPayoutCents,
              transferId: transfer.id,
              transferDate: new Date().toISOString(),
              serviceDate: booking.service_date,
              estimatedHours,
              hourlyRate: cleanerHourlyRateCents / 100
            }
          }
        });
        logStep("Payout confirmation email sent");
      } catch (emailError) {
        logStep("Payout email failed (non-critical)", { error: emailError });
      }

      logStep("Payout completed successfully", {
        cleanerId,
        amount: cleanerPayoutCents / 100,
        transferId: transfer.id
      });

      return new Response(
        JSON.stringify({
          success: true,
          payout_id: payoutRecord.id,
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
          retry_count: (payoutRecord.retry_count || 0) + 1,
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
