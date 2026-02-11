import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { payment_intent_id } = await req.json();
    
    if (!payment_intent_id) {
      logStep("No payment intent ID provided");
      return new Response(
        JSON.stringify({ error: "Payment intent ID is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Verifying payment", { payment_intent_id });

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Retrieve PaymentIntent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    logStep("Payment intent retrieved", { status: paymentIntent.status });

    // Find booking by payment_intent_id
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("payment_intent_id", payment_intent_id)
      .maybeSingle();

    if (bookingError) {
      logStep("Error fetching booking", { error: bookingError });
      return new Response(
        JSON.stringify({ error: "Error fetching booking" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!booking) {
      logStep("Booking not found");
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    logStep("Booking found", { bookingId: booking.id, currentStatus: booking.status });

    // Idempotency check - if already confirmed, don't reprocess
    if (booking.status === 'confirmed') {
      logStep("Booking already confirmed - skipping reprocessing");
      return new Response(
        JSON.stringify({
          success: true,
          status: paymentIntent.status,
          message: "Booking already confirmed",
          booking,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Handle different payment statuses
    let newStatus = booking.status;
    let message = "";

    switch (paymentIntent.status) {
      case "succeeded":
        newStatus = "confirmed";
        message = "Payment confirmed successfully";
        // Credit deduction is handled by stripe-webhook to avoid race conditions
        break;

      case "processing":
        newStatus = "pending_payment";
        message = "Payment is being processed";
        break;

      case "requires_payment_method":
      case "requires_confirmation":
      case "requires_action":
        newStatus = "pending_payment";
        message = "Payment requires additional action";
        
        // Release time slot on payment failure
        if (booking.service_date && booking.time_slot) {
          logStep("Releasing time slot due to failed payment", { 
            date: booking.service_date, 
            timeSlot: booking.time_slot 
          });
          
          // Extract start time from time_slot (format: "8:00 AM - 10:00 AM")
          const startTime = booking.time_slot.split(' - ')[0];
          
          try {
            await supabase.rpc('release_time_slot', {
              _date: booking.service_date,
              _start_time: startTime
            });
            logStep("Time slot released successfully");
          } catch (releaseError) {
            logStep("Error releasing time slot (non-blocking)", { error: releaseError });
          }
        }
        break;

      case "canceled":
        newStatus = "cancelled";
        message = "Payment was cancelled";
        
        // Release time slot on payment failure
        if (booking.service_date && booking.time_slot) {
          logStep("Releasing time slot due to cancelled payment", { 
            date: booking.service_date, 
            timeSlot: booking.time_slot 
          });
          
          // Extract start time from time_slot (format: "8:00 AM - 10:00 AM")
          const startTime = booking.time_slot.split(' - ')[0];
          
          try {
            await supabase.rpc('release_time_slot', {
              _date: booking.service_date,
              _start_time: startTime
            });
            logStep("Time slot released successfully");
          } catch (releaseError) {
            logStep("Error releasing time slot (non-blocking)", { error: releaseError });
          }
        }
        break;

      default:
        newStatus = "pending_payment";
        message = `Payment status: ${paymentIntent.status}`;
    }

    // Update booking status only if status changed
    if (newStatus !== booking.status) {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({ status: newStatus })
        .eq("id", booking.id)
        .eq("status", booking.status); // Optimistic locking

      if (updateError) {
        logStep("Error updating booking status", updateError);
        throw updateError;
      }

      logStep("Booking updated", { bookingId: booking.id, oldStatus: booking.status, newStatus });
    } else {
      logStep("Booking status unchanged", { bookingId: booking.id, status: booking.status });
    }

    // Email sending removed — stripe-webhook is the single source of truth for all downstream actions

    return new Response(
      JSON.stringify({
        success: paymentIntent.status === "succeeded",
        status: paymentIntent.status,
        message,
        booking: {
          ...booking,
          status: newStatus,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in verify-payment", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
