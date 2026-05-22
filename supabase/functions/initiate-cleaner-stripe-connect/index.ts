import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-session-expiry",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[INITIATE-CLEANER-STRIPE] ${step}${detailsStr}`);
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ─── Authenticate cleaner ─────────────────────────────────────────
    // Auth failures return 401, not 500, so unauthenticated health
    // probes and mis-tabbed sessions don't bury the real Stripe path.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    const userEmail = (userData?.user?.email || "").toLowerCase();

    if (!userId) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }
    logStep("Authenticated user", { userId, userEmail });

    // ─── Resolve cleaner profile ──────────────────────────────────────
    // Try user_id first; fall back to email match and STAMP user_id on
    // the row so subsequent RLS-gated queries (and every other cleaner-
    // facing edge function) work. This mirrors the
    // resolve_or_link_cleaner_for_user RPC the cleaner-auth helper uses
    // — same behavior, in-function so we don't pay the RPC round trip.
    let { data: cleaner } = await supabase
      .from("cleaners")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!cleaner && userEmail) {
      const { data: byEmail } = await supabase
        .from("cleaners")
        .select("*")
        .ilike("email", userEmail)
        .is("user_id", null)
        .maybeSingle();
      if (byEmail?.id) {
        const { data: linked } = await supabase
          .from("cleaners")
          .update({ user_id: userId, updated_at: new Date().toISOString() })
          .eq("id", byEmail.id)
          .select("*")
          .single();
        cleaner = linked;
        logStep("Auto-linked cleaner by email", { cleanerId: cleaner?.id });
      }
    }

    if (!cleaner) {
      return jsonResponse({ error: "Cleaner profile not found" }, 404);
    }

    logStep("Retrieved cleaner", { email: cleaner.email, cleanerId: cleaner.id });

    // ─── Resolve Stripe key + initialize client ──────────────────────
    const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return jsonResponse(
        { error: "Stripe is not configured (STRIPE_SECRET_KEY missing)" },
        500,
      );
    }
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // ─── Create or retrieve Stripe Connect account ────────────────────
    let accountId = cleaner.stripe_account_id as string | null;

    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
        logStep("Verified existing Stripe account", { accountId });
      } catch (verifyError) {
        logStep("Existing account invalid, will create new", {
          accountId,
          error:
            verifyError instanceof Error
              ? verifyError.message
              : String(verifyError),
        });
        accountId = null;
        await supabase
          .from("cleaners")
          .update({ stripe_account_id: null })
          .eq("id", cleaner.id);
      }
    }

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: cleaner.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: {
          cleaner_id: cleaner.id,
          source: "novara_contractor_portal",
        },
      });

      accountId = account.id;
      logStep("Created Stripe account", { accountId });

      await supabase
        .from("cleaners")
        .update({ stripe_account_id: accountId })
        .eq("id", cleaner.id);
    }

    // ─── Account link for hosted onboarding ──────────────────────────
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url:
        "https://contractor.novaracleaning.com/cleaner/dashboard?stripe=refresh",
      return_url:
        "https://contractor.novaracleaning.com/cleaner/dashboard?stripe=complete",
      type: "account_onboarding",
    });

    logStep("Created account link", { url: accountLink.url });

    return jsonResponse({ url: accountLink.url, accountId });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null
          ? (error as { message?: string }).message || JSON.stringify(error)
          : String(error);
    logStep("ERROR", { message: errorMessage, error });
    return jsonResponse({ error: errorMessage }, 500);
  }
});
