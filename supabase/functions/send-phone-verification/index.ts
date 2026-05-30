// ─── send-phone-verification (v3 — Telnyx-routed) ────────────────────────
//
// Contractor OTP SMS. Generates a 6-digit code, stores it in
// cleaner_verification_codes (and on cleaners.phone_verification_code
// if the caller is authenticated and already has a row), and delivers
// the SMS via Telnyx (send-sms-notification). Verification codes were
// moved off GHL onto Telnyx per ops request — Telnyx writes sms_logs so
// every code send is auditable.
//
// Delivery requires a working Telnyx sender — set TELNYX_PHONE_NUMBER or
// TELNYX_MESSAGING_PROFILE_ID in the Edge Function secrets (see
// send-sms-notification). If Telnyx delivery fails (e.g. the sender isn't
// yet associated with the messaging profile), we fall back to the legacy
// GHL path as a safety net so cleaners still receive their code. Once the
// Telnyx sender is configured, the GHL fallback is never hit.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-PHONE-VERIFICATION] ${step}${d}`);
};

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return raw.replace(/[^0-9+]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let phone: string | null = null;
    let firstName: string | null = null;
    let cleanerId: string | null = null;

    try {
      const body = await req.json();
      if (body?.phone) {
        phone = String(body.phone);
        logStep("Phone provided in body", { phone });
      }
      if (body?.firstName) firstName = String(body.firstName);
    } catch {
      // no body — will try auth-based lookup
    }

    if (!phone) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const { data: userData } = await supabase.auth.getUser(token);
        const userId = userData?.user?.id;
        if (userId) {
          const { data: cleaner } = await supabase
            .from("cleaners")
            .select("id, phone, first_name")
            .eq("user_id", userId)
            .maybeSingle();
          if (cleaner?.phone) {
            phone = cleaner.phone;
            cleanerId = cleaner.id;
            firstName = cleaner.first_name || firstName;
            logStep("Phone from cleaner profile", { cleanerId, phone });
          }
        }
      }
    }

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone is required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const normalized = toE164(phone);
    if (!normalized) {
      return new Response(JSON.stringify({ error: "invalid phone number" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const code = generateCode();
    logStep("Generated code", { phone: normalized });

    if (cleanerId) {
      await supabase
        .from("cleaners")
        .update({
          phone_verification_code: code,
          phone_verification_sent_at: new Date().toISOString(),
        })
        .eq("id", cleanerId);
      logStep("Code stored on cleaner row");
    }

    try {
      await supabase
        .from("cleaner_verification_codes")
        .insert({
          email: normalized,
          phone: normalized,
          code,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          used: false,
        });
      logStep("Code persisted in cleaner_verification_codes");
    } catch (e) {
      logStep("Failed to persist code (non-critical)", { error: String((e as Error).message) });
    }

    const messageText = `Your Novara Cleaning verification code is: ${code}. Valid for 15 minutes.`;

    // ─── Primary: Telnyx ──────────────────────────────────────────────
    const { data: smsData, error: smsError } = await supabase.functions.invoke("send-sms-notification", {
      body: { toPhone: normalized, message: messageText, type: "verification" },
    });
    const telnyxFailed = Boolean(smsError) || Boolean((smsData as any)?.error);

    if (!telnyxFailed) {
      logStep("SMS dispatched via Telnyx", { phone: normalized });
      return new Response(
        JSON.stringify({ success: true, message: "Verification code sent", provider: "telnyx" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // ─── Fallback: GHL (only if Telnyx delivery failed) ───────────────
    const telnyxDetail = String((smsError as any)?.message || (smsData as any)?.error || smsError);
    logStep("Telnyx send failed — falling back to GHL", { detail: telnyxDetail });

    const contractorSmsNumberId = await (async () => {
      try {
        const { data } = await supabase
          .from("app_secrets").select("value").eq("key", "GHL_CONTRACTOR_SMS_NUMBER_ID").maybeSingle();
        return (data?.value as string) || "";
      } catch { return ""; }
    })();

    const { data: ghlData, error: ghlError } = await supabase.functions.invoke("send-ghl-sms", {
      body: {
        phone: normalized,
        firstName: firstName || undefined,
        message: messageText,
        type: "verification",
        fromNumberId: contractorSmsNumberId || undefined,
      },
    });

    if (ghlError || (ghlData as any)?.error) {
      const ghlDetail = String((ghlError as any)?.message || (ghlData as any)?.error || ghlError);
      logStep("GHL fallback also failed", { error: ghlDetail });
      return new Response(
        JSON.stringify({
          error: "Failed to send verification SMS. Please check your phone number and try again.",
          detail: `telnyx: ${telnyxDetail}; ghl: ${ghlDetail}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
      );
    }

    logStep("SMS dispatched via GHL fallback", { phone: normalized });
    return new Response(
      JSON.stringify({ success: true, message: "Verification code sent", provider: "ghl_fallback" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
