/**
 * Invoice payment_settings so paying a hosted invoice saves the card on the
 * Stripe Customer for off-session balance charges (complete-booking, etc.).
 */
export const invoicePaymentSettingsSaveCard = {
  payment_method_types: ["card"] as const,
  payment_method_options: {
    card: {
      setup_future_usage: "off_session" as const,
    },
  },
};
