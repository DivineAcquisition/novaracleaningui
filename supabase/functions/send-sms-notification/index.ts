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
  skipConsentCheck?: boolean;
  skipQuietHours?: boolean;
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

function cleanPhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits;
}

function isInQuietHours(startTime: string | null, endTime: string | null): boolean {
  if (!startTime || !endTime) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Wraps midnight (e.g. 22:00 - 07:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  let lastRequest: SMSRequest | null = null;
  let logEntryId: string | null = null;

  try {
    const {
      toPhone,
      message,
      type,
      jobAssignmentId,
      skipConsentCheck = false,
      skipQuietHours = false,
    }: SMSRequest = await req.json();
    lastRequest = { toPhone, message, type, jobAssignmentId };

    console.log(`[SMS] Sending ${type} to ${toPhone}`);

    if (!telnyxApiKey) {
      throw new Error("TELNYX_API_KEY is not configured");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const cleanDigits = cleanPhoneDigits(toPhone);

    // --- Consent & opt-out check (skip for verification codes) ---
    if (!skipConsentCheck && type !== "verification") {
      const { data: optOut } = await supabase
        .from("sms_consent_logs")
        .select("id, consent_given")
        .eq("phone", cleanDigits)
        .eq("consent_given", false)
        .order("created_at", { ascending: false })
        .limit(1);

      if (optOut && optOut.length > 0) {
        const { data: reConsent } = await supabase
          .from("sms_consent_logs")
          .select("id")
          .eq("phone", cleanDigits)
          .eq("consent_given", true)
          .gt("created_at", optOut[0].id)
          .limit(1);

        if (!reConsent || reConsent.length === 0) {
          console.log(`[SMS] Skipped - phone ${cleanDigits} has opted out`);
          return new Response(
            JSON.stringify({ success: false, reason: "opted_out" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Check cleaner SMS preferences
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("id, sms_notifications_enabled, sms_quiet_hours_start, sms_quiet_hours_end")
        .eq("phone", cleanDigits)
        .single();

      if (cleaner) {
        if (cleaner.sms_notifications_enabled === false) {
          console.log(`[SMS] Skipped - cleaner has SMS disabled`);
          return new Response(
            JSON.stringify({ success: false, reason: "sms_disabled" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (!skipQuietHours && isInQuietHours(cleaner.sms_quiet_hours_start, cleaner.sms_quiet_hours_end)) {
          console.log(`[SMS] Skipped - quiet hours active for ${cleanDigits}`);
          // Queue for later delivery
          await supabase.from("sms_retry_queue").insert({
            to_phone: toPhone,
            message,
            type,
            job_assignment_id: jobAssignmentId,
            status: "pending",
            last_error: "Deferred: quiet hours",
            next_retry_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
          return new Response(
            JSON.stringify({ success: false, reason: "quiet_hours", queued: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // --- Rate limiting: max 5 SMS to same number in 1 hour ---
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("sms_logs")
      .select("id", { count: "exact", head: true })
      .eq("to_phone", toPhone)
      .gte("created_at", oneHourAgo);

    if (recentCount !== null && recentCount >= 5) {
      console.log(`[SMS] Rate limited - ${recentCount} SMS sent to ${toPhone} in last hour`);
      return new Response(
        JSON.stringify({ success: false, reason: "rate_limited" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Create log entry ---
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

    // --- Send via Telnyx ---
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
          cost: telnyxData.data?.cost?.amount || 0,
          updated_at: new Date().toISOString(),
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
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );

      if (logEntryId) {
        await supabase
          .from("sms_logs")
          .update({
            status: "failed",
            error_message: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", logEntryId);
      }

      // Auto-queue for retry on transient failures
      if (lastRequest && isRetryableError(error.message)) {
        await supabase.from("sms_retry_queue").insert({
          sms_log_id: logEntryId,
          to_phone: lastRequest.toPhone,
          message: lastRequest.message,
          type: lastRequest.type,
          job_assignment_id: lastRequest.jobAssignmentId,
          status: "pending",
          last_error: error.message,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        console.log("[SMS] Queued for retry");
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

function isRetryableError(errorMessage: string): boolean {
  const retryablePatterns = [
    "timeout",
    "network",
    "ECONNREFUSED",
    "ECONNRESET",
    "502",
    "503",
    "429",
    "rate limit",
    "temporarily unavailable",
  ];
  const lower = errorMessage.toLowerCase();
  return retryablePatterns.some(p => lower.includes(p.toLowerCase()));
}
