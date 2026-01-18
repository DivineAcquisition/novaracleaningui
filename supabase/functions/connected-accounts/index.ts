/**
 * Get Connected Accounts for Dashboard
 * 
 * Equivalent to Next.js: /api/stripe/connected-accounts
 * 
 * Fetches all cleaners with their Stripe Connect status
 * for admin dashboard display.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ConnectedAccount {
  cleaner_id: string;
  name: string;
  email: string;
  phone: string | null;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
  status: string;
  created_at: string;
  stripe_details?: {
    type: string;
    country: string;
    default_currency: string;
    details_submitted: boolean;
    requirements?: {
      currently_due: string[];
      eventually_due: string[];
      pending_verification: string[];
    };
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse query parameters
    const url = new URL(req.url);
    const includeStripeDetails = url.searchParams.get("include_stripe_details") === "true";
    const statusFilter = url.searchParams.get("status"); // 'active', 'pending', 'all'
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    console.log("[CONNECTED-ACCOUNTS] Fetching accounts", {
      includeStripeDetails,
      statusFilter,
      limit,
      offset,
    });

    // Build query
    let query = supabase
      .from("cleaners")
      .select(`
        id,
        first_name,
        last_name,
        email,
        phone,
        stripe_account_id,
        charges_enabled,
        payouts_enabled,
        onboarding_complete,
        status,
        created_at
      `)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply status filter
    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data: cleaners, error: fetchError, count } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch cleaners: ${fetchError.message}`);
    }

    // Build response with optional Stripe details
    const accounts: ConnectedAccount[] = [];

    for (const cleaner of cleaners || []) {
      const account: ConnectedAccount = {
        cleaner_id: cleaner.id,
        name: `${cleaner.first_name || ''} ${cleaner.last_name || ''}`.trim() || 'Unknown',
        email: cleaner.email || '',
        phone: cleaner.phone,
        stripe_account_id: cleaner.stripe_account_id,
        charges_enabled: cleaner.charges_enabled ?? false,
        payouts_enabled: cleaner.payouts_enabled ?? false,
        onboarding_complete: cleaner.onboarding_complete ?? false,
        status: cleaner.status || 'pending',
        created_at: cleaner.created_at,
      };

      // Optionally fetch live Stripe data
      if (includeStripeDetails && cleaner.stripe_account_id) {
        try {
          const stripeAccount = await stripe.accounts.retrieve(cleaner.stripe_account_id);
          
          account.stripe_details = {
            type: stripeAccount.type || 'express',
            country: stripeAccount.country || 'US',
            default_currency: stripeAccount.default_currency || 'usd',
            details_submitted: stripeAccount.details_submitted ?? false,
            requirements: {
              currently_due: stripeAccount.requirements?.currently_due || [],
              eventually_due: stripeAccount.requirements?.eventually_due || [],
              pending_verification: stripeAccount.requirements?.pending_verification || [],
            },
          };

          // Update local status if different from Stripe
          if (
            account.charges_enabled !== stripeAccount.charges_enabled ||
            account.payouts_enabled !== stripeAccount.payouts_enabled
          ) {
            account.charges_enabled = stripeAccount.charges_enabled ?? false;
            account.payouts_enabled = stripeAccount.payouts_enabled ?? false;
            account.onboarding_complete = stripeAccount.details_submitted ?? false;

            // Update Supabase in background
            supabase
              .from("cleaners")
              .update({
                charges_enabled: account.charges_enabled,
                payouts_enabled: account.payouts_enabled,
                onboarding_complete: account.onboarding_complete,
              })
              .eq("id", cleaner.id)
              .then(({ error }) => {
                if (error) {
                  console.error("[CONNECTED-ACCOUNTS] Failed to sync status:", error);
                }
              });
          }
        } catch (stripeErr) {
          console.error("[CONNECTED-ACCOUNTS] Failed to fetch Stripe account:", {
            accountId: cleaner.stripe_account_id,
            error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
          });

          // Mark account as invalid if it doesn't exist
          account.stripe_details = undefined;
        }
      }

      accounts.push(account);
    }

    // Get counts by status
    const { data: statusCounts } = await supabase
      .from("cleaners")
      .select("status")
      .then(({ data }) => {
        const counts = {
          total: data?.length || 0,
          active: data?.filter(c => c.status === 'active').length || 0,
          pending: data?.filter(c => c.status === 'pending').length || 0,
          inactive: data?.filter(c => c.status === 'inactive').length || 0,
          with_stripe: data?.filter(c => c.status === 'active' || c.status === 'pending').length || 0,
        };
        return { data: counts };
      });

    console.log("[CONNECTED-ACCOUNTS] Returning accounts", {
      count: accounts.length,
      statusCounts,
    });

    return new Response(
      JSON.stringify({
        success: true,
        accounts,
        pagination: {
          limit,
          offset,
          total: count || accounts.length,
        },
        summary: statusCounts,
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CONNECTED-ACCOUNTS] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
