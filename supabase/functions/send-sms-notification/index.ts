import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");

// Active Telnyx numbers on the Novara account (May 2026):
//   • +18334432004 — toll-free (PRIMARY)
//   • +14433838055 — local MD long-code (FALLBACK)
// env override → toll-free → local. Update TELNYX_PHONE_NUMBER in Supabase
// secrets to a different number if ops moves the primary sender.
const ENV_TELNYX_FROM = Deno.env.get("TELNYX_PHONE_NUMBER");
// Optional Telnyx messaging-profile id. When set (and no explicit `from`
// number is available), Telnyx picks a sender from the profile's number
// pool. Referenced below; must be declared or every send throws a
// ReferenceError before the message is ever dispatched.
const TELNYX_MESSAGING_PROFILE_ID = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID");
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
  // Optional override — when set, skips the fallback list and sends from
  // exactly this number. Used by admin diagnostics / health checks to
  // attribute failures to a specific sender. Not used by customer flows.
  fromOverride?: string;
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
  let logEntryId: string | null = null;

  try {
    const { toPhone, message, type, jobAssignmentId, fromOverride }: SMSRequest = await req.json();

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

    // Allow the caller to override the sender (used for diagnostic tests).
    // Otherwise fall through to the configured fallback list. Each
    // candidate is `null` when we want Telnyx to pick a sender from the
    // messaging profile's number pool (requires TELNYX_MESSAGING_PROFILE_ID).
    const explicitSenders = fromOverride ? [fromOverride] : TELNYX_SENDERS;
    const senders: (string | null)[] = explicitSenders.length > 0
      ? explicitSenders
      : (TELNYX_MESSAGING_PROFILE_ID ? [null] : []);

    let lastErrorDetail = "No Telnyx sender configured";
    let succeeded = false;
    let messageId: string | undefined;
    let messageCost: number = 0;
    let messageStatus: string = "sent";
    let usedSender: string = explicitSenders[0] || "messaging_profile_pool";

    for (const candidate of senders) {
      // When a messaging profile is configured, always include it. When no
      // explicit `from` is available, Telnyx uses the profile's number pool.
      const requestBody: Record<string, unknown> = { to: recipient, text: message };
      if (candidate) requestBody.from = candidate;
      if (TELNYX_MESSAGING_PROFILE_ID) requestBody.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;

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
        usedSender = candidate || telnyxData.data?.from?.phone_number || "messaging_profile_pool";
        messageId = telnyxData.data?.id;
        messageCost = telnyxData.data?.cost?.amount || 0;
        messageStatus = telnyxData.data?.to?.[0]?.status || "sent";
        console.log(`[SMS] Sent via ${usedSender}. ID: ${messageId}`);
        break;
      }

      lastErrorDetail =
        telnyxData.errors?.[0]?.detail ||
        telnyxData.errors?.[0]?.title ||
        `HTTP ${telnyxResponse.status}`;
      console.warn(`[SMS] Sender ${candidate || "profile-pool"} rejected: ${lastErrorDetail}`);

      const isSenderError = /invalid source number|from number|not valid|not authorized|messaging_profile|10dlc/i.test(
        lastErrorDetail,
      );
      if (!isSenderError) break;
    }

    // Telnyx failed (or no usable sender). Fall back to GoHighLevel's
    // Conversations API so the message still goes out. GHL is Novara's
    // primary verified SMS transport; the Telnyx toll-free / 10DLC
    // senders are frequently not provisioned on the account, which makes
    // every Telnyx attempt fail with an invalid-`from` error. Routing the
    // fallback here means EVERY caller of send-sms-notification gets GHL
    // delivery without each one needing to know about GHL.
    if (!succeeded) {
      try {
        const { data: ghlData, error: ghlError } = await supabase.functions.invoke(
          "send-ghl-sms",
          { body: { phone: recipient, message, type } },
        );
        const ghlFail = ghlError || (ghlData && (ghlData as { error?: string }).error);
        if (!ghlFail) {
          succeeded = true;
          usedSender = "ghl";
          messageId = (ghlData as { messageId?: string })?.messageId || undefined;
          messageStatus = "sent";
          console.log("[SMS] Sent via GHL fallback");
        } else {
          lastErrorDetail = `Telnyx: ${lastErrorDetail}; GHL: ${typeof ghlFail === "string" ? ghlFail : JSON.stringify(ghlFail)}`;
        }
      } catch (ghlErr) {
        lastErrorDetail = `Telnyx: ${lastErrorDetail}; GHL threw: ${ghlErr instanceof Error ? ghlErr.message : String(ghlErr)}`;
      }
    }

    if (!succeeded) {
      throw new Error(`SMS failed via all transports — ${lastErrorDetail}`);
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
