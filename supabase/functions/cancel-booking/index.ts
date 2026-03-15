import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[CANCEL-BOOKING] ${step}`, details ? JSON.stringify(details) : '');
};

interface CancelRequest {
  bookingId: string;
  cancelReason: string;
  refundType?: 'full' | 'partial' | 'none';
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  try {
    const { bookingId, cancelReason, refundType = 'full' }: CancelRequest = await req.json();
    logStep("Processing cancellation", { bookingId, cancelReason, refundType });

    // Get booking details
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error(`Booking not found: ${bookingError?.message}`);
    }

    // Validate booking can be cancelled
    if (booking.status === 'completed') {
      throw new Error("Cannot cancel completed bookings");
    }
    if (booking.status === 'cancelled') {
      throw new Error("Booking is already cancelled");
    }

    logStep("Booking validated", { status: booking.status });

    // Process refund if payment was made
    let refundAmount = 0;
    if (booking.payment_intent_id && refundType !== 'none') {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(booking.payment_intent_id);
        
        if (paymentIntent.status === 'succeeded') {
          // Calculate refund amount based on policy
          const totalPaidCents = booking.final_charge_cents || booking.total_estimate_cents;
          
          if (refundType === 'full') {
            refundAmount = totalPaidCents;
          } else if (refundType === 'partial') {
            // Partial refund: 50% if cancelled within 24 hours
            const serviceDate = new Date(booking.service_date);
            const now = new Date();
            const hoursUntilService = (serviceDate.getTime() - now.getTime()) / (1000 * 60 * 60);
            
            if (hoursUntilService < 24) {
              refundAmount = Math.floor(totalPaidCents * 0.5);
            } else {
              refundAmount = totalPaidCents;
            }
          }

          if (refundAmount > 0) {
            const refund = await stripe.refunds.create({
              payment_intent: booking.payment_intent_id,
              amount: refundAmount,
            });

            logStep("Refund processed", { 
              refundId: refund.id, 
              amount: refundAmount 
            });
          }
        }
      } catch (stripeError: any) {
        logStep("Refund failed (non-critical)", { error: stripeError.message });
        // Continue with cancellation even if refund fails
      }
    }

    // Update booking status
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'cancelled',
        cancel_reason: cancelReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    if (updateError) throw updateError;

    logStep("Booking status updated to cancelled");

    // Release availability slots
    if (booking.service_date && booking.time_slot) {
      // Release from `availability` table (capacity-based)
      try {
        const { data: slot } = await supabase
          .from('availability')
          .select('capacity')
          .eq('service_date', booking.service_date)
          .eq('time_window', booking.time_slot)
          .maybeSingle();

        if (slot) {
          await supabase
            .from('availability')
            .update({ capacity: slot.capacity + 1 })
            .eq('service_date', booking.service_date)
            .eq('time_window', booking.time_slot);
          logStep("Availability slot released");
        }
      } catch (availErr) {
        logStep("Availability release failed (non-critical)", availErr);
      }

      // Also release from `availability_slots` table if applicable
      try {
        const startTime = booking.time_slot.split(' - ')[0] || booking.time_slot;
        await supabase.rpc('release_time_slot', {
          _date: booking.service_date,
          _start_time: startTime,
        });
        logStep("Availability_slots released via RPC");
      } catch (rpcErr) {
        logStep("release_time_slot RPC failed (non-critical)", rpcErr);
      }
    }

    // If cleaner was assigned, update their stats
    if (booking.cleaner_id) {
      const { data: cleaner } = await supabase
        .from('cleaners')
        .select('total_bookings')
        .eq('id', booking.cleaner_id)
        .single();

      if (cleaner) {
        const { error: cleanerError } = await supabase
          .from('cleaners')
          .update({
            total_bookings: Math.max(0, (cleaner.total_bookings || 1) - 1),
          })
          .eq('id', booking.cleaner_id);

        if (cleanerError) {
          logStep("Failed to update cleaner stats (non-critical)", cleanerError);
        }
      }
    }

    // Delete Google Calendar event if one exists
    if (booking.google_calendar_event_id) {
      try {
        await supabase.functions.invoke('update-google-calendar-event', {
          body: { bookingId, action: 'cancel' },
        });
        logStep("Google Calendar event deleted");
      } catch (calError) {
        logStep("Failed to delete calendar event (non-critical)", calError);
      }
    }

    // Send cancellation confirmation email
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: {
          email: booking.email,
          type: 'cancellation',
          bookingData: {
            ...booking,
            cancel_reason: cancelReason,
            refund_amount: refundAmount > 0 ? `$${(refundAmount / 100).toFixed(2)}` : 'None',
          },
        },
      });
      logStep("Cancellation email sent");
    } catch (emailError) {
      logStep("Failed to send email (non-critical)", emailError);
    }

    // Trigger Zapier webhook
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Booking cancelled successfully',
        refundAmount: refundAmount > 0 ? `$${(refundAmount / 100).toFixed(2)}` : 'None',
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
