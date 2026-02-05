import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
});

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, reason } = await req.json();
    logStep("Request received", { bookingId, reason });

    if (!bookingId) {
      throw new Error("Booking ID is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the booking
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error("Booking not found");
    }

    logStep("Booking found", { 
      status: booking.status, 
      usesCredit: booking.uses_credit,
      paymentIntentId: booking.payment_intent_id 
    });

    // Check if booking can be cancelled
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      throw new Error(`Cannot cancel a ${booking.status} booking`);
    }

    // Calculate cancellation window (24 hours before service)
    const serviceDate = new Date(`${booking.service_date}T08:00:00`);
    const hoursUntilService = (serviceDate.getTime() - Date.now()) / (1000 * 60 * 60);
    const isLastMinute = hoursUntilService < 24;

    logStep("Cancellation timing", { hoursUntilService, isLastMinute });

    // Process refund if payment was made and not a credit booking
    let refundResult = null;
    if (booking.payment_intent_id && !booking.uses_credit) {
      try {
        if (isLastMinute) {
          // Late cancellation - partial refund (50%)
          const refundAmount = Math.floor(booking.total_estimate_cents * 0.5);
          const refund = await stripe.refunds.create({
            payment_intent: booking.payment_intent_id,
            amount: refundAmount,
            reason: 'requested_by_customer',
          });
          refundResult = { 
            type: 'partial', 
            amount: refundAmount, 
            refundId: refund.id 
          };
          logStep("Partial refund issued", refundResult);
        } else {
          // Full refund
          const refund = await stripe.refunds.create({
            payment_intent: booking.payment_intent_id,
            reason: 'requested_by_customer',
          });
          refundResult = { 
            type: 'full', 
            amount: booking.total_estimate_cents, 
            refundId: refund.id 
          };
          logStep("Full refund issued", refundResult);
        }
      } catch (refundError: any) {
        logStep("Refund failed (non-blocking)", { error: refundError.message });
        // Continue with cancellation even if refund fails
      }
    }

    // Restore credit if booking used a membership credit
    if (booking.uses_credit) {
      const { error: creditError } = await supabase
        .from('membership_credits')
        .update({
          credits_remaining: supabase.rpc('increment_credits', { email: booking.email }),
          credits_used: supabase.rpc('decrement_credits', { email: booking.email }),
        })
        .eq('email', booking.email);

      // Alternative: direct increment
      await supabase.rpc('restore_booking_credit', { p_booking_id: bookingId });
      logStep("Credit restored");
    }

    // Update booking status
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: reason || 'Customer requested',
        cancelled_at: new Date().toISOString(),
        refund_amount_cents: refundResult?.amount || 0,
        refund_type: refundResult?.type || null,
      })
      .eq('id', bookingId);

    if (updateError) {
      throw new Error("Failed to update booking status");
    }

    // Send cancellation SMS
    try {
      await supabase.functions.invoke('send-twilio-sms', {
        body: {
          type: 'cancellation',
          bookingId: bookingId,
        },
      });
    } catch (smsError) {
      logStep("SMS send failed (non-blocking)", { error: smsError });
    }

    // Send cancellation email
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: {
          bookingId: bookingId,
          type: 'cancellation',
        },
      });
    } catch (emailError) {
      logStep("Email send failed (non-blocking)", { error: emailError });
    }

    return new Response(
      JSON.stringify({
        success: true,
        booking: {
          id: bookingId,
          status: 'cancelled',
        },
        creditRestored: booking.uses_credit,
        refund: refundResult,
        message: isLastMinute 
          ? 'Booking cancelled with partial refund (late cancellation)'
          : booking.uses_credit 
          ? 'Booking cancelled and credit restored'
          : 'Booking cancelled with full refund',
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
