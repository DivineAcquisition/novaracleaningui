// Stripe Invoicing + payment-method helpers for the partner portal.
// Invoiced commercial accounts see Stripe invoices (status + Net-terms due
// date). Stripe Pre-Auth accounts see charge history. Hosts keep a card on
// file. None of this is a parallel AR system.

import { resolveAppSecret, stripeCall } from "@/lib/stripe-rest";

export type BillingMethod = "auto_pay" | "invoiced";
export type InvoiceFacingStatus = "paid" | "outstanding" | "overdue";

export interface PortalLedgerRow {
  id: string;
  date: string;
  amountCents: number;
  url: string | null;
  status: InvoiceFacingStatus;
  dueDate: string | null;
}

export interface PortalPaymentMethod {
  onFile: boolean;
  id: string | null;
  brand: string | null;
  last4: string | null;
  type: "card" | "us_bank_account" | null;
}

export function portalCanUpdatePayment(method: BillingMethod): boolean {
  return method === "auto_pay";
}

export function netTermsLabel(terms: string | null | undefined): string | null {
  if (!terms) return null;
  if (terms === "on_receipt") return "Due on receipt";
  if (terms === "net_15") return "Net 15";
  if (terms === "net_30") return "Net 30";
  if (terms === "net_45") return "Net 45";
  if (terms === "none") return null;
  return terms.replace(/_/g, " ");
}

export function netTermsDueDate(serviceDate: string, netTerms: string | null | undefined): string {
  const day = String(serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const add =
    netTerms === "net_15" ? 15 : netTerms === "net_30" ? 30 : netTerms === "net_45" ? 45 : 0;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}

export function facingInvoiceStatus(input: {
  status: string;
  dueDate?: string | null;
  nowDay?: string;
}): InvoiceFacingStatus {
  const status = String(input.status || "").toLowerCase();
  if (status === "paid" || status === "succeeded" || status === "complete") return "paid";
  const due = (input.dueDate || "").slice(0, 10);
  const today = input.nowDay || new Date().toISOString().slice(0, 10);
  if ((status === "open" || status === "outstanding" || status === "past_due") && due && due < today) {
    return "overdue";
  }
  if (status === "past_due" || status === "overdue") return "overdue";
  return "outstanding";
}

function unixDay(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(Number(sec))) return null;
  return new Date(Number(sec) * 1000).toISOString().slice(0, 10);
}

export async function describeCustomerPaymentMethod(
  customerId: string | null | undefined,
  paymentMethodId?: string | null,
): Promise<PortalPaymentMethod> {
  const empty: PortalPaymentMethod = { onFile: false, id: null, brand: null, last4: null, type: null };
  if (!customerId && !paymentMethodId) return empty;
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return empty;
  try {
    let pmId = paymentMethodId || null;
    if (!pmId && customerId) {
      const customer = await stripeCall(stripeKey, "GET", `customers/${customerId}`);
      const def = customer?.invoice_settings?.default_payment_method;
      pmId = typeof def === "string" ? def : def?.id || null;
    }
    if (!pmId && customerId) {
      const list = await stripeCall(stripeKey, "GET", "payment_methods", {
        customer: customerId,
        type: "card",
        limit: "1",
      });
      pmId = (list?.data?.[0]?.id as string) || null;
    }
    if (!pmId) return empty;
    const pm = await stripeCall(stripeKey, "GET", `payment_methods/${pmId}`);
    const type = pm?.type === "us_bank_account" ? "us_bank_account" : pm?.type === "card" ? "card" : null;
    const brand =
      type === "card" ? String(pm?.card?.brand || "card") : String(pm?.us_bank_account?.bank_name || "bank");
    const last4 = type === "card" ? String(pm?.card?.last4 || "") : String(pm?.us_bank_account?.last4 || "");
    return { onFile: true, id: pmId, brand, last4: last4 || null, type };
  } catch {
    return empty;
  }
}

export async function listStripeInvoices(customerId: string | null | undefined): Promise<PortalLedgerRow[]> {
  if (!customerId) return [];
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return [];
  try {
    const res = await stripeCall(stripeKey, "GET", "invoices", { customer: customerId, limit: "40" });
    const rows: PortalLedgerRow[] = [];
    for (const inv of res?.data || []) {
      const status = String(inv.status || "");
      if (status === "draft" || status === "void") continue;
      const dueDate = unixDay(inv.due_date) || unixDay(inv.created);
      rows.push({
        id: String(inv.id),
        date: unixDay(inv.created) || dueDate || "",
        amountCents: Number(inv.total ?? inv.amount_due ?? 0),
        url: inv.hosted_invoice_url || inv.invoice_pdf || null,
        status: facingInvoiceStatus({ status, dueDate }),
        dueDate,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function listStripeCharges(customerId: string | null | undefined): Promise<PortalLedgerRow[]> {
  if (!customerId) return [];
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return [];
  try {
    const res = await stripeCall(stripeKey, "GET", "charges", { customer: customerId, limit: "40" });
    const rows: PortalLedgerRow[] = [];
    for (const ch of res?.data || []) {
      if (ch.status === "failed") continue;
      rows.push({
        id: String(ch.id),
        date: unixDay(ch.created) || "",
        amountCents: Number(ch.amount || 0),
        url: ch.receipt_url || null,
        status: ch.status === "succeeded" ? "paid" : "outstanding",
        dueDate: unixDay(ch.created),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function applyDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return;
  await stripeCall(stripeKey, "POST", `payment_methods/${paymentMethodId}/attach`, {
    customer: customerId,
  }).catch(() => null);
  await stripeCall(stripeKey, "POST", `customers/${customerId}`, {
    "invoice_settings[default_payment_method]": paymentMethodId,
  });
}

export async function paymentMethodFromSetupSession(
  checkoutSessionId: string,
): Promise<{ customerId: string | null; paymentMethodId: string | null }> {
  const stripeKey = await resolveAppSecret("STRIPE_SECRET_KEY");
  if (!stripeKey) return { customerId: null, paymentMethodId: null };
  try {
    const session = await stripeCall(stripeKey, "GET", `checkout/sessions/${checkoutSessionId}`);
    const customerId = session?.customer ? String(session.customer) : null;
    const setupIntentId = session?.setup_intent ? String(session.setup_intent) : null;
    let paymentMethodId: string | null = null;
    if (setupIntentId) {
      const intent = await stripeCall(stripeKey, "GET", `setup_intents/${setupIntentId}`);
      if (intent?.payment_method) paymentMethodId = String(intent.payment_method);
    }
    return { customerId, paymentMethodId };
  } catch {
    return { customerId: null, paymentMethodId: null };
  }
}

export function paymentMethodLabel(pm: PortalPaymentMethod): string {
  if (!pm.onFile) return "Not on file";
  const brand = pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : pm.type === "us_bank_account" ? "Bank" : "Card";
  return pm.last4 ? `${brand} •••• ${pm.last4}` : brand;
}
