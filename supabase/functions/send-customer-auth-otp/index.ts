import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CUSTOMER-AUTH-OTP] ${step}${detailsStr}`);
};

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface OTPRequest {
  phone: string;
  email?: string;
  firstName?: string;
  channel?: "sms" | "both";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, email, firstName, channel = "sms" }: OTPRequest = await req.json();

    if (!phone) {
      throw new Error("Phone number is required");
    }

    logStep("Processing OTP request", { phone, email, channel });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const cleanPhone = phone.replace(/\D/g, "");

    // Rate limiting: max 3 OTP requests per phone in 15 minutes
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("sms_logs")
      .select("id", { count: "exact", head: true })
      .eq("to_phone", cleanPhone)
      .eq("type", "verification")
      .gte("created_at", fifteenMinAgo);

    if (recentCount !== null && recentCount >= 3) {
      logStep("Rate limited", { phone: cleanPhone, recentCount });
      return new Response(
        JSON.stringify({
          success: false,
          error: "Too many OTP requests. Please wait before trying again.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 }
      );
    }

    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10);

    // Store OTP in cleaner_verification_codes table (reusing existing table)
    const { error: insertError } = await supabase
      .from("cleaner_verification_codes")
      .insert({
        email: email || `phone:${cleanPhone}`,
        code,
        expires_at: expiresAt.toISOString(),
        used: false,
      });

    if (insertError) {
      throw new Error(`Failed to store OTP: ${insertError.message}`);
    }

    logStep("OTP stored", { expiresAt: expiresAt.toISOString() });

    // Send SMS with OTP
    const smsMessage = `Your Novara Cleaning verification code is: ${code}. Valid for 10 minutes. Do not share this code.`;

    const { error: smsError } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: cleanPhone,
        message: smsMessage,
        type: "verification",
        skipConsentCheck: true,
        skipQuietHours: true,
      },
    });

    if (smsError) {
      logStep("SMS send failed", { error: smsError });
      throw new Error("Failed to send verification code via SMS");
    }

    logStep("SMS OTP sent successfully", { phone: cleanPhone });

    // Optionally also send via email
    if (channel === "both" && email) {
      try {
        await supabase.functions.invoke("send-cleaner-verification-code", {
          body: { email, firstName: firstName || "Customer" },
        });
        logStep("Email OTP also sent", { email });
      } catch (emailErr) {
        logStep("Email OTP failed (non-critical)", { error: emailErr });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Verification code sent to your phone",
        expiresInSeconds: 600,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: error.message.includes("Rate") ? 429 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
