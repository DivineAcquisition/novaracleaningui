/**
 * payment_settings for invoices we send from the app.
 *
 * DO NOT add `payment_method_options.card.setup_future_usage` here. It looks
 * like it belongs (it is valid on Checkout Sessions and PaymentIntents) but
 * Stripe rejects it on Invoices outright:
 *
 *   invalid_request_error / parameter_unknown
 *   payment_settings[payment_method_options][card][setup_future_usage]
 *
 * That rejection took down every invoice-based booking for weeks: the invoice
 * ITEM was created, then invoices.create threw, and the whole internal booking
 * request 500'd after the booking row had already been written — so operators
 * saw "booking failed", resubmitted, and produced duplicate jobs.
 *
 * Saving a card off a hosted invoice is an ACCOUNT-level setting, not a
 * per-invoice parameter: Dashboard → Settings → Invoices → "Save customer
 * payment information" (API: settings.invoices.hosted_payment_method_save,
 * one of never | offer | always). This account is currently on "offer", so the
 * customer gets a consent checkbox on the hosted invoice page and the saved
 * card is then available for the off-session balance charge.
 */
export const invoicePaymentSettingsSaveCard = {
  payment_method_types: ["card"] as const,
};
