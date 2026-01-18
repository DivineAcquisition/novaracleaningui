import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[AUTO-COMPLETE-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId, triggeredBy, cleanerId } = await req.json();
    logStep("Auto-completing booking", { bookingId, triggeredBy, cleanerId });
    
    if (!bookingId) {
      throw new Error("bookingId is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get booking details with job information
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*, jobs(*)")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error(`Booking not found: ${fetchError?.message || 'Unknown error'}`);
    }

    // Verify booking is in a completable state
    if (booking.status === "completed") {
      logStep("Booking already completed", { bookingId });
      return new Response(
        JSON.stringify({ success: true, message: "Booking already completed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    // Verify associated job is completed (if exists)
    const job = booking.jobs;
    if (job && job.status !== "Completed") {
      logStep("Job not yet completed", { jobStatus: job.status });
      throw new Error("Job not yet completed");
    }

    logStep("Booking validated for auto-completion", { 
      bookingId, 
      cleanerId: booking.cleaner_id,
      jobId: job?.id 
    });

    // Mark booking as completed
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_trigger: triggeredBy || "auto",
      })
      .eq("id", bookingId);

    if (updateError) {
      throw new Error(`Failed to update booking: ${updateError.message}`);
    }

    logStep("Booking marked complete, processing payouts");

    // Get all cleaner assignments for this job to process payouts
    const payoutResults: Array<{ cleanerId: string; success: boolean; data?: any; error?: any }> = [];

    if (job) {
      const { data: assignments } = await supabase
        .from("job_assignments")
        .select("cleaner_id")
        .eq("job_id", job.id)
        .eq("status", "Completed");

      logStep("Found completed assignments", { count: assignments?.length || 0 });

      // Process payout for each cleaner
      for (const assignment of assignments || []) {
        try {
          const payoutResponse = await supabase.functions.invoke('process-payout-for-cleaner', {
            body: { 
              bookingId, 
              cleanerId: assignment.cleaner_id 
            }
          });
          
          payoutResults.push({
            cleanerId: assignment.cleaner_id,
            success: !payoutResponse.error,
            data: payoutResponse.data
          });
          
          logStep("Payout processed", { 
            cleanerId: assignment.cleaner_id,
            success: !payoutResponse.error 
          });
        } catch (payoutError) {
          logStep("Payout failed for cleaner", { 
            cleanerId: assignment.cleaner_id, 
            error: payoutError 
          });
          payoutResults.push({
            cleanerId: assignment.cleaner_id,
            success: false,
            error: payoutError instanceof Error ? payoutError.message : String(payoutError)
          });
        }
      }
    } else {
      // Fallback: process payout for the main cleaner on the booking
      try {
        const payoutResponse = await supabase.functions.invoke('process-payout-for-cleaner', {
          body: { 
            bookingId, 
            cleanerId: booking.cleaner_id 
          }
        });
        
        payoutResults.push({
          cleanerId: booking.cleaner_id,
          success: !payoutResponse.error,
          data: payoutResponse.data
        });
        
        logStep("Payout processed for booking cleaner", { 
          cleanerId: booking.cleaner_id,
          success: !payoutResponse.error 
        });
      } catch (payoutError) {
        logStep("Payout failed", { error: payoutError });
        payoutResults.push({
          cleanerId: booking.cleaner_id,
          success: false,
          error: payoutError instanceof Error ? payoutError.message : String(payoutError)
        });
      }
    }

    // Trigger Zapier webhook for completed booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    // Send completion notification to customer
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: { 
          bookingId,
          templateType: 'booking_completed'
        }
      });
      logStep("Completion email sent to customer");
    } catch (emailError) {
      logStep("Customer email failed (non-critical)", { error: emailError });
    }

    const successfulPayouts = payoutResults.filter(r => r.success).length;
    logStep("Auto-completion finished", { 
      totalPayouts: payoutResults.length,
      successfulPayouts 
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking auto-completed and payouts initiated",
        payoutResults,
        successfulPayouts,
        totalPayouts: payoutResults.length
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
