import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
});

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAUSE-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { subscriptionId, pauseDuration = 30 } = await req.json();
    logStep("Request received", { subscriptionId, pauseDuration });

    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get the subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    logStep("Retrieved subscription", { status: subscription.status });

    if (subscription.status === 'canceled') {
      throw new Error("Cannot pause a canceled subscription");
    }

    // Calculate resume date
    const resumeDate = Math.floor(Date.now() / 1000) + (pauseDuration * 24 * 60 * 60);

    // Pause the subscription using Stripe's pause_collection
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      pause_collection: {
        behavior: 'void',
        resumes_at: resumeDate,
      },
    });

    logStep("Subscription paused", { 
      resumesAt: new Date(resumeDate * 1000).toISOString() 
    });

    // Update membership_credits to reflect paused status
    await supabase
      .from('membership_credits')
      .update({
        is_paused: true,
        paused_at: new Date().toISOString(),
        resumes_at: new Date(resumeDate * 1000).toISOString(),
      })
      .eq('subscription_id', subscriptionId);

    return new Response(
      JSON.stringify({
        success: true,
        paused: true,
        resumesAt: new Date(resumeDate * 1000).toISOString(),
        message: `Subscription paused for ${pauseDuration} days`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
