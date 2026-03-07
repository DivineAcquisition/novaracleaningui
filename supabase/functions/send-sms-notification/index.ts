import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
const telnyxPhoneNumber = Deno.env.get("TELNYX_PHONE_NUMBER") || "+18337002611";

interface SMSRequest {
  toPhone: string;
  message: string;
  type: "job_offer" | "reminder" | "confirmation" | "verification";
  jobAssignmentId?: string;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return digits.startsWith('+') ? digits : `+${digits}`;
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

    const telnyxUrl = "https://api.telnyx.com/v2/messages";
    const recipient = normalizePhone(toPhone);
    const requestBody = {
      from: telnyxPhoneNumber,
      to: recipient,
      text: message,
    };

    const telnyxResponse = await fetch(telnyxUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${telnyxApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const telnyxData = await telnyxResponse.json();

    if (!telnyxResponse.ok) {
      const errorDetail = telnyxData.errors?.[0]?.detail || telnyxData.errors?.[0]?.title || "Unknown error";
      throw new Error(`Telnyx error: ${errorDetail}`);
    }

    const messageId = telnyxData.data?.id;
    console.log(`[SMS] Sent successfully. ID: ${messageId}`);

    if (logEntry) {
      await supabase
        .from("sms_logs")
        .update({
          status: "sent",
          provider_message_id: messageId,
          cost: telnyxData.data?.cost?.amount || 0
        })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
        status: telnyxData.data?.to?.[0]?.status || "sent"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[SMS] Error:", error);

    try {
      if (logEntryId) {
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
          .eq("id", logEntryId);
      }
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
