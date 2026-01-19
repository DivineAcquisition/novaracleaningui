import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[PAUSE-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");
    logStep("Authorization header found");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const { resumeAt } = await req.json();
    
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
    
    // Find customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found for this user");
    }
    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Find active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    
    if (subscriptions.data.length === 0) {
      throw new Error("No active subscription found");
    }

    const subscription = subscriptions.data[0];
    logStep("Found active subscription", { subscriptionId: subscription.id });

    // Pause subscription with resume date
    let pauseConfig: any = {
      behavior: 'mark_uncollectible', // Don't attempt to collect payments while paused
    };

    if (resumeAt) {
      const resumeDate = new Date(resumeAt);
      pauseConfig.resumes_at = Math.floor(resumeDate.getTime() / 1000);
      logStep("Setting resume date", { resumeAt, timestamp: pauseConfig.resumes_at });
    }

    const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
      pause_collection: pauseConfig,
    });

    logStep("Subscription paused successfully", { 
      subscriptionId: updatedSubscription.id,
      pausedAt: new Date().toISOString(),
      resumesAt: resumeAt || 'indefinite'
    });

    return new Response(JSON.stringify({
      success: true,
      subscriptionId: updatedSubscription.id,
      pausedAt: new Date().toISOString(),
      resumesAt: resumeAt || null,
      message: resumeAt 
        ? `Subscription paused until ${new Date(resumeAt).toLocaleDateString()}`
        : "Subscription paused indefinitely"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in pause-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
