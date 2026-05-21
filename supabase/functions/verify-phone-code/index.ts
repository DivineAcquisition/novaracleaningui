// ─── verify-phone-code (v2) ─────────────────────────────────────────────
//
// Verifies the 6-digit OTP for contractor phone verification. Tries
// three strategies in order:
//   1. Auth user with cleaners row    → match cleaners.phone_verification_code
//   2. Phone + code in cleaner_verification_codes (phone OR legacy email col)
//   3. Code-only lookup (last resort)
//
// When verified AND the caller has an existing cleaners row, sets
// cleaners.phone_verified = true and fires sync-cleaner-to-ghl so the
// GHL contact picks up the 'phone-verified' tag immediately.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[VERIFY-PHONE-CODE] ${step}${d}`);
};

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
    const { code, phone } = await req.json();
    if (!code || String(code).length !== 6) throw new Error("Invalid verification code format");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let verified = false;
    let cleanerId: string | null = null;
    const normalizedPhone = phone ? toE164(String(phone)) : "";

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      const userId = userData?.user?.id;
      if (userId) {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, phone_verification_code, phone_verification_sent_at")
          .eq("user_id", userId)
          .maybeSingle();
        if (cleaner?.phone_verification_code) {
          if (cleaner.phone_verification_sent_at) {
            const diffMinutes = (Date.now() - new Date(cleaner.phone_verification_sent_at).getTime()) / 60000;
            if (diffMinutes > 15) {
              await supabase.from("cleaners").update({
                phone_verification_code: null,
                phone_verification_sent_at: null,
              }).eq("id", cleaner.id);
              throw new Error("Verification code expired. Please request a new code.");
            }
          }
          if (cleaner.phone_verification_code === String(code)) {
            await supabase.from("cleaners").update({
              phone_verified: true,
              phone_verification_code: null,
              phone_verification_sent_at: null,
            }).eq("id", cleaner.id);
            verified = true;
            cleanerId = cleaner.id;
            logStep("Verified via cleaner profile", { cleanerId });
          }
        }
      }
    }

    if (!verified && normalizedPhone) {
      let codeRecord: any = null;
      const { data: byPhone } = await supabase
        .from("cleaner_verification_codes")
        .select("*")
        .eq("phone", normalizedPhone)
        .eq("code", String(code))
        .eq("used", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      codeRecord = byPhone;
      if (!codeRecord) {
        const { data: byLegacy } = await supabase
          .from("cleaner_verification_codes")
          .select("*")
          .eq("email", normalizedPhone)
          .eq("code", String(code))
          .eq("used", false)
          .gte("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        codeRecord = byLegacy;
      }
      if (codeRecord) {
        await supabase.from("cleaner_verification_codes").update({ used: true }).eq("id", codeRecord.id);
        verified = true;
        logStep("Verified via codes table", { phone: normalizedPhone });
      }
    }

    if (!verified) {
      const { data: codeRecord } = await supabase
        .from("cleaner_verification_codes")
        .select("*")
        .eq("code", String(code))
        .eq("used", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (codeRecord) {
        await supabase.from("cleaner_verification_codes").update({ used: true }).eq("id", codeRecord.id);
        verified = true;
        logStep("Verified via code-only lookup");
      }
    }

    if (!verified) throw new Error("Invalid verification code");

    if (!cleanerId && normalizedPhone) {
      const { data: matched } = await supabase
        .from("cleaners")
        .select("id, phone_verified")
        .eq("phone", normalizedPhone)
        .maybeSingle();
      if (matched?.id && !matched.phone_verified) {
        await supabase.from("cleaners")
          .update({ phone_verified: true, phone_verification_code: null, phone_verification_sent_at: null })
          .eq("id", matched.id);
        cleanerId = matched.id;
      }
    }

    if (cleanerId) {
      supabase.functions.invoke("sync-cleaner-to-ghl", { body: { cleanerId } })
        .then((r) => logStep("GHL sync triggered", { cleanerId, ok: !r.error }))
        .catch((e) => logStep("GHL sync failed (non-blocking)", { error: String((e as Error).message) }));
    }

    return new Response(
      JSON.stringify({ success: true, message: "Phone number verified successfully", cleanerId }),
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
