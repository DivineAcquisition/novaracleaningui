/**
 * Stripe Connect Webhook Handler
 * 
 * Equivalent to Next.js: /api/stripe/webhook
 * 
 * Handles Stripe Connect events, particularly account.updated
 * to sync charges_enabled and payouts_enabled status to Supabase.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeSecretKey) {
    console.error("[STRIPE-WEBHOOK] STRIPE_SECRET_KEY not configured");
    return new Response(
      JSON.stringify({ error: "Stripe not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!webhookSecret) {
    console.error("[STRIPE-WEBHOOK] STRIPE_WEBHOOK_SECRET not configured");
    return new Response(
      JSON.stringify({ error: "Webhook secret not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2023-10-16",
  });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // Get the raw body and signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      console.error("[STRIPE-WEBHOOK] Missing stripe-signature header");
      return new Response(
        JSON.stringify({ error: "Missing signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[STRIPE-WEBHOOK] Signature verification failed:", errorMessage);
      return new Response(
        JSON.stringify({ error: `Webhook signature verification failed: ${errorMessage}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[STRIPE-WEBHOOK] Event received:", {
      type: event.type,
      id: event.id,
    });

    // Handle different event types
    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        
        console.log("[STRIPE-WEBHOOK] Processing account.updated", {
          accountId: account.id,
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
        });

        // Find cleaner with this Stripe account ID
        const { data: cleaner, error: findError } = await supabase
          .from("cleaners")
          .select("id, email, first_name, last_name")
          .eq("stripe_account_id", account.id)
          .single();

        if (findError || !cleaner) {
          // Also check metadata for cleaner_id
          const cleanerIdFromMeta = account.metadata?.cleaner_id;
          if (cleanerIdFromMeta) {
            const { error: updateByIdError } = await supabase
              .from("cleaners")
              .update({
                stripe_account_id: account.id,
                charges_enabled: account.charges_enabled ?? false,
                payouts_enabled: account.payouts_enabled ?? false,
                onboarding_complete: account.details_submitted ?? false,
                status: account.details_submitted ? "active" : "pending",
              })
              .eq("id", cleanerIdFromMeta);

            if (updateByIdError) {
              console.error("[STRIPE-WEBHOOK] Failed to update cleaner by ID:", updateByIdError);
            } else {
              console.log("[STRIPE-WEBHOOK] Updated cleaner by metadata ID", {
                cleanerId: cleanerIdFromMeta,
              });
            }
          } else {
            console.log("[STRIPE-WEBHOOK] No cleaner found for account", { 
              accountId: account.id 
            });
          }
          break;
        }

        // Update cleaner status
        const { error: updateError } = await supabase
          .from("cleaners")
          .update({
            charges_enabled: account.charges_enabled ?? false,
            payouts_enabled: account.payouts_enabled ?? false,
            onboarding_complete: account.details_submitted ?? false,
            status: account.details_submitted ? "active" : "pending",
            activated_at: account.details_submitted ? new Date().toISOString() : null,
          })
          .eq("id", cleaner.id);

        if (updateError) {
          console.error("[STRIPE-WEBHOOK] Failed to update cleaner:", updateError);
        } else {
          console.log("[STRIPE-WEBHOOK] Cleaner updated successfully", {
            cleanerId: cleaner.id,
            email: cleaner.email,
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
          });
        }

        break;
      }

      case "account.application.deauthorized": {
        const account = event.data.object as Stripe.Account;
        
        console.log("[STRIPE-WEBHOOK] Account deauthorized:", account.id);

        // Mark cleaner as disconnected
        const { error: updateError } = await supabase
          .from("cleaners")
          .update({
            charges_enabled: false,
            payouts_enabled: false,
            stripe_account_id: null,
            status: "inactive",
          })
          .eq("stripe_account_id", account.id);

        if (updateError) {
          console.error("[STRIPE-WEBHOOK] Failed to deauthorize cleaner:", updateError);
        }

        break;
      }

      case "capability.updated": {
        const capability = event.data.object as Stripe.Capability;
        
        console.log("[STRIPE-WEBHOOK] Capability updated:", {
          account: capability.account,
          id: capability.id,
          status: capability.status,
        });

        // Refresh account status
        if (typeof capability.account === "string") {
          try {
            const account = await stripe.accounts.retrieve(capability.account);
            
            const { error: updateError } = await supabase
              .from("cleaners")
              .update({
                charges_enabled: account.charges_enabled ?? false,
                payouts_enabled: account.payouts_enabled ?? false,
              })
              .eq("stripe_account_id", capability.account);

            if (updateError) {
              console.error("[STRIPE-WEBHOOK] Failed to update after capability change:", updateError);
            }
          } catch (err) {
            console.error("[STRIPE-WEBHOOK] Failed to retrieve account:", err);
          }
        }

        break;
      }

      case "transfer.created": {
        const transfer = event.data.object as Stripe.Transfer;
        
        console.log("[STRIPE-WEBHOOK] Transfer created:", {
          id: transfer.id,
          amount: transfer.amount,
          destination: transfer.destination,
        });

        // Log transfer if we have metadata
        if (transfer.metadata?.payout_id) {
          await supabase
            .from("payouts")
            .update({
              stripe_transfer_id: transfer.id,
              status: "completed",
            })
            .eq("id", transfer.metadata.payout_id);
        }

        break;
      }

      case "transfer.failed": {
        const transfer = event.data.object as Stripe.Transfer;
        
        console.log("[STRIPE-WEBHOOK] Transfer failed:", {
          id: transfer.id,
          destination: transfer.destination,
        });

        if (transfer.metadata?.payout_id) {
          await supabase
            .from("payouts")
            .update({
              status: "failed",
              failed_reason: "Transfer failed",
            })
            .eq("id", transfer.metadata.payout_id);
        }

        break;
      }

      default:
        console.log("[STRIPE-WEBHOOK] Unhandled event type:", event.type);
    }

    return new Response(
      JSON.stringify({ received: true, type: event.type }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[STRIPE-WEBHOOK] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
