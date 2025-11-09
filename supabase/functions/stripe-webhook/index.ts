import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    logStep("ERROR: No webhook secret configured");
    return new Response(
      JSON.stringify({ error: "Webhook secret not configured" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);
    logStep("Event received", { type: event.type, id: event.id });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Helper function to send membership emails
    const sendMembershipEmail = async (type: string, email: string, data: any) => {
      try {
        const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-membership-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({ type, email, data }),
        });
        
        if (!response.ok) {
          logStep("Email send failed", { status: response.status });
        } else {
          logStep("Email sent successfully", { type, email });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logStep("Error sending email", { error: errorMessage });
      }
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Processing checkout completion", { sessionId: session.id });
        
        // Update booking status to 'booked'
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ 
            status: 'booked',
            payment_intent_id: session.payment_intent as string,
            customer_id: session.customer as string,
          })
          .eq('checkout_session_id', session.id);
        
        if (updateError) {
          logStep("Error updating booking", updateError);
        } else {
          logStep("Booking confirmed", { sessionId: session.id });
        }
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        logStep("Processing subscription creation", { subscriptionId: subscription.id });
        
        // Determine credits per month based on price
        const priceId = subscription.items.data[0]?.price.id;
        const planNameMap: Record<string, string> = {
          'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
          'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
          'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
        };
        
          const plan = planNameMap[priceId] || 'monthly';
          const creditsPerMonth = { monthly: 1, biweekly: 2, weekly: 4 }[plan];
          const planLabels: Record<string, string> = { 
            monthly: 'Novara Monthly', 
            biweekly: 'Novara Bi-Weekly', 
            weekly: 'Novara Weekly' 
          };
        
        // Get customer email and name
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email || '';
        const name = (customer as Stripe.Customer).name || '';
        
        // Create membership_credits entry
        const { error: creditsError } = await supabase
          .from('membership_credits')
          .upsert({
            customer_id: customerId,
            email,
            membership_plan: plan,
            credits_per_month: creditsPerMonth,
            credits_remaining: creditsPerMonth,
            credits_used: 0,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            subscription_id: subscription.id,
            credit_available_date: new Date().toISOString(),
          });
        
        if (creditsError) {
          logStep("Error creating membership credits", creditsError);
        } else {
          logStep("Membership credits created", { customerId, plan, credits: creditsPerMonth });
          
          // Send welcome email
          await sendMembershipEmail('welcome', email, {
            name,
            plan: planLabels[plan],
            credits: creditsPerMonth,
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const previousAttributes = event.data.previous_attributes as any;
        logStep("Processing subscription update", { subscriptionId: subscription.id });
        
        // Check if this is a renewal (period changed)
        const isRenewal = previousAttributes?.current_period_end && 
                         previousAttributes.current_period_end !== subscription.current_period_end;
        
        if (isRenewal) {
          logStep("Detected subscription renewal", { subscriptionId: subscription.id });
          
          // Determine credits based on price
          const priceId = subscription.items.data[0]?.price.id;
          const planNameMap: Record<string, string> = {
            'price_1SR2UhGc7k6gIVcMiKbuq1mo': 'monthly',
            'price_1SR2VNGc7k6gIVcMMI6Fuxga': 'biweekly',
            'price_1SR2VYGc7k6gIVcML2W0jVKS': 'weekly',
          };
          
          const plan = planNameMap[priceId] || 'monthly';
          const creditsPerMonth = { monthly: 1, biweekly: 2, weekly: 4 }[plan];
          const planLabels: Record<string, string> = { 
            monthly: 'Novara Monthly', 
            biweekly: 'Novara Bi-Weekly', 
            weekly: 'Novara Weekly' 
          };
          
          // Get customer info
          const customerId = subscription.customer as string;
          const customer = await stripe.customers.retrieve(customerId);
          const email = (customer as Stripe.Customer).email || '';
          const name = (customer as Stripe.Customer).name || '';
          
          // Reset credits on renewal
          const { error: updateError } = await supabase
            .from('membership_credits')
            .update({
              credits_used: 0,
              credits_remaining: creditsPerMonth,
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              credit_available_date: new Date().toISOString(),
            })
            .eq('subscription_id', subscription.id);
          
          if (updateError) {
            logStep("Error updating membership credits", updateError);
          } else {
            logStep("Membership credits renewed", { subscriptionId: subscription.id, credits: creditsPerMonth });
            
            // Send renewal and credit allocation emails
            const amount = subscription.items.data[0]?.price.unit_amount || 0;
            await sendMembershipEmail('renewal', email, {
              name,
              plan: planLabels[plan],
              amount,
              renewalDate: new Date(subscription.current_period_end * 1000).toISOString(),
            });
            
            await sendMembershipEmail('credit_allocated', email, {
              name,
              plan: planLabels[plan],
              credits: creditsPerMonth,
              renewalDate: new Date(subscription.current_period_end * 1000).toISOString(),
            });
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Processing subscription cancellation", { subscriptionId: subscription.id });
        
        // Get customer and credits info before deletion
        const { data: creditsData } = await supabase
          .from('membership_credits')
          .select('*')
          .eq('subscription_id', subscription.id)
          .single();
        
        // Delete credits record
        const { error: deleteError } = await supabase
          .from('membership_credits')
          .delete()
          .eq('subscription_id', subscription.id);
        
        if (deleteError) {
          logStep("Error deleting membership credits", deleteError);
        } else {
          logStep("Membership credits removed", { subscriptionId: subscription.id });
          
          // Send cancellation email if we have customer data
          if (creditsData?.email) {
            const customer = await stripe.customers.retrieve(subscription.customer as string);
            const name = (customer as Stripe.Customer).name || '';
            const planLabels: Record<string, string> = { 
              monthly: 'Novara Monthly', 
              biweekly: 'Novara Bi-Weekly', 
              weekly: 'Novara Weekly' 
            };
            
            await sendMembershipEmail('subscription_cancelled', creditsData.email, {
              name,
              plan: planLabels[creditsData.membership_plan as string] || creditsData.membership_plan,
            });
          }
        }
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR processing webhook", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});