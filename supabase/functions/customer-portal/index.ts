import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CUSTOMER-PORTAL] ${step}${detailsStr}`);
};

// Canonical customer-portal origin. The Stripe Billing Portal return_url
// MUST always land on the app subdomain — the try.* booking funnel is a
// public marketing host and has no authenticated UI to receive a portal
// return. Keeping this pinned here prevents an "Origin" header from a
// try.* tab from sending the customer back to a page that can't render
// their account.
const PORTAL_RETURN_ORIGIN = "https://app.novaracleaning.com";

// Ensure a Billing Portal Configuration exists on this Stripe account.
// New Stripe accounts often have no default Customer Portal config; when
// that's the case, billingPortal.sessions.create throws a hard error
// with no actionable hint for the customer. Auto-provisioning a default
// configuration on first use means the portal "just works" the first
// time a customer clicks "Manage Card" without requiring an operator to
// click through Stripe Dashboard wizards.
async function ensurePortalConfiguration(stripe: Stripe) {
  try {
    const list = await stripe.billingPortal.configurations.list({
      is_default: true,
      limit: 1,
    });
    if (list.data.length > 0) {
      logStep("Existing default Billing Portal configuration found", {
        configurationId: list.data[0].id,
      });
      return list.data[0].id;
    }

    logStep("No default Billing Portal config — provisioning one");
    const config = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "NovaraCleaning — manage your card & bookings",
        privacy_policy_url: "https://novaracleaning.com/privacy",
        terms_of_service_url: "https://novaracleaning.com/terms",
      },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: {
          enabled: true,
          allowed_updates: ["email", "phone", "address", "name", "tax_id"],
        },
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          cancellation_reason: {
            enabled: true,
            options: [
              "too_expensive",
              "missing_features",
              "switched_service",
              "unused",
              "customer_service",
              "too_complex",
              "low_quality",
              "other",
            ],
          },
        },
        subscription_pause: { enabled: false },
      },
      default_return_url: `${PORTAL_RETURN_ORIGIN}/account`,
    });
    logStep("Billing Portal configuration provisioned", {
      configurationId: config.id,
    });
    return config.id;
  } catch (err) {
    // Non-fatal — if configuration list/create fails we let the session
    // create attempt run anyway; Stripe will surface the real error.
    logStep("ensurePortalConfiguration failed (non-fatal)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

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

    // Locate the customer for this user. We prefer an exact email match
    // (case-insensitive Stripe lookup), but fall back to creating a new
    // Stripe customer when none exists. Without this fallback a brand-
    // new account (e.g. a customer who only used membership credits and
    // never went through deposit checkout) sees "No Stripe customer
    // found" and can't access the portal at all.
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string;
    if (customers.data.length === 0) {
      logStep("No Stripe customer for email — auto-creating one", { email: user.email });
      // Pull the customer's name/phone from the most recent booking if
      // we have one so the new Stripe customer is not just an email.
      const { data: latestBooking } = await supabaseClient
        .from("bookings")
        .select("first_name, last_name, phone")
        .eq("email", user.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const created = await stripe.customers.create({
        email: user.email,
        name: latestBooking
          ? `${latestBooking.first_name ?? ""} ${latestBooking.last_name ?? ""}`.trim() || undefined
          : undefined,
        phone: latestBooking?.phone || undefined,
        metadata: {
          source: "customer-portal-auto-provision",
          supabase_user_id: user.id,
        },
      });
      customerId = created.id;
      logStep("Auto-created Stripe customer", { customerId });
    } else {
      customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });
    }

    // Make sure a default Billing Portal configuration exists. Without
    // this, brand-new Stripe accounts return a 400 "You must configure
    // the Customer portal before creating sessions" — which is exactly
    // the symptom the customer reported ("can't access payment portal
    // at all via stripe in customer portal").
    const configurationId = await ensurePortalConfiguration(stripe);

    const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
      customer: customerId,
      return_url: `${PORTAL_RETURN_ORIGIN}/account`,
    };
    if (configurationId) {
      sessionParams.configuration = configurationId;
    }

    const portalSession = await stripe.billingPortal.sessions.create(sessionParams);
    logStep("Customer portal session created", {
      sessionId: portalSession.id,
      url: portalSession.url,
    });

    return new Response(
      JSON.stringify({ url: portalSession.url }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in customer-portal", { message: errorMessage });

    // Provide a friendlier hint when Stripe rejects the request because
    // the Billing Portal isn't configured (rare now that we auto-
    // provision a config above, but keep the messaging in case the
    // account is missing required business profile fields).
    const friendly = /Customer portal/i.test(errorMessage) &&
      /configure|configuration|not configured/i.test(errorMessage)
        ? "The Stripe Customer Portal isn't fully configured yet. Please contact support@novaracleaning.com — we'll restore access in minutes."
        : errorMessage;

    return new Response(
      JSON.stringify({ error: friendly }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
