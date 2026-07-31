// ─── Cleaner pay model: revenue share (35 / 40 / 45%) ──────────────────
//
// Replaces the legacy hourly-rate model ($18/$20/$22) with a flat
// percentage of customer-paid job revenue, tiered by cleaner tenure +
// performance:
//
//   Foundation : 35% of job revenue
//   Proven     : 40% of job revenue
//   Elite      : 45% of job revenue
//
// Multi-cleaner jobs: tier % applies to the job total. Cleaners split
// the pool evenly. Mixed tiers use the HIGHEST tier on the job
// (rewards lower-tier cleaners working alongside Elites).
//
// Single source of truth — every Edge Function pulls from here so
// dispatch-job, complete-booking, process-payout, send-zapier-webhook,
// and the admin tooling never drift.

// Pay tier → cleaner share of job revenue (as percent integer).
// Stored in DB as cleaners.pay_percentage. Snapshot per assignment in
// job_assignments.pay_percentage_snapshot.
export type PayTier = "foundation" | "proven" | "elite";
export const TIER_REVENUE_SHARE: Record<PayTier, number> = {
  foundation: 35,
  proven: 40,
  elite: 45,
};

export const DEFAULT_PAY_TIER: PayTier = "foundation";
export const DEFAULT_PAY_PERCENTAGE: number =
  TIER_REVENUE_SHARE[DEFAULT_PAY_TIER];

/**
 * Resolve a pay_tier string (any case, any unknown value) to one of
 * the three canonical tiers. Falls back to 'foundation'.
 */
export function normalizePayTier(value: unknown): PayTier {
  const v = String(value || "").toLowerCase().trim();
  if (v === "elite") return "elite";
  if (v === "proven") return "proven";
  return "foundation";
}

/**
 * Resolve a numeric pay_percentage (any of 40 / 45 / 50) to its tier.
 * Anything else falls back to foundation/40.
 */
export function tierFromPayPercentage(pct: number | null | undefined): PayTier {
  const n = Math.round(Number(pct) || 0);
  if (n >= 45) return "elite";
  if (n >= 40) return "proven";
  return "foundation";
}

/**
 * Get the pay percentage (40/45/50) for a tier. Use this when you
 * have the tier and need the percentage.
 */
export function payPercentageForTier(tier: PayTier | string): number {
  return TIER_REVENUE_SHARE[normalizePayTier(tier)];
}

/**
 * Compute the cleaner pool (in cents) for a single job: the total
 * money split among all cleaners on that job, BEFORE per-cleaner
 * division.
 *
 *   pool = revenueCents × payPercentage / 100
 */
export function calculateCleanerPoolCents(
  revenueCents: number,
  payPercentage: number,
): number {
  if (!Number.isFinite(revenueCents) || revenueCents <= 0) return 0;
  const pct = Math.max(0, Math.min(100, Math.round(payPercentage || 0)));
  return Math.floor((revenueCents * pct) / 100);
}

/**
 * Compute one cleaner's payout (in cents) for a job:
 *
 *   pool / cleanerCount
 *
 * Floors to whole cents to avoid over-paying when the pool doesn't
 * divide evenly. Use this in `process-payout` and the cleaner-facing
 * pay display.
 */
export function calculateCleanerPayoutCents(
  revenueCents: number,
  payPercentage: number,
  cleanerCount: number = 1,
): number {
  const pool = calculateCleanerPoolCents(revenueCents, payPercentage);
  const n = Math.max(1, Math.floor(cleanerCount || 1));
  return Math.floor(pool / n);
}

/**
 * For mixed-tier jobs, pick the highest tier's percentage (so a
 * Foundation cleaner working alongside an Elite cleaner gets the 50%
 * pool share).
 */
export function maxPayPercentage(percentages: Array<number | null | undefined>): number {
  let best = DEFAULT_PAY_PERCENTAGE;
  for (const p of percentages) {
    const n = Math.round(Number(p) || 0);
    if (n > best) best = n;
  }
  return best;
}

// ─── Estimated hours / team size (used for scheduling, NOT pay) ────
//
// Hours estimates are still useful for calendar blocking and the
// customer-facing duration estimate. They are NO LONGER used to compute
// cleaner pay — pay is a flat % of revenue regardless of hours worked.

export const HOME_SIZE_HOURS: Record<string, number> = {
  "0_999": 2,
  "1000_1500": 2.5,
  "1501_2000": 3,
  "2001_2500": 3.5,
  "2501_3000": 4,
  "3001_3500": 4.5,
  "3501_4000": 5,
  "4001_4500": 5.5,
  "4501_5000": 6,
  "5000_plus": 8,
};

const LARGE_HOME_SIZES = [
  "2501_3000", "3001_3500", "3501_4000",
  "4001_4500", "4501_5000", "5000_plus",
];

export function getTeamSize(homeSizeId: string): number {
  return LARGE_HOME_SIZES.includes(homeSizeId) ? 3 : 2;
}

export const HOME_SIZE_SQFT_RANGES: Record<string, string> = {
  "0_999": "0-999",
  "1000_1500": "1000-1500",
  "1501_2000": "1501-2000",
  "2001_2500": "2001-2500",
  "2501_3000": "2501-3000",
  "3001_3500": "3001-3500",
  "3501_4000": "3501-4000",
  "4001_4500": "4001-4500",
  "4501_5000": "4501-5000",
  "5000_plus": "5001+",
};

export function getEstimatedHours(homeSizeId: string): number {
  return HOME_SIZE_HOURS[homeSizeId] || 4;
}

// ─── Service-type duration multipliers ─────────────────────────────
//
// Deep / Move-In-Out / Combo cleans take materially longer than a
// Standard clean for the same square footage. These mirror the pricing
// tier multipliers (deep 1.5×, moveInOut 2.0×, combo 2.5×) because the
// price tiers track labor effort. Used for JOB scheduling / conflict
// windows so a cleaner who accepts a deep clean isn't double-booked on
// a window sized for a standard clean.
const SERVICE_DURATION_MULTIPLIERS: Record<string, number> = {
  focused: 0.4,
  standard: 1.0,
  deep: 1.5,
  moveinout: 2.0,
  combo: 2.5,
};

/** Normalize the many service_type spellings to a multiplier key. */
function normalizeServiceKey(serviceType: string | null | undefined): string {
  const s = String(serviceType || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (s.includes("focused") || s.includes("singlearea")) return "focused";
  if (s.includes("move")) return "moveinout";
  if (s.includes("combo")) return "combo";
  if (s.includes("deep")) return "deep";
  return "standard";
}

/**
 * Estimated job hours for SCHEDULING — home-size base hours scaled by
 * the service-type effort multiplier. Single source of truth so
 * auto-dispatch, conflict detection, and calendar blocking all agree.
 */
export function getServiceDurationHours(
  homeSizeId: string,
  serviceType: string | null | undefined,
): number {
  const base = getEstimatedHours(homeSizeId);
  const mult = SERVICE_DURATION_MULTIPLIERS[normalizeServiceKey(serviceType)] ?? 1.0;
  return Math.round(base * mult * 100) / 100;
}

export function getSqftRange(homeSizeId: string): string {
  return HOME_SIZE_SQFT_RANGES[homeSizeId] || "1000-1500";
}

// ─── Deprecated hourly helpers (kept for compile-back-compat) ──────
//
// These exist only so legacy callers don't immediately break during
// the migration. New code MUST use calculateCleanerPayoutCents above.

/** @deprecated use calculateCleanerPayoutCents (revenue share). */
export const DEFAULT_CLEANER_HOURLY_RATE_CENTS = 1800;

/** @deprecated use calculateCleanerPayoutCents (revenue share). */
export function calculateCleanerPayout(
  estimatedHours: number,
  hourlyRateCents: number = DEFAULT_CLEANER_HOURLY_RATE_CENTS,
): number {
  return Math.floor(estimatedHours * hourlyRateCents);
}

/** @deprecated use calculateCleanerPayoutCents (revenue share). */
export function calculateCleanerPayoutFromHomeSize(
  homeSizeId: string,
  hourlyRateCents: number = DEFAULT_CLEANER_HOURLY_RATE_CENTS,
): number {
  return calculateCleanerPayout(getEstimatedHours(homeSizeId), hourlyRateCents);
}
