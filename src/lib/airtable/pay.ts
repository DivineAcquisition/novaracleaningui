// ─── Locked job-pay computation ───────────────────────────────────────────────
//
// The revenue-share model: a cleaner earns a percentage of what the customer
// paid, tiered by tenure/performance. The tier % is LOCKED onto the job at
// completion time — later promotions never recompute historical jobs.
//
//   Foundation = 35%   Proven = 40%   Elite = 45%
//   pool          = customer_paid × tier_pct
//   pay_per_cleaner = pool ÷ number_of_cleaners   (split evenly)
//
// Worked example (from the spec's verification checklist):
//   Foundation, $239 paid  → pool = 239 × 0.35 = $83.65
//   two cleaners           → $83.65 / 2 = $41.825 → $41.83 each
//
// All money is handled in integer cents to avoid float drift; the per-cleaner
// split rounds to the nearest cent (banker-free Math.round) so the documented
// $41.83 figure reproduces exactly. When the authoritative payout has already
// been computed upstream (the Supabase payout engine), pass those cents into
// syncJob and they win over this estimate.

export type PayTier = "foundation" | "proven" | "elite";

export const TIER_PCT: Record<PayTier, number> = {
  foundation: 35,
  proven: 40,
  elite: 45,
};

export const TIER_LABEL: Record<PayTier, string> = {
  foundation: "Foundation",
  proven: "Proven",
  elite: "Elite",
};

/** Resolve any tier spelling/casing to a canonical tier. */
export function normalizeTier(value: unknown): PayTier {
  const v = String(value ?? "").toLowerCase().trim();
  if (v === "elite") return "elite";
  if (v === "proven") return "proven";
  return "foundation";
}

/** Map a stored pay percentage (35/40/45) back to its tier. */
export function tierFromPct(pct: number | null | undefined): PayTier {
  const n = Math.round(Number(pct) || 0);
  if (n >= 45) return "elite";
  if (n >= 40) return "proven";
  return "foundation";
}

/** Highest tier % among the cleaners on a job (mixed-tier rule). */
export function highestPct(pcts: Array<number | null | undefined>): number {
  let best = TIER_PCT.foundation;
  for (const p of pcts) {
    const n = Math.round(Number(p) || 0);
    if (n > best) best = n;
  }
  return best;
}

export interface JobPay {
  /** Locked tier percentage (35 / 40 / 45). */
  tierPct: number;
  /** Total pool in cents. */
  poolCents: number;
  /** Each cleaner's equal share in cents. */
  perCleanerCents: number;
  /** Same values as dollars, for writing to Airtable currency fields. */
  poolDollars: number;
  perCleanerDollars: number;
  cleanerCount: number;
}

const toDollars = (cents: number): number => Math.round(cents) / 100;

/** Convert integer cents to a dollar amount for Airtable currency fields. */
export const centsToDollars = (cents: number | null | undefined): number | undefined =>
  cents == null ? undefined : Math.round(Number(cents)) / 100;

/**
 * Compute the locked pay for a job.
 *
 * @param customerPaidCents what the customer paid, in cents
 * @param tierPct           the locked tier % (35/40/45)
 * @param cleanerCount      number of cleaners splitting the pool (≥1)
 */
export function computeJobPay(
  customerPaidCents: number,
  tierPct: number,
  cleanerCount: number,
): JobPay {
  const amount = Math.max(0, Math.round(Number(customerPaidCents) || 0));
  const pct = Math.max(0, Math.min(100, Math.round(Number(tierPct) || 0)));
  const count = Math.max(1, Math.floor(Number(cleanerCount) || 1));
  const poolCents = Math.round((amount * pct) / 100);
  const perCleanerCents = Math.round(poolCents / count);
  return {
    tierPct: pct,
    poolCents,
    perCleanerCents,
    poolDollars: toDollars(poolCents),
    perCleanerDollars: toDollars(perCleanerCents),
    cleanerCount: count,
  };
}

// ─── Pay-period helpers (Mon–Sun) ─────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Monday (YYYY-MM-DD) of the week a date falls in. */
export function payPeriodMonday(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T12:00:00`) : new Date(date);
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  return ymd(copy);
}

/** Sunday (YYYY-MM-DD) ending the week for a Monday pay-period start. */
export function payPeriodSunday(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00`);
  d.setDate(d.getDate() + 6);
  return ymd(d);
}
