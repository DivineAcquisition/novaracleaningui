import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-CONTRACTOR-PHONE] ${step}${detailsStr}`);
};

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
    const { phone, code, cleanerId } = await req.json();
    
    if (!phone || !code) {
      throw new Error("Phone and code are required");
    }

    if (code.length !== 6) {
      throw new Error("Invalid code format - must be 6 digits");
    }

    const normalizedPhone = normalizePhone(phone);
    logStep("Verifying code", { phone: normalizedPhone.slice(-4), cleanerId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find the most recent unused code for this phone
    const { data: verification, error: fetchError } = await supabase
      .from("phone_verification_codes")
      .select("*")
      .eq("phone", normalizedPhone)
      .eq("code", code)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Database error: ${fetchError.message}`);
    }

    if (!verification) {
      // Check if code was already used
      const { data: usedCode } = await supabase
        .from("phone_verification_codes")
        .select("id")
        .eq("phone", normalizedPhone)
        .eq("code", code)
        .eq("used", true)
        .limit(1)
        .maybeSingle();

      if (usedCode) {
        throw new Error("This verification code has already been used");
      }

      throw new Error("Invalid verification code");
    }

    // Check if code is expired
    const expiresAt = new Date(verification.expires_at);
    const now = new Date();
    
    if (now > expiresAt) {
      // Mark as used to prevent reuse
      await supabase
        .from("phone_verification_codes")
        .update({ used: true })
        .eq("id", verification.id);
      
      throw new Error("Verification code has expired. Please request a new one.");
    }

    logStep("Code verified successfully");

    // Mark code as used
    const { error: updateCodeError } = await supabase
      .from("phone_verification_codes")
      .update({ 
        used: true,
        verified_at: new Date().toISOString()
      })
      .eq("id", verification.id);

    if (updateCodeError) {
      throw new Error(`Failed to mark code as used: ${updateCodeError.message}`);
    }

    // Update cleaner record with verified phone
    if (cleanerId || verification.cleaner_id) {
      const targetCleanerId = cleanerId || verification.cleaner_id;
      
      const { error: cleanerUpdateError } = await supabase
        .from("cleaners")
        .update({ 
          phone: normalizedPhone,
          phone_verified: true,
          phone_verified_at: new Date().toISOString(),
          sms_notifications_enabled: true
        })
        .eq("id", targetCleanerId);

      if (cleanerUpdateError) {
        console.error("Failed to update cleaner:", cleanerUpdateError);
      } else {
        logStep("Cleaner phone verified", { cleanerId: targetCleanerId });
      }

      // Send welcome SMS to the newly verified contractor
      try {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name")
          .eq("id", targetCleanerId)
          .single();

        const welcomeMessage = `🎉 Welcome to Novara${cleaner?.first_name ? `, ${cleaner.first_name}` : ''}! 

Your phone is now verified. You'll receive job offers via SMS.

Reply HELP for commands or STOP to opt out.`;

        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: normalizedPhone,
            message: welcomeMessage,
            type: "welcome",
            cleanerId: targetCleanerId
          }
        });
      } catch (welcomeError) {
        console.error("Failed to send welcome SMS:", welcomeError);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Phone verified successfully",
        phone: normalizedPhone
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
