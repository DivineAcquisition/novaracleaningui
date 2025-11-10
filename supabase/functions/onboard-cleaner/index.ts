import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[ONBOARD-CLEANER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cleanerId } = await req.json();
    logStep("Starting onboarding", { cleanerId });
    
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify admin authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    
    if (!userId) throw new Error("Not authenticated");
    
    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    
    if (!roleCheck) {
      throw new Error("Unauthorized - Admin only");
    }

    // Get cleaner details
    const { data: cleaner, error: fetchError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("id", cleanerId)
      .single();

    if (fetchError || !cleaner) {
      throw new Error("Cleaner not found");
    }

    logStep("Retrieved cleaner", { email: cleaner.email });

    // Create Stripe Connect Express account if doesn't exist
    let accountId = cleaner.stripe_account_id;
    
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
        .eq("id", cleanerId);
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${req.headers.get("origin")}/admin/cleaners?refresh=${cleanerId}`,
      return_url: `${req.headers.get("origin")}/admin/cleaners?onboarding=complete&cleaner=${cleanerId}`,
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
