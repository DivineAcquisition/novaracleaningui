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
        
        // Deduct membership credit if booking uses credit (with idempotency check)
        if (booking.uses_credit && booking.customer_id && booking.status !== 'confirmed') {
          logStep("Deducting membership credit", { customerId: booking.customer_id });
          
          const { data: creditRecord, error: creditFetchError } = await supabase
            .from("membership_credits")
            .select("*")
            .eq("customer_id", booking.customer_id)
            .maybeSingle();

          if (creditFetchError) {
            logStep("Error fetching credit record", creditFetchError);
          } else if (creditRecord && creditRecord.credits_remaining > 0) {
            // Use atomic update to prevent race conditions
            const { error: creditUpdateError } = await supabase
              .from("membership_credits")
              .update({
                credits_used: creditRecord.credits_used + 1,
                credits_remaining: Math.max(0, creditRecord.credits_remaining - 1),
              })
              .eq("customer_id", booking.customer_id)
              .eq("credits_remaining", creditRecord.credits_remaining); // Optimistic locking

            if (creditUpdateError) {
              logStep("Error updating credits", creditUpdateError);
            } else {
              logStep("Credit deducted successfully", { 
                remainingCredits: creditRecord.credits_remaining - 1 
              });
            }
          } else {
            logStep("No credit available or record not found");
          }
        }
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
        break;

      case "canceled":
        newStatus = "cancelled";
        message = "Payment was cancelled";
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

    // Send confirmation email if payment succeeded and not already sent
    if (paymentIntent.status === "succeeded" && booking.status !== 'confirmed') {
      logStep("Sending confirmation emails", { email: booking.email });
      
      try {
        // Send booking confirmation
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            type: 'confirmation',
            email: booking.email,
            data: {
              firstName: booking.first_name,
              lastName: booking.last_name,
              bookingId: booking.id,
              serviceDate: booking.service_date,
              timeSlot: booking.time_slot,
              serviceType: booking.service_type,
              homeSize: booking.home_size_id,
              address: booking.address,
              city: booking.city,
              state: booking.state,
              zipCode: booking.zip_code,
              totalAmount: booking.total_estimate_cents,
              depositAmount: booking.deposit_cents,
              balanceAmount: booking.total_estimate_cents - (booking.payment_option === 'full' ? booking.total_estimate_cents - (booking.full_payment_discount || 0) : booking.deposit_cents),
              paymentOption: booking.payment_option,
              useCredit: booking.uses_credit,
              addOns: booking.add_ons,
            },
          }),
        });

        // Send payment receipt
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({
            type: 'payment_receipt',
            email: booking.email,
            data: {
              firstName: booking.first_name,
              lastName: booking.last_name,
              bookingId: booking.id,
              serviceDate: booking.service_date,
              timeSlot: booking.time_slot,
              serviceType: booking.service_type,
              totalAmount: booking.payment_option === 'full' ? booking.total_estimate_cents - (booking.full_payment_discount || 0) : booking.deposit_cents,
              balanceAmount: booking.payment_option === 'deposit' ? booking.total_estimate_cents - booking.deposit_cents : 0,
              paymentOption: booking.payment_option,
            },
          }),
        });

        logStep("Confirmation emails sent successfully");
      } catch (emailError) {
        logStep("Error sending emails (non-blocking)", { error: emailError });
        // Don't fail the whole request if emails fail
      }
    }

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
