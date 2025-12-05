import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[INITIATE-CLEANER-STRIPE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Authenticate cleaner
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    
    if (!userId) throw new Error("Not authenticated");
    
    logStep("Authenticated user", { userId });

    // Get cleaner profile
    const { data: cleaner, error: fetchError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (fetchError || !cleaner) {
      throw new Error("Cleaner profile not found");
    }

    logStep("Retrieved cleaner", { email: cleaner.email, cleanerId: cleaner.id });

    // Create or retrieve Stripe Connect account
    let accountId = cleaner.stripe_account_id;
    
    // Verify existing account if we have one
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
        logStep("Verified existing Stripe account", { accountId });
      } catch (verifyError) {
        // Account doesn't exist or isn't connected - clear it and create new
        logStep("Existing account invalid, will create new", { 
          accountId, 
          error: verifyError instanceof Error ? verifyError.message : String(verifyError) 
        });
        accountId = null;
        
        // Clear the invalid account ID from database
        await supabase
          .from("cleaners")
          .update({ stripe_account_id: null })
          .eq("id", cleaner.id);
      }
    }
    
    // Create new account if needed
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: cleaner.email,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: "individual",
      });
      
      accountId = account.id;
      logStep("Created Stripe account", { accountId });
      
      // Update cleaner with Stripe account ID
      await supabase
        .from("cleaners")
        .update({ stripe_account_id: accountId })
        .eq("id", cleaner.id);
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `https://contractor.novaracleaning.com/cleaner/dashboard?stripe=refresh`,
      return_url: `https://contractor.novaracleaning.com/cleaner/dashboard?stripe=complete`,
      type: "account_onboarding",
    });

    logStep("Created account link", { url: accountLink.url });

    return new Response(
      JSON.stringify({ url: accountLink.url }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
