import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    name: string;
    status: "pass" | "fail" | "warn";
    message: string;
    details?: any;
  }[];
  environment: {
    hasPublishableKey: boolean;
    hasSecretKey: boolean;
    hasWebhookSecret: boolean;
    hasConnectWebhookSecret: boolean;
    stripeMode: "test" | "live" | "unknown";
  };
  recommendations: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const result: HealthCheckResult = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    checks: [],
    environment: {
      hasPublishableKey: false,
      hasSecretKey: false,
      hasWebhookSecret: false,
      hasConnectWebhookSecret: false,
      stripeMode: "unknown",
    },
    recommendations: [],
  };

  // Check environment variables
  const publishableKey = Deno.env.get("STRIPE_PUBLISHABLE_KEY");
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const connectWebhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET");

  // Publishable Key Check
  if (publishableKey) {
    result.environment.hasPublishableKey = true;
    if (publishableKey.startsWith("pk_test_")) {
      result.environment.stripeMode = "test";
      result.checks.push({
        name: "STRIPE_PUBLISHABLE_KEY",
        status: "pass",
        message: "Publishable key configured (test mode)",
        details: { prefix: publishableKey.substring(0, 12) + "..." },
      });
    } else if (publishableKey.startsWith("pk_live_")) {
      result.environment.stripeMode = "live";
      result.checks.push({
        name: "STRIPE_PUBLISHABLE_KEY",
        status: "pass",
        message: "Publishable key configured (live mode)",
        details: { prefix: publishableKey.substring(0, 12) + "..." },
      });
    } else {
      result.checks.push({
        name: "STRIPE_PUBLISHABLE_KEY",
        status: "fail",
        message: "Invalid publishable key format - must start with pk_test_ or pk_live_",
      });
      result.status = "unhealthy";
    }
  } else {
    result.checks.push({
      name: "STRIPE_PUBLISHABLE_KEY",
      status: "fail",
      message: "Missing - required for payment form to load",
    });
    result.status = "unhealthy";
    result.recommendations.push("Set STRIPE_PUBLISHABLE_KEY in Supabase secrets");
  }

  // Secret Key Check
  if (secretKey) {
    result.environment.hasSecretKey = true;
    if (secretKey.startsWith("sk_test_") || secretKey.startsWith("sk_live_")) {
      result.checks.push({
        name: "STRIPE_SECRET_KEY",
        status: "pass",
        message: `Secret key configured (${secretKey.startsWith("sk_test_") ? "test" : "live"} mode)`,
        details: { prefix: secretKey.substring(0, 10) + "..." },
      });

      // Verify Stripe connection
      try {
        const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });
        const account = await stripe.accounts.retrieve();
        result.checks.push({
          name: "Stripe API Connection",
          status: "pass",
          message: "Successfully connected to Stripe",
          details: {
            accountId: account.id,
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            country: account.country,
          },
        });
      } catch (error: any) {
        result.checks.push({
          name: "Stripe API Connection",
          status: "fail",
          message: `Failed to connect: ${error.message}`,
        });
        result.status = "unhealthy";
      }
    } else {
      result.checks.push({
        name: "STRIPE_SECRET_KEY",
        status: "fail",
        message: "Invalid secret key format - must start with sk_test_ or sk_live_",
      });
      result.status = "unhealthy";
    }
  } else {
    result.checks.push({
      name: "STRIPE_SECRET_KEY",
      status: "fail",
      message: "Missing - required for payment processing",
    });
    result.status = "unhealthy";
    result.recommendations.push("Set STRIPE_SECRET_KEY in Supabase secrets");
  }

  // Webhook Secret Check
  if (webhookSecret) {
    result.environment.hasWebhookSecret = true;
    if (webhookSecret.startsWith("whsec_")) {
      result.checks.push({
        name: "STRIPE_WEBHOOK_SECRET",
        status: "pass",
        message: "Webhook secret configured",
        details: { prefix: webhookSecret.substring(0, 10) + "..." },
      });
    } else {
      result.checks.push({
        name: "STRIPE_WEBHOOK_SECRET",
        status: "warn",
        message: "Webhook secret has unusual format - should start with whsec_",
      });
      if (result.status === "healthy") result.status = "degraded";
    }
  } else {
    result.checks.push({
      name: "STRIPE_WEBHOOK_SECRET",
      status: "warn",
      message: "Missing - webhooks will not be verified (security risk)",
    });
    if (result.status === "healthy") result.status = "degraded";
    result.recommendations.push("Set STRIPE_WEBHOOK_SECRET for secure webhook handling");
  }

  // Connect Webhook Secret Check (optional but recommended)
  if (connectWebhookSecret) {
    result.environment.hasConnectWebhookSecret = true;
    result.checks.push({
      name: "STRIPE_CONNECT_WEBHOOK_SECRET",
      status: "pass",
      message: "Connect webhook secret configured",
    });
  } else {
    result.checks.push({
      name: "STRIPE_CONNECT_WEBHOOK_SECRET",
      status: "warn",
      message: "Missing - Stripe Connect webhooks will not work",
    });
    result.recommendations.push("Set STRIPE_CONNECT_WEBHOOK_SECRET if using Stripe Connect for cleaner payouts");
  }

  // Mode consistency check
  if (result.environment.hasPublishableKey && result.environment.hasSecretKey) {
    const pkMode = publishableKey?.includes("test") ? "test" : "live";
    const skMode = secretKey?.includes("test") ? "test" : "live";
    
    if (pkMode !== skMode) {
      result.checks.push({
        name: "Key Mode Consistency",
        status: "fail",
        message: `Publishable key is ${pkMode} mode but secret key is ${skMode} mode - they must match!`,
      });
      result.status = "unhealthy";
      result.recommendations.push("Ensure both keys are from the same Stripe mode (test or live)");
    } else {
      result.checks.push({
        name: "Key Mode Consistency",
        status: "pass",
        message: `Both keys are in ${pkMode} mode`,
      });
    }
  }

  // Supabase environment check
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  result.checks.push({
    name: "SUPABASE_URL",
    status: supabaseUrl ? "pass" : "fail",
    message: supabaseUrl ? "Configured" : "Missing",
  });

  result.checks.push({
    name: "SUPABASE_ANON_KEY",
    status: supabaseAnonKey ? "pass" : "fail",
    message: supabaseAnonKey ? "Configured" : "Missing",
  });

  result.checks.push({
    name: "SUPABASE_SERVICE_ROLE_KEY",
    status: supabaseServiceKey ? "pass" : "fail",
    message: supabaseServiceKey ? "Configured" : "Missing",
  });

  // Summary
  const failedChecks = result.checks.filter(c => c.status === "fail").length;
  const warnChecks = result.checks.filter(c => c.status === "warn").length;

  if (failedChecks > 0) {
    result.status = "unhealthy";
  } else if (warnChecks > 0) {
    result.status = "degraded";
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: result.status === "unhealthy" ? 503 : 200,
  });
});
