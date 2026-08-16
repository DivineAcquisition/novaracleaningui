// ─── Booking balance helpers ────────────────────────────────────────────────
//
// Two different "what's left" questions:
//
//   remainingDueAfterUpfrontCents — confirmation copy at booking time.
//   remainingDueAtCompletionCents — what to charge the card when the job is
//   marked complete. Scope adjustments write final_charge_cents and leave
//   total_estimate_cents alone, so extras surface here and are billed then
//   (not when the adjustment is recorded), unless the job is already complete.
//
// Keep in lock-step with supabase/functions/_shared/booking-balance.ts.

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
 * Remaining customer balance after upfront collection.
 * Only returns 0 when we can tell they truly have nothing left to pay.
 * Booking-time confirmation copy — do not use this to charge at completion.
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

  if (option === "full") {
    if (!b.payment_received_at) return net;
    return 0;
  }

  return Math.max(0, net - deposit);
}

/**
 * Amount to collect off-session when the job is marked complete.
 *
 * billed = final_charge_cents ?? total_estimate_cents
 * collected = original quote for full-pay / credit visits, otherwise deposit
 * remaining = max(0, billed − collected)
 */
export function remainingDueAtCompletionCents(b: BookingBalanceFields): number {
  return Math.max(0, billedTotalCents(b) - collectedTowardJobCents(b));
}

/**
 * If a scope adjustment lands after complete-booking already ran, charge this
 * now (the completion path will not run again). In-progress jobs return 0 —
 * extras wait for complete-booking.
 */
export function scopeAdjustmentChargeNowCents(
  booking: BookingBalanceFields,
  newFinalCents: number,
): number {
  if (String(booking.status || "") !== "completed") return 0;
  const newDue = remainingDueAtCompletionCents({
    ...booking,
    final_charge_cents: newFinalCents,
  });
  const priorDue = remainingDueAtCompletionCents(booking);
  const extra = Math.max(0, newDue - priorDue);
  const alreadySettled = Boolean(
    booking.balance_charged_at || booking.balance_payment_intent_id,
  );
  return alreadySettled ? extra : newDue;
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
