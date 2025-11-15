import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[APPLY-CREDIT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { referralId, creditCents = 5000 } = await req.json(); // $50 default
    
    if (!referralId) {
      throw new Error("Referral ID is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    logStep("Applying referral credit", { referralId, creditCents });

    // Update referral record with credit
    const { data: referral, error: updateError } = await supabase
      .from("referrals")
      .update({
        credit_cents: creditCents,
        status: 'redeemed',
        redeemed_at: new Date().toISOString(),
      })
      .eq("id", referralId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update referral: ${updateError.message}`);
    }

    logStep("Credit applied successfully", { referralId, creditCents });

    // TODO: In the future, you could integrate this with Stripe credits
    // or create a separate credits table to track customer balances

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Referral credit applied successfully",
        referral,
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
