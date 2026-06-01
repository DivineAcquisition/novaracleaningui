// ─── admin-create-deposit-invoice ──────────────────────────────────────
//
// One-shot helper used by admin tooling + ad-hoc scripts: create a
// Stripe customer (if missing) and finalize a hosted send-invoice on
// the NovaraCleaning Stripe account, returning hosted_invoice_url +
// invoice_pdf so the caller can drop those into an outgoing email.
//
// Body shape:
//   {
//     email:        required, used to find / create the Stripe customer
//     name?:        optional display name applied if customer is new
//     phone?:       optional phone applied if customer is new
//     description?: shown at the top of the invoice
//     memo?:        footer on the invoice (e.g. pre-auth disclosure)
//     items: [{ description, amountCents }]   // ≥ 1 line item required
//   }
//
// Returns:
//   {
//     ok, customerId, invoiceId, number, amountDueCents,
//     hosted_invoice_url, invoice_pdf
//   }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { invoicePaymentSettingsSaveCard } from "../_shared/stripe-invoice-save-card.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function resolveStripeKey(): Promise<string> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data } = await admin
      .from("app_secrets")
      .select("value")
      .eq("key", "STRIPE_SECRET_KEY")
      .maybeSingle();
    if (data?.value && typeof data.value === "string") return data.value.trim();
  } catch {
    /* ignore */
  }
  return (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json();
    const stripeKey = await resolveStripeKey();
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }
    const stripe = new Stripe(stripeKey, {
      // deno-lint-ignore no-explicit-any
      apiVersion: "2025-08-27.basil" as any,
    });

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const description = String(
      body.description || "NovaraCleaning — first visit deposit",
    );
    const memo = String(body.memo || "");
    const items = (body.items || []) as Array<{
      description: string;
      amountCents: number;
    }>;
    if (!email || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "email + items[] required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Find or create customer
    let customerId: string;
    const found = await stripe.customers.list({ email, limit: 1 });
    if (found.data.length) {
      customerId = found.data[0].id;
      if (name && !found.data[0].name) {
        await stripe.customers.update(customerId, {
          name,
          phone: phone || undefined,
        });
      }
    } else {
      const created = await stripe.customers.create({
        email,
        name: name || undefined,
        phone: phone || undefined,
        metadata: { source: "admin-create-deposit-invoice" },
      });
      customerId = created.id;
    }

    // collection_method=send_invoice gives a hosted URL we can email.
    // 30-day due window in case the customer takes a beat to pay.
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: 30,
      description,
      footer: memo || undefined,
      auto_advance: false,
    });

    for (const it of items) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: it.amountCents,
        currency: "usd",
        description: it.description,
      });
    }

    // Finalize → generates hosted_invoice_url + PDF
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    return new Response(
      JSON.stringify({
        ok: true,
        customerId,
        invoiceId: finalized.id,
        number: finalized.number,
        amountDueCents: finalized.amount_due,
        hosted_invoice_url: finalized.hosted_invoice_url,
        invoice_pdf: finalized.invoice_pdf,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
