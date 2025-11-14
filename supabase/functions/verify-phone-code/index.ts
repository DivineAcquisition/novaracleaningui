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
    const { code } = await req.json();
    
    if (!code || code.length !== 6) {
      throw new Error("Invalid verification code format");
    }

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

    // Check if code exists
    if (!cleaner.phone_verification_code) {
      throw new Error("No verification code found. Please request a new code.");
    }

    // Check if code is expired (15 minutes)
    if (cleaner.phone_verification_sent_at) {
      const sentAt = new Date(cleaner.phone_verification_sent_at);
      const now = new Date();
      const diffMinutes = (now.getTime() - sentAt.getTime()) / 1000 / 60;
      
      if (diffMinutes > 15) {
        // Clear expired code
        await supabase
          .from("cleaners")
          .update({
            phone_verification_code: null,
            phone_verification_sent_at: null,
          })
          .eq("id", cleaner.id);
        
        throw new Error("Verification code expired. Please request a new code.");
      }
    }

    // Verify code
    if (cleaner.phone_verification_code !== code) {
      throw new Error("Invalid verification code");
    }

    logStep("Code verified successfully", { cleanerId: cleaner.id });

    // Update cleaner: mark as verified and clear code
    const { error: updateError } = await supabase
      .from("cleaners")
      .update({
        phone_verified: true,
        phone_verification_code: null,
        phone_verification_sent_at: null,
      })
      .eq("id", cleaner.id);

    if (updateError) {
      throw new Error(`Failed to update verification status: ${updateError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Phone number verified successfully"
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
