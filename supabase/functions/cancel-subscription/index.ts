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
  console.log(`[CANCEL-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { subscriptionId, cancelImmediately = false, reason } = await req.json();
    logStep("Request received", { subscriptionId, cancelImmediately, reason });

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
      throw new Error("Subscription is already canceled");
    }

    let canceledSubscription;

    if (cancelImmediately) {
      // Cancel immediately
      canceledSubscription = await stripe.subscriptions.cancel(subscriptionId, {
        prorate: true,
      });
      logStep("Subscription canceled immediately");
    } else {
      // Cancel at end of billing period
      canceledSubscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: {
          cancellation_reason: reason || 'Customer requested',
          cancelled_at: new Date().toISOString(),
        },
      });
      logStep("Subscription set to cancel at period end", { 
        cancelAt: new Date(canceledSubscription.current_period_end * 1000).toISOString() 
      });
    }

    // Get customer email from subscription
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    const email = (customer as Stripe.Customer).email;

    // Update membership_credits
    if (cancelImmediately) {
      // Delete membership credits if immediate cancel
      await supabase
        .from('membership_credits')
        .delete()
        .eq('subscription_id', subscriptionId);
    } else {
      // Mark as pending cancellation
      await supabase
        .from('membership_credits')
        .update({
          cancel_at_period_end: true,
          cancellation_reason: reason || 'Customer requested',
        })
        .eq('subscription_id', subscriptionId);
    }

    // Log the cancellation
    await supabase
      .from('subscription_events')
      .insert({
        subscription_id: subscriptionId,
        event_type: cancelImmediately ? 'cancelled' : 'cancellation_scheduled',
        reason: reason || 'Customer requested',
        email: email,
      });

    return new Response(
      JSON.stringify({
        success: true,
        cancelled: cancelImmediately,
        cancelAtPeriodEnd: !cancelImmediately,
        endDate: cancelImmediately 
          ? new Date().toISOString()
          : new Date(canceledSubscription.current_period_end * 1000).toISOString(),
        message: cancelImmediately 
          ? 'Subscription cancelled immediately'
          : `Subscription will cancel on ${new Date(canceledSubscription.current_period_end * 1000).toLocaleDateString()}`,
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
