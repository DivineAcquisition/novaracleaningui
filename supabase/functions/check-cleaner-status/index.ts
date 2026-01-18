import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-CLEANER-STATUS] ${step}${detailsStr}`);
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

    // Try to get cleanerId from body, otherwise use authenticated user
    let cleanerId: string | null = null;
    let cleaner: any = null;

    try {
      const body = await req.json();
      cleanerId = body?.cleanerId;
    } catch {
      // No body or invalid JSON - that's fine
    }

    if (cleanerId) {
      // Get cleaner by ID
      logStep("Checking status by cleaner ID", { cleanerId });
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("id", cleanerId)
        .single();
      
      if (error || !data) {
        throw new Error("Cleaner not found");
      }
      cleaner = data;
    } else {
      // Get cleaner by authenticated user
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        throw new Error("Not authenticated and no cleanerId provided");
      }
      
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabase.auth.getUser(token);
      const userId = userData?.user?.id;
      
      if (!userId) {
        throw new Error("Not authenticated");
      }
      
      logStep("Checking status by user ID", { userId });
      
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", userId)
        .single();
      
      if (error || !data) {
        throw new Error("Cleaner profile not found for this user");
      }
      cleaner = data;
    }

    logStep("Found cleaner", { 
      cleanerId: cleaner.id, 
      email: cleaner.email,
      stripeAccountId: cleaner.stripe_account_id 
    });

    // If no Stripe account, return current status
    if (!cleaner.stripe_account_id) {
      logStep("No Stripe account linked");
      return new Response(
        JSON.stringify({
          success: true,
          has_stripe_account: false,
          onboarding_complete: cleaner.onboarding_complete || false,
          payouts_enabled: false,
          stripe_onboarding_complete: false,
          status: cleaner.status || 'pending',
          message: "No Stripe account linked. Please complete payment setup."
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Check Stripe account status
    let account;
    try {
      account = await stripe.accounts.retrieve(cleaner.stripe_account_id);
      logStep("Retrieved Stripe account", { 
        accountId: account.id,
        detailsSubmitted: account.details_submitted,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled
      });
    } catch (stripeError: any) {
      logStep("Stripe account retrieval failed", { error: stripeError.message });
      
      // Clear invalid Stripe account
      await supabase
        .from("cleaners")
        .update({ 
          stripe_account_id: null,
          payouts_enabled: false 
        })
        .eq("id", cleaner.id);
      
      return new Response(
        JSON.stringify({
          success: true,
          has_stripe_account: false,
          onboarding_complete: cleaner.onboarding_complete || false,
          payouts_enabled: false,
          stripe_onboarding_complete: false,
          status: 'pending',
          message: "Stripe account invalid. Please set up payment again."
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const stripeOnboardingComplete = account.details_submitted || false;
    const payoutsEnabled = account.payouts_enabled || false;
    const chargesEnabled = account.charges_enabled || false;

    // Determine what's missing if not fully enabled
    const requirements = account.requirements;
    const pendingVerification = requirements?.pending_verification || [];
    const currentlyDue = requirements?.currently_due || [];
    const eventuallyDue = requirements?.eventually_due || [];

    let statusMessage = "";
    if (payoutsEnabled && chargesEnabled) {
      statusMessage = "Your payment account is fully set up and ready to receive payouts!";
    } else if (stripeOnboardingComplete && !payoutsEnabled) {
      statusMessage = "Your account is under review. Payouts will be enabled shortly.";
    } else if (currentlyDue.length > 0) {
      statusMessage = `Please complete your account setup. ${currentlyDue.length} item(s) needed.`;
    } else if (pendingVerification.length > 0) {
      statusMessage = "Your information is being verified. This usually takes 1-2 business days.";
    } else {
      statusMessage = "Please complete your payment account setup.";
    }

    // Update cleaner record
    const updateData: any = {
      payouts_enabled: payoutsEnabled,
    };

    // Only update onboarding_complete if stripe is done
    if (stripeOnboardingComplete && !cleaner.onboarding_complete) {
      updateData.onboarding_complete = true;
    }

    // Update status if needed
    if (payoutsEnabled && cleaner.status !== 'active') {
      updateData.status = 'active';
      if (!cleaner.activated_at) {
        updateData.activated_at = new Date().toISOString();
      }
    }

    const { error: updateError } = await supabase
      .from("cleaners")
      .update(updateData)
      .eq("id", cleaner.id);

    if (updateError) {
      logStep("Update error", { error: updateError });
    } else {
      logStep("Updated cleaner status", updateData);
    }

    return new Response(
      JSON.stringify({
        success: true,
        has_stripe_account: true,
        onboarding_complete: cleaner.onboarding_complete || stripeOnboardingComplete,
        stripe_onboarding_complete: stripeOnboardingComplete,
        payouts_enabled: payoutsEnabled,
        charges_enabled: chargesEnabled,
        status: payoutsEnabled ? 'active' : 'pending',
        message: statusMessage,
        requirements: {
          pending_verification: pendingVerification,
          currently_due: currentlyDue,
          eventually_due: eventuallyDue
        }
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200, // Return 200 with error in body for better client handling
      }
    );
  }
});
