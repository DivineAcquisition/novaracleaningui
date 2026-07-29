// ─── Crew-size pay: the Deno-side entry point ──────────────────────────────
//
// Pay depends on how many cleaners PERFORMED the job, not how many were booked:
//
//            solo (1)   crew (2+)
//   Foundation   35%        40%
//   Proven       40%        45%
//   Elite        45%        50%
//
// The rate is the share of final job value paid to the WHOLE crew, then divided
// among them. It is never a per-person entitlement.
//
// This module deliberately contains NO rate table and NO arithmetic. Rates live
// in public.cleaner_pay_rates and the calculation lives in
// public.compute_crew_pay(). There used to be three duplicated TS/Deno copies of
// the tier percentages plus inline hardcodes; keeping the numbers in one place
// is the only way "change a rate in configuration and it applies everywhere"
// can actually be true. It also means adding a 3+ bracket needs no code change.

import {
  normalizePayTier,
  type PayTier,
} from "./payout-utils.ts";

export interface CrewPayShare {
  cleanerId: string;
  payTier: PayTier;
  crewSize: number;
  /** The rate applied for this cleaner at this crew size, e.g. 45. */
  ratePercent: number;
  /** This cleaner's pay in whole cents. */
  shareCents: number;
}

/**
 * Compute pay for the crew that performed a job.
 *
 * `cleanerIds` must be the cleaners CREDITED WITH COMPLETING the job — not the
 * booked crew. If a job was booked for two and one no-showed, pass the one who
 * did the work and they are paid the solo rate, because they did solo work.
 *
 * Returns [] for an empty crew rather than throwing: callers reach this on paths
 * where a job legitimately has nobody assigned yet.
 */
export async function computeCrewPay(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobValueCents: number,
  cleanerIds: Array<string | null | undefined>,
): Promise<CrewPayShare[]> {
  const ids = [...new Set(cleanerIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase.rpc("compute_crew_pay", {
    p_job_value_cents: Math.max(0, Math.round(jobValueCents || 0)),
    p_cleaner_ids: ids,
  });
  if (error) throw new Error(`compute_crew_pay failed: ${error.message}`);

  return ((data || []) as Record<string, unknown>[]).map((r) => ({
    cleanerId: String(r.cleaner_id),
    payTier: normalizePayTier(r.pay_tier),
    crewSize: Number(r.crew_size) || ids.length,
    ratePercent: Number(r.rate_percent) || 0,
    shareCents: Number(r.share_cents) || 0,
  }));
}

/** Look up a single cleaner's share without assembling the whole crew yourself. */
export function shareFor(
  shares: CrewPayShare[],
  cleanerId: string | null | undefined,
): CrewPayShare | null {
  if (!cleanerId) return null;
  return shares.find((s) => s.cleanerId === cleanerId) || null;
}

const TIER_LABEL: Record<PayTier, string> = {
  foundation: "Foundation",
  proven: "Proven",
  elite: "Elite",
};

/**
 * The line a cleaner reads on their job.
 *
 * Spells out the crew size AND that the percentage is a pool, because "45%" next
 * to a number that is clearly not 45% of the job is the fastest way to make
 * somebody believe they have been underpaid.
 *
 *   "Crew of 2 · Proven rate 45% (crew pool) · your share $46.12"
 *   "Solo · Proven rate 40% · your share $82.00"
 */
export function payExplanation(share: CrewPayShare): string {
  const money = `$${(share.shareCents / 100).toFixed(2)}`;
  const rate = `${trimRate(share.ratePercent)}%`;
  const tier = TIER_LABEL[share.payTier];
  if (share.crewSize <= 1) {
    return `Solo · ${tier} rate ${rate} · your share ${money}`;
  }
  return `Crew of ${share.crewSize} · ${tier} rate ${rate} (crew pool) · your share ${money}`;
}

/** 45.00 -> "45", 42.50 -> "42.5" — rates are configurable, so don't assume integers. */
export function trimRate(rate: number): string {
  const n = Number(rate) || 0;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * The standing explanation of what moves a cleaner's pay. Covers crew size
 * alongside job value, because both now do.
 */
export const PAY_BASIS_NOTE =
  "Your pay is based on the final value of the job and the size of the crew " +
  "assigned. If the job's value changes or the crew changes, your pay is " +
  "recalculated to match.";
