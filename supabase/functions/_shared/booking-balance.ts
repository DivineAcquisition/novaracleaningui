// ─── Booking balance helpers ────────────────────────────────────────────────
//
// Used by confirmation SMS/email copy. The old logic treated anything that
// wasn't payment_option === "deposit" as "paid in full", which wrongly told
// preauth (deposit + card-on-file) customers they owed nothing.

export type BookingBalanceFields = {
  total_estimate_cents?: unknown;
  deposit_cents?: unknown;
  final_charge_cents?: unknown;
  applied_credit_cents?: unknown;
  payment_option?: unknown;
  payment_received_at?: unknown;
};

/**
 * Remaining customer balance after upfront collection.
 * Only returns 0 when we can tell they truly have nothing left to pay.
 */
export function remainingDueAfterUpfrontCents(b: BookingBalanceFields): number {
  const total = Math.max(0, Number(b.total_estimate_cents || 0));
  const credit = Math.max(0, Number(b.applied_credit_cents || 0));
  const net = Math.max(0, total - credit);
  if (net <= 0) return 0;

  const finalCharge = Math.max(0, Number(b.final_charge_cents || 0));
  if (finalCharge >= net) return 0;

  const option = String(b.payment_option || "").toLowerCase();
  const deposit = Math.max(0, Number(b.deposit_cents || 0));

  // Full pay at booking — only after payment actually cleared.
  if (option === "full") {
    if (!b.payment_received_at) return net;
    return 0;
  }

  // deposit / preauth / unknown: remaining = net − upfront deposit collected
  return Math.max(0, net - deposit);
}

/** True only when remainingDueAfterUpfrontCents is 0. */
export function isPaidInFull(b: BookingBalanceFields): boolean {
  return remainingDueAfterUpfrontCents(b) <= 0;
}

/**
 * Confirmation SMS tail. Never claims "Paid in full" unless remaining is 0.
 */
export function confirmationSmsBalanceTail(
  b: BookingBalanceFields,
  style: "hyphen" | "emdash" = "hyphen",
): string {
  const remaining = remainingDueAfterUpfrontCents(b);
  if (remaining > 0) {
    const due =
      style === "emdash"
        ? ` Remaining $${(remaining / 100).toFixed(2)} is due after service.`
        : ` Remaining $${(remaining / 100).toFixed(2)} due after service.`;
    return due;
  }
  return style === "emdash"
    ? " Paid in full — see you soon!"
    : " Paid in full - see you soon!";
}
