import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");

// Active Telnyx numbers on the Novara account (May 2026):
//   • +18334432004 — toll-free (preferred for outbound transactional SMS,
//                   no 10DLC campaign required, higher throughput)
//   • +14433838055 — local MD long-code (fallback)
//
// We try them in order: env override → toll-free → local. If Telnyx
// rejects a sender as "Invalid source number" (e.g. the env var got
// pointed at a number that's no longer on the account), we automatically
// retry with the next known-good sender so a stale secret can't take
// SMS delivery down.
const ENV_TELNYX_FROM = Deno.env.get("TELNYX_PHONE_NUMBER");
const TELNYX_SENDERS: string[] = Array.from(new Set([
  ENV_TELNYX_FROM,
  "+18334432004",
  "+14433838055",
].filter((v): v is string => Boolean(v && v.trim()))));

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

    // Try each known-good sender in order. Auto-retry only on errors
    // that imply the sender itself is bad ("Invalid source number" /
    // "from number is not valid"). For any other Telnyx error
    // (rate limit, recipient unreachable, etc.) bail immediately so we
    // don't spam Telnyx with retries.
    let lastErrorDetail = "No sender configured";
    let lastErrorStatus = 500;
    let succeeded = false;
    let messageId: string | undefined;
    let messageCost: number = 0;
    let messageStatus: string = "sent";
    let usedSender: string = TELNYX_SENDERS[0] || "";

    for (const candidate of TELNYX_SENDERS) {
      const requestBody = { from: candidate, to: recipient, text: message };
      const telnyxResponse = await fetch(telnyxUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${telnyxApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const telnyxData = await telnyxResponse.json().catch(() => ({}));

      if (telnyxResponse.ok) {
        succeeded = true;
        usedSender = candidate;
        messageId = telnyxData.data?.id;
        messageCost = telnyxData.data?.cost?.amount || 0;
        messageStatus = telnyxData.data?.to?.[0]?.status || "sent";
        console.log(`[SMS] Sent via ${candidate}. ID: ${messageId}`);
        break;
      }

      lastErrorDetail =
        telnyxData.errors?.[0]?.detail ||
        telnyxData.errors?.[0]?.title ||
        `HTTP ${telnyxResponse.status}`;
      lastErrorStatus = telnyxResponse.status;
      console.warn(`[SMS] Sender ${candidate} rejected: ${lastErrorDetail}`);

      // Only retry the next sender on sender-specific errors.
      const isSenderError = /invalid source number|from number|not valid|not authorized|messaging_profile|10dlc/i.test(
        lastErrorDetail,
      );
      if (!isSenderError) break;
    }

    if (!succeeded) {
      throw new Error(`Telnyx error: ${lastErrorDetail}`);
    }

    if (logEntry) {
      await supabase
        .from("sms_logs")
        .update({
          status: "sent",
          provider_message_id: messageId,
          cost: messageCost,
          error_message: null,
        })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId,
        status: messageStatus,
        from: usedSender,
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
