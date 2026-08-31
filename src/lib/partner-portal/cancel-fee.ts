// Host Partnership Agreement cancellation tiers (Section 9 of the portal spec):
//   48+ hours  → credit-eligible (no fee)
//   24–48 hours → 50% of the per-turnover rate
//   under 24 hours → 100% of the per-turnover rate
//
// Hours are measured from now until the scheduled service instant (checkout /
// requested date + window start, or noon on that date). The portal never asks
// admin to compute this per request.

export const CANCEL_FEE_TIERS = ["credit_eligible", "fifty_percent", "full"] as const;
export type CancelFeeTier = (typeof CANCEL_FEE_TIERS)[number];

export interface CancelFeeInput {
  requestedDate: string;
  windowStart?: string | null;
  priceCents: number;
  nowMs?: number;
}

export interface CancelFeeResult {
  tier: CancelFeeTier;
  hoursOut: number;
  feeCents: number;
  creditCents: number;
  feePercent: 0 | 50 | 100;
  label: string;
  summary: string;
}

const HOUR = 3600_000;

export function serviceInstantMs(requestedDate: string, windowStart?: string | null): number {
  const day = String(requestedDate || "").slice(0, 10);
  const time = String(windowStart || "").trim();
  const hhmm = /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 8) : "12:00:00";
  const iso = `${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : new Date(`${day}T12:00:00`).getTime();
}

export function computeCancelFee(input: CancelFeeInput): CancelFeeResult {
  const price = Math.max(0, Math.round(Number(input.priceCents) || 0));
  const now = input.nowMs ?? Date.now();
  const start = serviceInstantMs(input.requestedDate, input.windowStart);
  const hoursOut = Math.round(((start - now) / HOUR) * 10) / 10;

  let tier: CancelFeeTier;
  let feePercent: 0 | 50 | 100;
  if (hoursOut >= 48) {
    tier = "credit_eligible";
    feePercent = 0;
  } else if (hoursOut >= 24) {
    tier = "fifty_percent";
    feePercent = 50;
  } else {
    tier = "full";
    feePercent = 100;
  }

  const feeCents = Math.round((price * feePercent) / 100);
  const creditCents = Math.max(0, price - feeCents);
  const label =
    tier === "credit_eligible"
      ? "48+ hours — credit-eligible"
      : tier === "fifty_percent"
        ? "24–48 hours — 50% fee"
        : "Under 24 hours — 100% fee";
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const summary =
    tier === "credit_eligible"
      ? `More than 48 hours out. No cancellation fee. ${money(creditCents)} is credit-eligible.`
      : tier === "fifty_percent"
        ? `Between 24 and 48 hours out. Cancellation fee is 50% (${money(feeCents)}).`
        : `Under 24 hours out. Cancellation fee is 100% (${money(feeCents)}).`;

  return { tier, hoursOut, feeCents, creditCents, feePercent, label, summary };
}
