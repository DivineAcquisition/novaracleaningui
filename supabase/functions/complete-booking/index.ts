import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[COMPLETE-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    logStep("Marking booking complete", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify requester is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    
    if (!userId) throw new Error("Not authenticated");
    
    // Check if user is admin
    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    
    if (!roleCheck) {
      throw new Error("Unauthorized - Admin only");
    }

    // Get booking details
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error("Booking not found");
    }

    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    logStep("Booking validated");

    // Mark booking as completed
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    logStep("Booking marked complete");

    // Send SMS to the assigned cleaner asking them to submit job photos.
    // This fires the moment the service is marked complete.
    try {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("first_name, phone, sms_notifications_enabled")
        .eq("id", booking.cleaner_id)
        .maybeSingle();

      if (cleaner?.phone && cleaner.sms_notifications_enabled !== false) {
        const contractorAppUrl =
          Deno.env.get("CONTRACTOR_APP_URL") ?? "https://contractor.novaracleaning.com";
        const uploadUrl = `${contractorAppUrl}/cleaner/job-photos?booking_id=${bookingId}`;

        const message =
          `🧹 Novara: Job complete! Please upload your before & after photos ` +
          `for ${booking.address || "your last job"} now: ${uploadUrl}`;

        const smsResponse = await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: cleaner.phone,
            message,
            type: "confirmation",
          },
        });

        if (smsResponse.error) {
          logStep("Photo-request SMS failed (non-critical)", { error: smsResponse.error });
        } else {
          logStep("Photo-request SMS sent to cleaner");
        }
      } else {
        logStep("Skipping photo-request SMS (no phone or SMS disabled)");
      }
    } catch (smsError) {
      // Don't fail completion if SMS fails
      logStep("Photo-request SMS error (non-critical)", { error: String(smsError) });
    }

    logStep("Triggering payout");

    // Trigger payout
    const payoutResponse = await supabase.functions.invoke('process-payout', {
      body: { bookingId },
    });

    if (payoutResponse.error) {
      logStep("Payout trigger failed", { error: payoutResponse.error });
    } else {
      logStep("Payout triggered successfully");
    }

    // Trigger Zapier webhook for completed booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      // Log but don't fail the completion if webhook fails
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking completed and payout initiated"
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
