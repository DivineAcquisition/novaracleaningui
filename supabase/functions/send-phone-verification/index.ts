import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-PHONE-VERIFICATION] ${step}${detailsStr}`);
};

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let phone: string | null = null;
    let cleanerId: string | null = null;

    try {
      const body = await req.json();
      if (body.phone) {
        phone = body.phone;
        logStep("Phone provided directly in request body", { phone });
      }
    } catch {
      // No body - will try auth-based lookup
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
            .select("id, phone")
            .eq("user_id", userId)
            .maybeSingle();

          if (cleaner?.phone) {
            phone = cleaner.phone;
            cleanerId = cleaner.id;
            logStep("Phone from cleaner profile", { cleanerId, phone });
          }
        }
      }
    }

    if (!phone) {
      throw new Error("Phone number is required. Pass it in the request body as { phone: '+1...' }");
    }

    const digits = phone.replace(/\D/g, '');
    const normalizedPhone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phone;

    const code = generateVerificationCode();
    logStep("Generated code", { phone: normalizedPhone });

    if (cleanerId) {
      await supabase
        .from("cleaners")
        .update({
          phone_verification_code: code,
          phone_verification_sent_at: new Date().toISOString(),
        })
        .eq("id", cleanerId);
      logStep("Code stored in cleaner profile");
    }

    try {
      await supabase
        .from("cleaner_verification_codes")
        .insert({
          email: normalizedPhone,
          code,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          used: false,
        });
      logStep("Code stored in verification_codes table");
    } catch (e) {
      logStep("Failed to store in verification_codes (non-critical)", { error: e });
    }

    const { error: smsError } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: normalizedPhone,
        message: `Your Novara Cleaning verification code is: ${code}. Valid for 15 minutes.`,
        type: "verification",
      },
    });

    if (smsError) {
      logStep("SMS send failed", { error: smsError });
      throw new Error("Failed to send verification SMS. Please check your phone number.");
    }

    logStep("SMS sent successfully", { phone: normalizedPhone });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Verification code sent to your phone",
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
