import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[INCOMING-SMS] ${step}${detailsStr}`);
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Handle incoming SMS from Twilio webhook
 * Configure Twilio to send webhooks to: 
 * https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/handle-incoming-sms
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Twilio sends data as form-urlencoded
    const formData = await req.formData();
    const from = formData.get("From") as string;
    const body = (formData.get("Body") as string || "").trim().toUpperCase();
    const messageSid = formData.get("MessageSid") as string;

    if (!from || !body) {
      throw new Error("Missing From or Body in webhook");
    }

    const normalizedPhone = normalizePhone(from);
    logStep("Received SMS", { from: normalizedPhone.slice(-4), body, messageSid });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Log incoming message
    await supabase.from("incoming_sms_logs").insert({
      from_phone: normalizedPhone,
      message: body,
      twilio_message_sid: messageSid,
      processed: false
    });

    // Find cleaner by phone
    const { data: cleaner } = await supabase
      .from("cleaners")
      .select("id, first_name, sms_notifications_enabled")
      .eq("phone", normalizedPhone)
      .single();

    let responseMessage = "";

    // Handle different commands
    switch (true) {
      case body === "STOP" || body === "UNSUBSCRIBE" || body === "CANCEL":
        // Opt out of SMS
        if (cleaner) {
          await supabase
            .from("cleaners")
            .update({ sms_notifications_enabled: false })
            .eq("id", cleaner.id);
        }
        
        // Record opt-out
        await supabase.from("sms_opt_outs").insert({
          phone: normalizedPhone,
          cleaner_id: cleaner?.id,
          opted_out_at: new Date().toISOString()
        });
        
        responseMessage = "You've been unsubscribed from Novara SMS. Reply START to re-subscribe.";
        logStep("Processed opt-out", { cleanerId: cleaner?.id });
        break;

      case body === "START" || body === "SUBSCRIBE" || body === "YES":
        // Opt back in
        if (cleaner) {
          await supabase
            .from("cleaners")
            .update({ sms_notifications_enabled: true })
            .eq("id", cleaner.id);
        }
        
        responseMessage = "You're now subscribed to Novara SMS notifications. Reply STOP to unsubscribe.";
        logStep("Processed opt-in", { cleanerId: cleaner?.id });
        break;

      case body === "HELP" || body === "INFO":
        responseMessage = `Novara SMS Commands:
ACCEPT - Accept pending job offer
DECLINE - Decline pending job offer
STOP - Unsubscribe from SMS
START - Resubscribe to SMS
STATUS - Check your status

Need help? Call (202) 555-0123`;
        break;

      case body === "STATUS":
        if (cleaner) {
          // Get pending offers count
          const { count: offersCount } = await supabase
            .from("job_assignments")
            .select("*", { count: "exact", head: true })
            .eq("cleaner_id", cleaner.id)
            .eq("status", "Offered");

          // Get confirmed jobs count
          const { count: confirmedCount } = await supabase
            .from("job_assignments")
            .select("*", { count: "exact", head: true })
            .eq("cleaner_id", cleaner.id)
            .eq("status", "Confirmed");

          responseMessage = `Hi ${cleaner.first_name}! 
📋 Pending offers: ${offersCount || 0}
✅ Confirmed jobs: ${confirmedCount || 0}

Reply HELP for more commands.`;
        } else {
          responseMessage = "Phone not registered. Visit contractor.novaracleaning.com to sign up.";
        }
        break;

      case body === "ACCEPT" || body === "A" || body === "YES":
        // Accept most recent pending offer
        if (cleaner) {
          const { data: pendingOffer } = await supabase
            .from("job_assignments")
            .select("id, jobs(city, start_datetime)")
            .eq("cleaner_id", cleaner.id)
            .eq("status", "Offered")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingOffer) {
            await supabase
              .from("job_assignments")
              .update({ 
                status: "Confirmed",
                responded_at: new Date().toISOString()
              })
              .eq("id", pendingOffer.id);

            // Update cleaner metrics
            const { data: metrics } = await supabase
              .from("cleaners")
              .select("total_offers_received, total_offers_accepted")
              .eq("id", cleaner.id)
              .single();

            await supabase
              .from("cleaners")
              .update({
                total_offers_received: (metrics?.total_offers_received || 0) + 1,
                total_offers_accepted: (metrics?.total_offers_accepted || 0) + 1
              })
              .eq("id", cleaner.id);

            const jobDate = pendingOffer.jobs?.start_datetime 
              ? new Date(pendingOffer.jobs.start_datetime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              : 'TBD';

            responseMessage = `✅ Job accepted! ${pendingOffer.jobs?.city || ''} on ${jobDate}. Check app for details.`;
            logStep("Job accepted via SMS", { assignmentId: pendingOffer.id });
          } else {
            responseMessage = "No pending job offers found. Check the app for details.";
          }
        } else {
          responseMessage = "Phone not registered. Visit contractor.novaracleaning.com to sign up.";
        }
        break;

      case body === "DECLINE" || body === "D" || body === "NO" || body === "N":
        // Decline most recent pending offer
        if (cleaner) {
          const { data: pendingOffer } = await supabase
            .from("job_assignments")
            .select("id, jobs(city, start_datetime)")
            .eq("cleaner_id", cleaner.id)
            .eq("status", "Offered")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingOffer) {
            await supabase
              .from("job_assignments")
              .update({ 
                status: "Declined",
                responded_at: new Date().toISOString()
              })
              .eq("id", pendingOffer.id);

            // Update cleaner metrics
            const { data: metrics } = await supabase
              .from("cleaners")
              .select("total_offers_received")
              .eq("id", cleaner.id)
              .single();

            await supabase
              .from("cleaners")
              .update({
                total_offers_received: (metrics?.total_offers_received || 0) + 1
              })
              .eq("id", cleaner.id);

            responseMessage = "❌ Job declined. We'll send you more offers soon.";
            logStep("Job declined via SMS", { assignmentId: pendingOffer.id });
          } else {
            responseMessage = "No pending job offers to decline.";
          }
        } else {
          responseMessage = "Phone not registered. Visit contractor.novaracleaning.com to sign up.";
        }
        break;

      default:
        // Check if it's a verification code (6 digits)
        if (/^\d{6}$/.test(body)) {
          // Try to verify the code
          const { data: verification } = await supabase
            .from("phone_verification_codes")
            .select("*")
            .eq("phone", normalizedPhone)
            .eq("code", body)
            .eq("used", false)
            .maybeSingle();

          if (verification) {
            const expiresAt = new Date(verification.expires_at);
            if (new Date() <= expiresAt) {
              // Valid code - verify the phone
              await supabase
                .from("phone_verification_codes")
                .update({ used: true, verified_at: new Date().toISOString() })
                .eq("id", verification.id);

              if (verification.cleaner_id) {
                await supabase
                  .from("cleaners")
                  .update({ 
                    phone_verified: true, 
                    phone_verified_at: new Date().toISOString(),
                    sms_notifications_enabled: true
                  })
                  .eq("id", verification.cleaner_id);
              }

              responseMessage = "✅ Phone verified! You'll now receive job offers via SMS. Reply HELP for commands.";
              logStep("Phone verified via SMS reply", { cleanerId: verification.cleaner_id });
            } else {
              responseMessage = "This code has expired. Please request a new verification code.";
            }
          } else {
            responseMessage = "Invalid code. Reply HELP for commands or check the app.";
          }
        } else {
          responseMessage = "Unrecognized command. Reply HELP for available commands.";
        }
    }

    // Mark message as processed
    await supabase
      .from("incoming_sms_logs")
      .update({ processed: true, response_sent: responseMessage })
      .eq("twilio_message_sid", messageSid);

    // Send response via Twilio TwiML
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`;

    return new Response(twimlResponse, { 
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/xml" 
      } 
    });

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    
    // Return empty TwiML on error to prevent Twilio retries
    const twimlError = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, something went wrong. Please try again or contact support.</Message>
</Response>`;

    return new Response(twimlError, { 
      status: 200, // Return 200 to prevent Twilio retries
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/xml" 
      } 
    });
  }
});
