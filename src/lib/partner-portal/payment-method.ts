// Update payment method on file — Host (always) and Commercial Stripe Pre-Auth.
// Invoiced commercial accounts pay invoices; they never get a card field here.
// Card collection is an in-page Payment Element + manual-capture pre-auth hold.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { ensureHostCustomer } from "@/lib/host-onboarding/operations";
import {
  resolveAppSecret,
  ensureCommercialCustomer,
  createCardPreAuth,
  readPaymentIntent,
} from "@/lib/stripe-rest";
import type { PartnerIdentity } from "./identity";
import {
  applyDefaultPaymentMethod,
  describeCustomerPaymentMethod,
  paymentMethodFromSetupSession,
  portalCanUpdatePayment,
  type BillingMethod,
} from "./stripe-billing";

export async function openHostPaymentSetup(
  identity: PartnerIdentity,
): Promise<{ ok: boolean; clientSecret?: string; amountCents?: number; error?: string }> {
  const host = identity.hosts[0];
  if (!host) return { ok: false, error: "No host relationship on this account." };
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, error: "Card setup is temporarily unavailable." };

  const supabase = getAdminSupabase();
  const { data: row } = await supabase
    .from("hosts")
    .select("id, email, name, stripe_customer_id")
    .eq("id", host.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Host account not found." };
  const email = String(row.email || identity.email || "");
  if (!email) return { ok: false, error: "No email on file to attach a payment method to." };

  try {
    const customerId = await ensureHostCustomer(stripeKey, {
      hostId: host.id,
      email,
      name: String(row.name || identity.displayName || ""),
      existingId: (row.stripe_customer_id as string) || null,
    });
    await supabase.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
    const hold = await createCardPreAuth(stripeKey, {
      customerId,
      amountCents: 100,
      description: "Novara host card verification hold",
      metadata: { host_id: host.id, kind: "partner_portal_host_preauth" },
    });
    return { ok: true, clientSecret: hold.clientSecret, amountCents: hold.amountCents };
  } catch (err) {
    return { ok: false, error: `Could not open card setup: ${(err as Error).message}` };
  }
}

export async function refreshHostPaymentMethod(
  identity: PartnerIdentity,
  checkoutSessionId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const host = identity.hosts[0];
  if (!host) return { ok: false, error: "No host relationship on this account." };
  const supabase = getAdminSupabase();
  const { data: row } = await supabase
    .from("hosts")
    .select("id, stripe_customer_id, default_payment_method_id")
    .eq("id", host.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Host account not found." };

  let customerId = (row.stripe_customer_id as string) || null;
  let methodId = (row.default_payment_method_id as string) || null;
  if (checkoutSessionId?.startsWith("pi_")) {
    const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
    if (stripeKey) {
      const intent = await readPaymentIntent(stripeKey, checkoutSessionId);
      if (intent.customerId) customerId = intent.customerId;
      if (intent.paymentMethodId) methodId = intent.paymentMethodId;
    }
  } else if (checkoutSessionId) {
    const from = await paymentMethodFromSetupSession(checkoutSessionId);
    if (from.customerId) customerId = from.customerId;
    if (from.paymentMethodId) methodId = from.paymentMethodId;
  }
  if (!methodId && customerId) {
    const described = await describeCustomerPaymentMethod(customerId);
    methodId = described.id;
  }
  if (customerId && methodId) {
    await applyDefaultPaymentMethod(customerId, methodId).catch(() => null);
    await supabase
      .from("hosts")
      .update({ stripe_customer_id: customerId, default_payment_method_id: methodId })
      .eq("id", host.id);
  }
  return { ok: true };
}

function commercialMethod(identity: PartnerIdentity): BillingMethod {
  return identity.accounts[0]?.billingMethod === "invoiced" ? "invoiced" : "auto_pay";
}

export async function openCommercialPaymentSetup(
  identity: PartnerIdentity,
): Promise<{ ok: boolean; clientSecret?: string; amountCents?: number; error?: string }> {
  const account = identity.accounts[0];
  if (!account) return { ok: false, error: "No commercial relationship on this account." };
  if (!portalCanUpdatePayment(commercialMethod(identity))) {
    return {
      ok: false,
      error: "This account is invoiced. Pay each invoice from the billing tab — there's no card to update here.",
    };
  }
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { ok: false, error: "Card setup is temporarily unavailable." };

  const supabase = getAdminSupabase();
  const { data: row } = await supabase
    .from("business_accounts")
    .select("id, email, business_name, stripe_customer_id, preferred_billing_method, billing_method")
    .eq("id", account.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Account not found." };
  const method = row.preferred_billing_method || row.billing_method || "auto_pay";
  if (method === "invoiced") {
    return {
      ok: false,
      error: "This account is invoiced. Pay each invoice from the billing tab — there's no card to update here.",
    };
  }
  const email = String(row.email || identity.email || "");
  if (!email) return { ok: false, error: "No email on file to attach a payment method to." };

  try {
    const customerId = await ensureCommercialCustomer(stripeKey, {
      accountId: account.id,
      email,
      businessName: String(row.business_name || ""),
      existingId: (row.stripe_customer_id as string) || null,
    });
    await supabase.from("business_accounts").update({ stripe_customer_id: customerId }).eq("id", account.id);
    const hold = await createCardPreAuth(stripeKey, {
      customerId,
      amountCents: 100,
      description: `Novara commercial card verification hold — ${String(row.business_name || "")}`,
      metadata: { business_account_id: account.id, kind: "partner_portal_commercial_preauth" },
    });
    return { ok: true, clientSecret: hold.clientSecret, amountCents: hold.amountCents };
  } catch (err) {
    return { ok: false, error: `Could not open card setup: ${(err as Error).message}` };
  }
}

export async function refreshCommercialPaymentMethod(
  identity: PartnerIdentity,
  checkoutSessionId?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const account = identity.accounts[0];
  if (!account) return { ok: false, error: "No commercial relationship on this account." };
  if (!portalCanUpdatePayment(commercialMethod(identity))) {
    return { ok: true };
  }
  const supabase = getAdminSupabase();
  const { data: row } = await supabase
    .from("business_accounts")
    .select("id, stripe_customer_id")
    .eq("id", account.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Account not found." };

  let customerId = (row.stripe_customer_id as string) || null;
  let methodId: string | null = null;
  if (checkoutSessionId?.startsWith("pi_")) {
    const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
    if (stripeKey) {
      const intent = await readPaymentIntent(stripeKey, checkoutSessionId);
      if (intent.customerId) customerId = intent.customerId;
      if (intent.paymentMethodId) methodId = intent.paymentMethodId;
    }
  } else if (checkoutSessionId) {
    const from = await paymentMethodFromSetupSession(checkoutSessionId);
    if (from.customerId) customerId = from.customerId;
    if (from.paymentMethodId) methodId = from.paymentMethodId;
  }
  if (!methodId && customerId) {
    const described = await describeCustomerPaymentMethod(customerId);
    methodId = described.id;
  }
  if (customerId && methodId) {
    await applyDefaultPaymentMethod(customerId, methodId).catch(() => null);
    const described = await describeCustomerPaymentMethod(customerId, methodId);
    await supabase.from("business_accounts").update({ stripe_customer_id: customerId }).eq("id", account.id);
    const { data: profile } = await supabase
      .from("commercial_billing_profiles")
      .select("id, method")
      .eq("business_account_id", account.id)
      .maybeSingle();
    if (profile?.method === "invoiced") return { ok: true };
    const patch = {
      stripe_customer_id: customerId,
      stripe_payment_method_id: methodId,
      payment_method_type: described.type,
      payment_method_brand: described.brand,
      payment_method_last4: described.last4,
      payment_method_added_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (profile) {
      await supabase.from("commercial_billing_profiles").update(patch).eq("business_account_id", account.id);
    } else {
      await supabase.from("commercial_billing_profiles").insert({
        business_account_id: account.id,
        method: "auto_pay",
        ...patch,
      });
    }
  }
  return { ok: true };
}
