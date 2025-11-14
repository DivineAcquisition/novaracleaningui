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
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    // Authenticate cleaner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    
    if (!userId) throw new Error("Not authenticated");

    // Get cleaner profile
    const { data: cleaner, error: fetchError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (fetchError || !cleaner) {
      throw new Error("Cleaner profile not found");
    }

    // Rate limiting: Check last sent time
    if (cleaner.phone_verification_sent_at) {
      const lastSent = new Date(cleaner.phone_verification_sent_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - lastSent.getTime()) / 1000 / 60;
      
      if (diffMinutes < 1) {
        throw new Error("Please wait before requesting a new code");
      }
    }

    // Generate verification code
    const code = generateVerificationCode();
    logStep("Generated code", { cleanerId: cleaner.id });

    // Update cleaner with verification code
    const { error: updateError } = await supabase
      .from("cleaners")
      .update({
        phone_verification_code: code,
        phone_verification_sent_at: new Date().toISOString(),
      })
      .eq("id", cleaner.id);

    if (updateError) {
      throw new Error(`Failed to save verification code: ${updateError.message}`);
    }

    // Send SMS via existing send-sms-notification function
    const { error: smsError } = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: cleaner.phone,
        message: `Your verification code is: ${code}. Valid for 15 minutes.`,
        type: "verification",
      },
    });

    if (smsError) {
      logStep("SMS send failed", { error: smsError });
      throw new Error("Failed to send verification SMS");
    }

    logStep("SMS sent successfully", { phone: cleaner.phone });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Verification code sent to your phone"
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
