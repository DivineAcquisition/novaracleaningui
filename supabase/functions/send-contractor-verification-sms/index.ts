import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CONTRACTOR-VERIFY-SMS] ${step}${detailsStr}`);
};

/**
 * Generate a 6-digit verification code
 */
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return phone.startsWith('+') ? phone : `+${digits}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone, cleanerId, firstName } = await req.json();
    
    if (!phone) {
      throw new Error("Phone number is required");
    }

    const normalizedPhone = normalizePhone(phone);
    logStep("Starting verification", { phone: normalizedPhone.slice(-4), cleanerId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Generate 6-digit code
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiry

    // Invalidate any existing unused codes for this phone
    await supabase
      .from("phone_verification_codes")
      .update({ used: true })
      .eq("phone", normalizedPhone)
      .eq("used", false);

    // Store code in database
    const { error: insertError } = await supabase
      .from("phone_verification_codes")
      .insert({
        phone: normalizedPhone,
        code,
        cleaner_id: cleanerId,
        expires_at: expiresAt.toISOString(),
        used: false,
        type: "contractor_verification"
      });

    if (insertError) {
      throw new Error(`Failed to store verification code: ${insertError.message}`);
    }

    logStep("Code stored in database", { expiresAt });

    // Compose SMS message
    const name = firstName ? ` ${firstName}` : "";
    const message = `Hi${name}! Your Novara verification code is: ${code}

This code expires in 10 minutes.

Reply STOP to opt out.`;

    // Send SMS via the notification function
    const { error: smsError } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: normalizedPhone,
        message,
        type: "contractor_verification",
        cleanerId,
        metadata: { codeId: code }
      }
    });

    if (smsError) {
      throw new Error(`Failed to send SMS: ${smsError.message}`);
    }

    logStep("Verification SMS sent successfully", { phone: normalizedPhone.slice(-4) });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Verification code sent",
        expiresAt: expiresAt.toISOString()
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
