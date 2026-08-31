// ─── Minimal Stripe REST helper for Next API routes ────────────────────────
//
// The edge functions use the Stripe SDK; the Next routes have always talked to
// the API directly rather than pulling the SDK into the server bundle. This is
// that call, in one place, so the commercial billing routes and the account
// actions cannot drift on secret resolution or error shape.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

/** app_secrets first, environment second — the precedence used everywhere. */
export async function resolveAppSecret(key: string): Promise<string> {
  const supabase = getAdminSupabase();
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through to env */
  }
  return (process.env[key] || "").trim();
}

export async function stripeCall(
  key: string,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, any>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

/** The Stripe customer for a commercial account, created if this is the first. */
export async function ensureCommercialCustomer(
  stripeKey: string,
  args: { accountId: string; email: string; businessName: string; existingId?: string | null },
): Promise<string> {
  if (args.existingId) return args.existingId;

  const found = await stripeCall(stripeKey, "GET", "customers", { email: args.email, limit: "1" });
  const existing = found?.data?.[0]?.id as string | undefined;
  if (existing) return existing;

  const created = await stripeCall(stripeKey, "POST", "customers", {
    email: args.email,
    name: args.businessName,
    "metadata[business_account_id]": args.accountId,
    "metadata[kind]": "commercial",
  });
  return String(created.id);
}

/** Stripe's card minimum. A $0.50 hold is enough to prove the card works. */
export const MIN_PREAUTH_CENTS = 50;

export function holdAmountCents(raw: number): number {
  const n = Math.round(Number(raw) || 0);
  return Math.max(MIN_PREAUTH_CENTS, n);
}

export function paymentIntentIsHeld(status: string): boolean {
  return status === "requires_capture" || status === "succeeded" || status === "processing";
}

export function paymentIntentNeedsCard(status: string): boolean {
  return status === "requires_payment_method" || status === "requires_confirmation" || status === "requires_action";
}

/**
 * Manual-capture PaymentIntent so we place a pre-auth hold and save the card
 * (setup_future_usage) without sending the customer to Checkout.
 */
export async function createCardPreAuth(
  stripeKey: string,
  args: {
    customerId: string;
    amountCents: number;
    description: string;
    metadata: Record<string, string>;
  },
): Promise<{ id: string; clientSecret: string; amountCents: number }> {
  const amount = holdAmountCents(args.amountCents);
  const params: Record<string, string> = {
    amount: String(amount),
    currency: "usd",
    customer: args.customerId,
    capture_method: "manual",
    setup_future_usage: "off_session",
    "payment_method_types[0]": "card",
    description: args.description.slice(0, 220),
  };
  for (const [k, v] of Object.entries(args.metadata)) {
    if (v) params[`metadata[${k}]`] = String(v).slice(0, 500);
  }
  const pi = await stripeCall(stripeKey, "POST", "payment_intents", params);
  const clientSecret = String(pi.client_secret || "");
  if (!clientSecret) throw new Error("Stripe did not return a client secret for the pre-auth hold.");
  return { id: String(pi.id), clientSecret, amountCents: amount };
}

export async function readPaymentIntent(
  stripeKey: string,
  intentId: string,
): Promise<{
  id: string;
  paymentMethodId: string | null;
  customerId: string | null;
  status: string;
  clientSecret: string | null;
  amountCents: number;
  held: boolean;
  needsCard: boolean;
}> {
  const pi = await stripeCall(stripeKey, "GET", `payment_intents/${intentId}`);
  const status = String(pi.status || "");
  return {
    id: String(pi.id || intentId),
    paymentMethodId: pi.payment_method ? String(pi.payment_method) : null,
    customerId: pi.customer ? String(pi.customer) : null,
    status,
    clientSecret: pi.client_secret ? String(pi.client_secret) : null,
    amountCents: Number(pi.amount || 0),
    held: paymentIntentIsHeld(status),
    needsCard: paymentIntentNeedsCard(status),
  };
}

export function setupIntentIsReady(status: string): boolean {
  return status === "succeeded";
}

export function setupIntentNeedsCard(status: string): boolean {
  return status === "requires_payment_method" || status === "requires_confirmation" || status === "requires_action";
}

/**
 * Save a card with no hold and no charge. Used for host Pay in Full / Pay After
 * onboarding — Split Payment is the only option that places a Pre-Auth hold.
 */
export async function createSetupIntent(
  stripeKey: string,
  args: {
    customerId: string;
    metadata: Record<string, string>;
  },
): Promise<{ id: string; clientSecret: string }> {
  const params: Record<string, string> = {
    customer: args.customerId,
    usage: "off_session",
    "payment_method_types[0]": "card",
  };
  for (const [k, v] of Object.entries(args.metadata)) {
    if (v) params[`metadata[${k}]`] = String(v).slice(0, 500);
  }
  const si = await stripeCall(stripeKey, "POST", "setup_intents", params);
  const clientSecret = String(si.client_secret || "");
  if (!clientSecret) throw new Error("Stripe did not return a client secret for card setup.");
  return { id: String(si.id), clientSecret };
}

export async function readSetupIntent(
  stripeKey: string,
  intentId: string,
): Promise<{
  id: string;
  paymentMethodId: string | null;
  customerId: string | null;
  status: string;
  clientSecret: string | null;
  ready: boolean;
  needsCard: boolean;
}> {
  const si = await stripeCall(stripeKey, "GET", `setup_intents/${intentId}`);
  const status = String(si.status || "");
  return {
    id: String(si.id || intentId),
    paymentMethodId: si.payment_method ? String(si.payment_method) : null,
    customerId: si.customer ? String(si.customer) : null,
    status,
    clientSecret: si.client_secret ? String(si.client_secret) : null,
    ready: setupIntentIsReady(status),
    needsCard: setupIntentNeedsCard(status),
  };
}

/** Half of a dollar amount, as cents, never below Stripe's card minimum. */
export function splitHoldAmountCents(turnoverPriceDollars: number): number {
  const fullCents = Math.round(Number(turnoverPriceDollars || 0) * 100);
  return holdAmountCents(Math.round(fullCents / 2));
}
