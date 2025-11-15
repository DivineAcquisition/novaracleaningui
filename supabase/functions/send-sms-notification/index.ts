import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const messageBirdAccessKey = Deno.env.get("MESSAGEBIRD_ACCESS_KEY");
const messageBirdOriginator = Deno.env.get("MESSAGEBIRD_ORIGINATOR");

interface SMSRequest {
  toPhone: string;
  message: string;
  type: "job_offer" | "reminder" | "confirmation" | "verification";
  jobAssignmentId?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  let lastRequest: SMSRequest | null = null;
  let logEntryId: string | null = null;

  try {
    const { toPhone, message, type, jobAssignmentId }: SMSRequest = await req.json();
    lastRequest = { toPhone, message, type, jobAssignmentId };

    console.log(`[SMS] Sending ${type} to ${toPhone}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Create log entry
    const { data: logEntry, error: logError } = await supabase
      .from("sms_logs")
      .insert({
        to_phone: toPhone,
        message,
        type,
        job_assignment_id: jobAssignmentId,
        status: "pending"
      })
      .select()
      .single();

    if (logEntry?.id) {
      logEntryId = logEntry.id;
    }
    if (logError) {
      console.error("Failed to create SMS log:", logError);
    }

    // Send SMS via MessageBird
    const messageBirdUrl = "https://rest.messagebird.com/messages";
    const recipient = normalizePhone(toPhone);
    const requestBody = {
      originator: messageBirdOriginator,
      recipients: [recipient],
      body: message,
    };

    const messageBirdResponse = await fetch(messageBirdUrl, {
      method: "POST",
      headers: {
        "Authorization": `AccessKey ${messageBirdAccessKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const messageBirdData = await messageBirdResponse.json();

    if (!messageBirdResponse.ok) {
      throw new Error(`MessageBird error: ${messageBirdData.errors?.[0]?.description || "Unknown error"}`);
    }

    console.log(`[SMS] Sent successfully. ID: ${messageBirdData.id}`);

    // Update log with success
    if (logEntry) {
      await supabase
        .from("sms_logs")
        .update({
          status: "sent",
          provider_message_id: messageBirdData.id,
          cost: messageBirdData.price?.amount || 0
        })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: messageBirdData.id,
        status: messageBirdData.recipients?.items?.[0]?.status || "sent"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[SMS] Error:", error);

    // Try to update log with error
    try {
      const { toPhone, jobAssignmentId } = await req.json();
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      await supabase
        .from("sms_logs")
        .update({
          status: "failed",
          error_message: error.message
        })
        .eq("to_phone", toPhone)
        .eq("job_assignment_id", jobAssignmentId)
        .eq("status", "pending");
    } catch (logError) {
      console.error("[SMS] Failed to update error log:", logError);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
