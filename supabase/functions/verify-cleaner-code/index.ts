import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-CODE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code } = await req.json();
    
    if (!email || !code) {
      throw new Error("Email and code are required");
    }

    if (code.length !== 6) {
      throw new Error("Invalid code format");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    logStep("Verifying code", { email });

    // Find the most recent unused code for this email
    const { data: verification, error: fetchError } = await supabase
      .from("cleaner_verification_codes")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Database error: ${fetchError.message}`);
    }

    if (!verification) {
      throw new Error("Invalid or expired verification code");
    }

    // Check if code is expired
    const expiresAt = new Date(verification.expires_at);
    const now = new Date();
    
    if (now > expiresAt) {
      // Mark as used to prevent reuse
      await supabase
        .from("cleaner_verification_codes")
        .update({ used: true })
        .eq("id", verification.id);
      
      throw new Error("Verification code has expired");
    }

    logStep("Code verified successfully", { email });

    // Mark code as used
    const { error: updateError } = await supabase
      .from("cleaner_verification_codes")
      .update({ used: true })
      .eq("id", verification.id);

    if (updateError) {
      throw new Error(`Failed to mark code as used: ${updateError.message}`);
    }

    // Create auth user with a magic link (they won't need to click it)
    const { data: authData, error: authError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        data: {
          onboarding: true,
          is_cleaner: true,
        }
      }
    });

    if (authError || !authData) {
      throw new Error(`Failed to create auth session: ${authError?.message}`);
    }

    logStep("Auth session created", { email });

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Code verified successfully",
        session: authData,
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
