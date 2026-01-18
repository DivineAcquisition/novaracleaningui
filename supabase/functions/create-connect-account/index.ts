/**
 * Create Stripe Connect Account
 * 
 * Equivalent to Next.js: /api/stripe/create-connect-account
 * 
 * Creates a Stripe Connect Express account for a cleaner,
 * stores the account ID in Supabase, and returns an onboarding link.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateAccountRequest {
  cleaner_id?: string;
  email?: string;
  name?: string;
  refresh_url?: string;
  return_url?: string;
}

serve(async (req) => {
  // Handle CORS preflight
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase environment variables not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get request body
    const body: CreateAccountRequest = await req.json().catch(() => ({}));
    
    // Get authenticated user if no cleaner_id provided
    let cleanerId = body.cleaner_id;
    let cleanerEmail = body.email;
    let cleanerName = body.name;

    // If no cleaner_id, try to get from auth token
    if (!cleanerId) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const { data: { user } } = await supabase.auth.getUser(token);
        
        if (user) {
          // Find cleaner by user_id
          const { data: cleaner } = await supabase
            .from("cleaners")
            .select("id, email, first_name, last_name, stripe_account_id")
            .eq("user_id", user.id)
            .single();

          if (cleaner) {
            cleanerId = cleaner.id;
            cleanerEmail = cleaner.email;
            cleanerName = `${cleaner.first_name || ''} ${cleaner.last_name || ''}`.trim();

            // Check if already has a valid Stripe account
            if (cleaner.stripe_account_id) {
              try {
                const existingAccount = await stripe.accounts.retrieve(cleaner.stripe_account_id);
                
                // If account exists and is not deleted, return new onboarding link
                if (existingAccount && !existingAccount.deleted) {
                  console.log("[CREATE-CONNECT] Existing account found, creating new link", {
                    accountId: cleaner.stripe_account_id
                  });

                  const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") || 
                                 body.return_url?.replace(/\/[^/]*$/, '') ||
                                 "https://contractor.novaracleaning.com";

                  const accountLink = await stripe.accountLinks.create({
                    account: cleaner.stripe_account_id,
                    refresh_url: body.refresh_url || `${appUrl}/cleaner/dashboard?stripe=refresh`,
                    return_url: body.return_url || `${appUrl}/cleaner/dashboard?stripe=complete`,
                    type: "account_onboarding",
                  });

                  return new Response(
                    JSON.stringify({
                      success: true,
                      account_id: cleaner.stripe_account_id,
                      onboarding_url: accountLink.url,
                      existing_account: true,
                    }),
                    { 
                      headers: { ...corsHeaders, "Content-Type": "application/json" },
                      status: 200,
                    }
                  );
                }
              } catch (stripeErr) {
                // Account doesn't exist or is invalid, will create new one
                console.log("[CREATE-CONNECT] Existing account invalid, creating new", {
                  error: stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
                });
              }
            }
          }
        }
      }
    }

    // Fetch cleaner info if we only have ID
    if (cleanerId && (!cleanerEmail || !cleanerName)) {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("email, first_name, last_name, stripe_account_id")
        .eq("id", cleanerId)
        .single();

      if (cleaner) {
        cleanerEmail = cleanerEmail || cleaner.email;
        cleanerName = cleanerName || `${cleaner.first_name || ''} ${cleaner.last_name || ''}`.trim();
        
        // Check existing account
        if (cleaner.stripe_account_id) {
          try {
            await stripe.accounts.retrieve(cleaner.stripe_account_id);
            // Account exists, create new link for it
            const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") || "https://contractor.novaracleaning.com";
            const accountLink = await stripe.accountLinks.create({
              account: cleaner.stripe_account_id,
              refresh_url: body.refresh_url || `${appUrl}/cleaner/dashboard?stripe=refresh`,
              return_url: body.return_url || `${appUrl}/cleaner/dashboard?stripe=complete`,
              type: "account_onboarding",
            });

            return new Response(
              JSON.stringify({
                success: true,
                account_id: cleaner.stripe_account_id,
                onboarding_url: accountLink.url,
                existing_account: true,
              }),
              { 
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
              }
            );
          } catch {
            // Account invalid, clear it
            await supabase
              .from("cleaners")
              .update({ stripe_account_id: null })
              .eq("id", cleanerId);
          }
        }
      }
    }

    if (!cleanerId) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "cleaner_id is required or user must be authenticated as a cleaner" 
        }),
        { 
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log("[CREATE-CONNECT] Creating new Stripe Connect account", {
      cleanerId,
      email: cleanerEmail,
    });

    // Create Stripe Connect Express account
    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: cleanerEmail || undefined,
      business_type: "individual",
      individual: cleanerName ? {
        first_name: cleanerName.split(' ')[0],
        last_name: cleanerName.split(' ').slice(1).join(' ') || undefined,
      } : undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        cleaner_id: cleanerId,
        platform: "novara_cleaning",
      },
      settings: {
        payouts: {
          schedule: {
            interval: "daily",
          },
        },
      },
    });

    console.log("[CREATE-CONNECT] Stripe account created", { 
      accountId: account.id,
      cleanerId 
    });

    // Store Stripe account ID in Supabase
    const { error: updateError } = await supabase
      .from("cleaners")
      .update({
        stripe_account_id: account.id,
        charges_enabled: false,
        payouts_enabled: false,
      })
      .eq("id", cleanerId);

    if (updateError) {
      console.error("[CREATE-CONNECT] Failed to update cleaner", updateError);
      // Don't fail the request, account is created
    }

    // Create onboarding link
    const appUrl = Deno.env.get("NEXT_PUBLIC_APP_URL") || "https://contractor.novaracleaning.com";
    
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: body.refresh_url || `${appUrl}/cleaner/dashboard?stripe=refresh`,
      return_url: body.return_url || `${appUrl}/cleaner/dashboard?stripe=complete`,
      type: "account_onboarding",
    });

    console.log("[CREATE-CONNECT] Onboarding link created", {
      accountId: account.id,
      url: accountLink.url,
    });

    return new Response(
      JSON.stringify({
        success: true,
        account_id: account.id,
        onboarding_url: accountLink.url,
        existing_account: false,
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CREATE-CONNECT] Error:", errorMessage);
    
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
