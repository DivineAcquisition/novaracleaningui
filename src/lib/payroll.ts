// ─── Manual Payroll — pay calculation engine (single source of truth) ──────
//
// Mirrors supabase/functions/_shared/payout-utils.ts so the live preview in
// the admin UI and the authoritative server-side computation agree to the
// cent. NEVER recompute pay ad hoc — call computeJobPay() everywhere.
//
//   Foundation = 35%   Proven = 40%   Elite = 45%
//   pool          = customer_paid × tier_pct        (highest tier if mixed)
//   pay_per_cleaner = floor(pool / cleaner_count)    (split evenly)
//
// The tier % is LOCKED onto the job at save time; promotions never
// recalculate historical jobs.

export type PayTier = "foundation" | "proven" | "elite";

export const TIER_REVENUE_SHARE: Record<PayTier, number> = {
  foundation: 35,
  proven: 40,
  elite: 45,
};

export const TIER_LABEL: Record<PayTier, string> = {
  foundation: "Foundation",
  proven: "Proven",
  elite: "Elite",
};

export const PAYROLL_SERVICE_TYPES = [
  "Standard",
  "Deep",
  "Move-In-Out",
  "Recurring",
  "Other",
] as const;

export function normalizePayTier(value: unknown): PayTier {
  const v = String(value || "").toLowerCase().trim();
  if (v === "elite") return "elite";
  if (v === "proven") return "proven";
  return "foundation";
}

/** Map a stored pay_percentage (35/40/45) back to its tier. */
export function tierFromPct(pct: number | null | undefined): PayTier {
  const n = Math.round(Number(pct) || 0);
  if (n >= 45) return "elite";
  if (n >= 40) return "proven";
  return "foundation";
}

export function payPctForTier(tier: PayTier | string): number {
  return TIER_REVENUE_SHARE[normalizePayTier(tier)];
}

/** Highest tier % among the cleaners on a job (mixed-tier rule). */
export function highestPct(pcts: Array<number | null | undefined>): number {
  let best = TIER_REVENUE_SHARE.foundation;
  for (const p of pcts) {
    const n = Math.round(Number(p) || 0);
    if (n > best) best = n;
  }
  return best;
}

export interface JobPayResult {
  tierPct: number;
  poolCents: number;
  perCleanerCents: number;
  cleanerCount: number;
}

/**
 * The one calculation. Given the customer-paid amount (in cents) and the
 * pay percentages of every cleaner on the job, returns the locked tier %,
 * the pool, and each cleaner's (equal) share.
 */
export function computeJobPay(
  customerPaidCents: number,
  cleanerPcts: Array<number | null | undefined>,
): JobPayResult {
  const cleanerCount = Math.max(1, cleanerPcts.length);
  const amount = Math.max(0, Math.round(Number(customerPaidCents) || 0));
  const tierPct = highestPct(cleanerPcts.length ? cleanerPcts : [TIER_REVENUE_SHARE.foundation]);
  const poolCents = Math.floor((amount * tierPct) / 100);
  const perCleanerCents = Math.floor(poolCents / cleanerCount);
  return { tierPct, poolCents, perCleanerCents, cleanerCount };
}

// ─── Pay-period helpers (Mon–Sun, local) ──────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday (YYYY-MM-DD) of the week a date falls in. */
export function payPeriodMonday(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T12:00:00`) : new Date(date);
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + diff);
  return ymd(copy);
}

/** Sunday (YYYY-MM-DD) for a given Monday pay-period start. */
export function payPeriodSunday(mondayYmd: string): string {
  const d = new Date(`${mondayYmd}T12:00:00`);
  d.setDate(d.getDate() + 6);
  return ymd(d);
}

export function thisWeekMonday(): string {
  return payPeriodMonday(new Date());
}

export const usd = (cents: number | null | undefined): string =>
  ((cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Format a YYYY-MM-DD pay period as "Jun 16 – Jun 22". */
export function formatPeriod(mondayYmd: string): string {
  try {
    const start = new Date(`${mondayYmd}T12:00:00`);
    const end = new Date(`${payPeriodSunday(mondayYmd)}T12:00:00`);
    const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${f(start)} – ${f(end)}`;
  } catch {
    return mondayYmd;
  }
}
