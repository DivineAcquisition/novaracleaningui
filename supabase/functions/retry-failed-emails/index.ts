import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RETRY-FAILED-EMAILS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Email retry function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();

    // Find emails ready for retry
    const { data: emailsToRetry, error: fetchError } = await supabase
      .from("email_retry_queue")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", now.toISOString())
      .lt("retry_count", 3) // Max 3 retries
      .order("next_retry_at", { ascending: true })
      .limit(10); // Process 10 at a time

    if (fetchError) {
      logStep("Error fetching emails to retry", fetchError);
      throw fetchError;
    }

    logStep("Found emails to retry", { count: emailsToRetry?.length || 0 });

    if (!emailsToRetry || emailsToRetry.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          retried: 0, 
          message: "No emails to retry" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    let successCount = 0;
    let failCount = 0;
    const errors: any[] = [];

    for (const emailItem of emailsToRetry) {
      logStep("Retrying email", { 
        id: emailItem.id, 
        type: emailItem.email_type,
        attempt: emailItem.retry_count + 1 
      });

      try {
        // Update status to retrying
        await supabase
          .from("email_retry_queue")
          .update({ status: "retrying", last_attempt_at: now.toISOString() })
          .eq("id", emailItem.id);

        // Attempt to send the email
        const emailAddress = emailItem.email_address || emailItem.recipient_email;
        const emailPayload: any = {
          type: emailItem.email_type,
          email: emailAddress,
        };

        if (emailItem.email_type === 'modification' || emailItem.email_type === 'cancellation') {
          emailPayload.bookingData = emailItem.email_data;
        } else {
          emailPayload.data = emailItem.email_data;
        }

        const { error: emailError } = await supabase.functions.invoke('send-booking-email', {
          body: emailPayload,
        });

        if (emailError) {
          throw emailError;
        }

        // Success - mark as sent
        await supabase
          .from("email_retry_queue")
          .update({ 
            status: "sent", 
            sent_at: now.toISOString() 
          })
          .eq("id", emailItem.id);

        // Update booking confirmation flag if it's a confirmation email
        if (emailItem.email_type === 'confirmation') {
          await supabase
            .from("bookings")
            .update({ 
              confirmation_email_sent: true,
              confirmation_email_sent_at: now.toISOString()
            })
            .eq("id", emailItem.booking_id);
        }

        successCount++;
        logStep("Email sent successfully", { id: emailItem.id });

      } catch (error: any) {
        failCount++;
        const newRetryCount = emailItem.retry_count + 1;
        
        logStep("Email send failed", { 
          id: emailItem.id, 
          error: error.message,
          retryCount: newRetryCount 
        });

        // Calculate exponential backoff: 5 min, 15 min, 45 min
        const backoffMinutes = 5 * Math.pow(3, newRetryCount - 1);
        const nextRetry = new Date(now.getTime() + backoffMinutes * 60 * 1000);

        // Update retry count and schedule next attempt
        const updateData: any = {
          retry_count: newRetryCount,
          last_error: error.message,
          last_attempt_at: now.toISOString(),
          next_retry_at: nextRetry.toISOString(),
        };

        // If max retries reached, mark as failed
        if (newRetryCount >= 3) {
          updateData.status = "failed";
          logStep("Max retries reached", { id: emailItem.id });
        } else {
          updateData.status = "pending";
        }

        await supabase
          .from("email_retry_queue")
          .update(updateData)
          .eq("id", emailItem.id);

        errors.push({
          emailId: emailItem.id,
          bookingId: emailItem.booking_id,
          error: error.message,
          retryCount: newRetryCount,
        });
      }
    }

    logStep("Email retry processing complete", { successCount, failCount });

    return new Response(
      JSON.stringify({
        success: true,
        retried: emailsToRetry.length,
        successful: successCount,
        failed: failCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    logStep("ERROR in retry function", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
