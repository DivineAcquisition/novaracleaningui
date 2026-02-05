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
  console.log(`[MODIFY-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { subscriptionId, newPriceId } = await req.json();
    logStep("Request received", { subscriptionId, newPriceId });

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
      throw new Error("Cannot modify a canceled subscription");
    }

    // Get customer
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    const email = (customer as Stripe.Customer).email;

    // If no newPriceId provided, create a customer portal session for self-service
    if (!newPriceId) {
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.customer as string,
        return_url: `${Deno.env.get("CUSTOMER_PORTAL_URL") || 'https://app.novaracleaning.com'}/account`,
        flow_data: {
          type: 'subscription_update',
          subscription_update: {
            subscription: subscriptionId,
          },
        },
      });

      logStep("Created portal session for plan change");

      return new Response(
        JSON.stringify({
          success: true,
          url: session.url,
          type: 'portal_redirect',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If newPriceId is provided, update the subscription directly
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
    });

    logStep("Subscription updated", { newPriceId });

    // Determine new plan based on price
    const newPrice = await stripe.prices.retrieve(newPriceId);
    let newPlan = 'monthly';
    if (newPrice.recurring?.interval === 'week') {
      newPlan = 'weekly';
    } else if (newPrice.recurring?.interval_count === 2) {
      newPlan = 'bi-weekly';
    }

    // Update membership_credits with new plan
    const creditsPerMonth: Record<string, number> = {
      'weekly': 4,
      'bi-weekly': 2,
      'monthly': 1,
    };

    await supabase
      .from('membership_credits')
      .update({
        membership_plan: newPlan,
        credits_per_month: creditsPerMonth[newPlan] || 1,
      })
      .eq('subscription_id', subscriptionId);

    return new Response(
      JSON.stringify({
        success: true,
        subscription: {
          id: updatedSubscription.id,
          status: updatedSubscription.status,
          plan: newPlan,
        },
        message: 'Subscription plan updated successfully',
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
