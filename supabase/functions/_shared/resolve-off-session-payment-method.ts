import type Stripe from "https://esm.sh/stripe@18.5.0";

/** Card on customer, else from a recent succeeded PaymentIntent (invoice deposits). */
export async function resolveOffSessionPaymentMethod(
  stripe: Stripe,
  customerId: string,
): Promise<string | null> {
  const attached = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });
  if (attached.data[0]?.id) return attached.data[0].id;

  const intents = await stripe.paymentIntents.list({ customer: customerId, limit: 20 });
  const succeeded = intents.data
    .filter((pi) => pi.status === "succeeded" && (pi.payment_method || pi.latest_charge))
    .sort((a, b) => (b.created || 0) - (a.created || 0));

  for (const pi of succeeded) {
    let pmId = typeof pi.payment_method === "string"
      ? pi.payment_method
      : pi.payment_method?.id;
    if (!pmId && pi.latest_charge) {
      try {
        const chargeId = typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : pi.latest_charge.id;
        const charge = await stripe.charges.retrieve(chargeId);
        pmId = typeof charge.payment_method === "string"
          ? charge.payment_method
          : charge.payment_method?.id ?? null;
      } catch { /* next */ }
    }
    if (!pmId) continue;
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      if (pm.customer && pm.customer !== customerId) continue;
      if (!pm.customer) {
        try {
          await stripe.paymentMethods.attach(pmId, { customer: customerId });
        } catch { /* may already be attached */ }
      }
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: pmId },
      }).catch(() => { /* non-fatal */ });
      return pmId;
    } catch { /* next PI */ }
  }
  return null;
}
