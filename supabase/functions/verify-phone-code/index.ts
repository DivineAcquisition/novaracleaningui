import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PHONE-CODE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code, phone } = await req.json();

    if (!code || code.length !== 6) {
      throw new Error("Invalid verification code format");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let verified = false;

    // Strategy 1: Check cleaner profile if user is authenticated
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
            const sentAt = new Date(cleaner.phone_verification_sent_at);
            const diffMinutes = (Date.now() - sentAt.getTime()) / 1000 / 60;
            if (diffMinutes > 15) {
              await supabase.from("cleaners").update({
                phone_verification_code: null,
                phone_verification_sent_at: null,
              }).eq("id", cleaner.id);
              throw new Error("Verification code expired. Please request a new code.");
            }
          }

          if (cleaner.phone_verification_code === code) {
            await supabase.from("cleaners").update({
              phone_verified: true,
              phone_verification_code: null,
              phone_verification_sent_at: null,
            }).eq("id", cleaner.id);
            verified = true;
            logStep("Verified via cleaner profile", { cleanerId: cleaner.id });
          }
        }
      }
    }

    // Strategy 2: Check cleaner_verification_codes table by phone
    if (!verified && phone) {
      const digits = phone.replace(/\D/g, '');
      const normalizedPhone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phone;

      const { data: codeRecord } = await supabase
        .from("cleaner_verification_codes")
        .select("*")
        .eq("email", normalizedPhone)
        .eq("code", code)
        .eq("used", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (codeRecord) {
        await supabase.from("cleaner_verification_codes").update({ used: true }).eq("id", codeRecord.id);
        verified = true;
        logStep("Verified via verification_codes table", { phone: normalizedPhone });
      }
    }

    // Strategy 3: Check by code only (last resort)
    if (!verified) {
      const { data: codeRecord } = await supabase
        .from("cleaner_verification_codes")
        .select("*")
        .eq("code", code)
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

    if (!verified) {
      throw new Error("Invalid verification code");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Phone number verified successfully",
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
