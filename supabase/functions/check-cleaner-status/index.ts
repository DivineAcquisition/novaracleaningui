import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-CLEANER-STATUS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cleanerId } = await req.json();
    logStep("Checking status", { cleanerId });
    
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get cleaner details
    const { data: cleaner, error: fetchError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("id", cleanerId)
      .single();

    if (fetchError || !cleaner || !cleaner.stripe_account_id) {
      throw new Error("Cleaner not found or no Stripe account");
    }

    // Check Stripe account status
    const account = await stripe.accounts.retrieve(cleaner.stripe_account_id);

    const onboardingComplete = account.details_submitted;
    const payoutsEnabled = account.payouts_enabled;

    logStep("Retrieved account status", { onboardingComplete, payoutsEnabled });

    // Update cleaner record
    const { error: updateError } = await supabase
      .from("cleaners")
      .update({
        onboarding_complete: onboardingComplete,
        payouts_enabled: payoutsEnabled,
        status: onboardingComplete ? 'active' : 'pending',
        activated_at: onboardingComplete && !cleaner.activated_at ? new Date().toISOString() : cleaner.activated_at,
      })
      .eq("id", cleanerId);

    if (updateError) throw updateError;

    logStep("Updated cleaner status");

    return new Response(
      JSON.stringify({
        success: true,
        onboarding_complete: onboardingComplete,
        payouts_enabled: payoutsEnabled,
        status: onboardingComplete ? 'active' : 'pending',
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
