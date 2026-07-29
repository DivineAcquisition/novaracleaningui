import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { upsertContact } from "../_shared/ghl-client.ts";

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

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stripeKey = await resolveSecret(supabaseClient, "STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

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
    
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    
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

    // Push the pause status to GHL so the contact / opportunity row
    // reflects the new state. Never throws — fire-and-forget.
    try {
      await upsertContact({
        email: user.email,
        tags: ["member - paused"],
        mergeTags: true,
        source: "Novara Portal",
        customFieldsByKey: {
          membership_status: "paused",
          membership_resumes_at: resumeAt ? new Date(resumeAt).toISOString() : "",
          stripe_customer_id: customerId,
        },
      });
      // Also notify the customer via SMS so they don't wonder whether
      // the click registered. Non-blocking.
      try {
        const { sendSms } = await import("../_shared/sms.ts");
        const dateLabel = resumeAt
          ? new Date(resumeAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : null;
        const message = dateLabel
          ? `Novara: Your membership is paused until ${dateLabel}. We'll resume billing automatically. Reply HELP for help.`
          : `Novara: Your membership is paused. Resume anytime from your account portal. Reply HELP for help.`;
        const { data: cust } = await supabaseClient
          .from("customers")
          .select("phone")
          .eq("email", user.email)
          .maybeSingle();
        if (cust?.phone) {
          await sendSms(supabaseClient, { toPhone: cust.phone, message, type: "confirmation" });
        }
      } catch (smsErr) {
        logStep("Pause SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
      }
    } catch (ghlErr) {
      logStep("GHL pause sync failed (non-blocking)", { error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr) });
    }

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
