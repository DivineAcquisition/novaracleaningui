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
