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
  uses_credit?: unknown;
  status?: unknown;
  balance_amount_cents?: unknown;
  balance_charged_at?: unknown;
  balance_payment_intent_id?: unknown;
  completion_hold_status?: unknown;
  completion_hold_amount_cents?: unknown;
  completion_hold_captured_amount?: unknown;
  completion_hold_captured_at?: unknown;
};

function cents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** What the customer owes for the work — adjusted total when one exists. */
export function billedTotalCents(b: BookingBalanceFields): number {
  if (b.final_charge_cents != null && Number.isFinite(Number(b.final_charge_cents))) {
    return cents(b.final_charge_cents);
  }
  return cents(b.total_estimate_cents);
}

/**
 * Money already applied to the original quote (deposit, full pay, or a
 * membership credit covering the visit). Scope extras live in final_charge
 * above this figure.
 *
 * Keep in lock-step with src/lib/booking-balance.ts.
 */
export function collectedTowardJobCents(b: BookingBalanceFields): number {
  const total = cents(b.total_estimate_cents);
  const deposit = cents(b.deposit_cents);
  const option = String(b.payment_option || "").toLowerCase();
  const usesCredit = b.uses_credit === true || option === "credit";

  if (usesCredit) return total;
  if (option === "full") return Math.max(deposit, total);
  return deposit;
}

/**
 * Completion-time captures already on the booking (hold + off-session
 * remaining), not including the original deposit or separately charged add-ons.
 *
 * Keep in lock-step with src/lib/booking-balance.ts.
 */
export function completionCapturedCents(b: BookingBalanceFields): number {
  const balance = cents(b.balance_amount_cents);
  const holdStatus = String(b.completion_hold_status || "");
  const holdCaptured = holdStatus === "captured" || b.completion_hold_captured_at
    ? cents(b.completion_hold_captured_amount) || (holdStatus === "captured" ? cents(b.completion_hold_amount_cents) : 0)
    : 0;
  return Math.max(balance, holdCaptured);
}

/**
 * Amount to collect off-session when the job is marked complete.
 *
 * billed − deposit/full-pay/credit − completion captures − immediately billed add-ons.
 */
export function remainingDueAtCompletionCents(
  b: BookingBalanceFields,
  paidAddonCents = 0,
): number {
  const billed = billedTotalCents(b);
  const base = collectedTowardJobCents(b);
  const already = completionCapturedCents(b);
  const option = String(b.payment_option || "").toLowerCase();
  const usesCredit = b.uses_credit === true || option === "credit";
  const addonDeduction = usesCredit || option === "full" ? 0 : cents(paidAddonCents);
  return Math.max(0, billed - base - already - addonDeduction);
}

/** What Stripe should already have captured for this job. */
export function capturedTowardJobCents(
  b: BookingBalanceFields,
  paidAddonCents = 0,
): number {
  return Math.max(0, billedTotalCents(b) - remainingDueAtCompletionCents(b, paidAddonCents));
}

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
