import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { supabase } from "@/integrations/supabase/client";

let stripePromise: Promise<Stripe | null> | null = null;
let publishableKeyPromise: Promise<string> | null = null;

/** Publishable key from env avoids a cold edge round-trip on every checkout. */
function getEnvPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  return key || undefined;
}

async function fetchPublishableKey(): Promise<string> {
  const envKey = getEnvPublishableKey();
  if (envKey) return envKey;

  const { data, error } = await supabase.functions.invoke("get-stripe-publishable-key");
  if (!error && data?.key) return data.key as string;

  const sbUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sxdraeptzuamsgjcvfeg.supabase.co";
  const sbKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I";

  const response = await fetch(`${sbUrl}/functions/v1/get-stripe-publishable-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: sbKey },
  });
  if (!response.ok) throw new Error("Failed to fetch Stripe publishable key");
  const fallbackData = await response.json();
  if (!fallbackData?.key) throw new Error("No Stripe publishable key in response");
  return fallbackData.key as string;
}

/** Cached singleton — safe to call from any booking step. */
export function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!publishableKeyPromise) {
      publishableKeyPromise = fetchPublishableKey();
    }
    stripePromise = publishableKeyPromise.then((key) => loadStripe(key));
  }
  return stripePromise;
}

/** Warm Stripe.js as soon as the customer picks a date/time on the offer step. */
export function preloadStripe(): void {
  getStripePromise().catch((err) => {
    console.warn("[stripe-client] preload failed", err);
  });
}
