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
  console.log(`[RESUME-SUBSCRIPTION] ${step}${detailsStr}`);
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

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    
    // Find customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length === 0) {
      throw new Error("No Stripe customer found for this user");
    }
    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Find paused subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 10,
    });
    
    const pausedSubscription = subscriptions.data.find((sub: Stripe.Subscription) => sub.pause_collection);
    
    if (!pausedSubscription) {
      throw new Error("No paused subscription found");
    }

    logStep("Found paused subscription", { subscriptionId: pausedSubscription.id });

    // Resume subscription by removing pause
    const updatedSubscription = await stripe.subscriptions.update(pausedSubscription.id, {
      pause_collection: null, // Remove pause
    });

    logStep("Subscription resumed successfully", { 
      subscriptionId: updatedSubscription.id,
      resumedAt: new Date().toISOString()
    });

    // Push the resumed state to GHL and notify the customer by SMS so
    // every portal action is mirrored. Best-effort — never throw.
    try {
      await upsertContact({
        email: user.email,
        tags: ["member - resumed"],
        mergeTags: true,
        source: "Novara Portal",
        customFieldsByKey: {
          membership_status: "active",
          membership_resumes_at: "",
          stripe_customer_id: customerId,
        },
      });
      try {
        const { sendSms } = await import("../_shared/sms.ts");
        const { data: cust } = await supabaseClient
          .from("customers")
          .select("phone")
          .eq("email", user.email)
          .maybeSingle();
        if (cust?.phone) {
          await sendSms(supabaseClient, {
            toPhone: cust.phone,
            message: "Novara: Your membership is active again. Credits are available — book your next clean in the portal. Reply HELP for help.",
            type: "confirmation",
          });
        }
      } catch (smsErr) {
        logStep("Resume SMS failed (non-blocking)", { error: smsErr instanceof Error ? smsErr.message : String(smsErr) });
      }
    } catch (ghlErr) {
      logStep("GHL resume sync failed (non-blocking)", { error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr) });
    }

    return new Response(JSON.stringify({
      success: true,
      subscriptionId: updatedSubscription.id,
      resumedAt: new Date().toISOString(),
      message: "Subscription resumed successfully"
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in resume-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
