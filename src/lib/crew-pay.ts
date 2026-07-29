// ─── Crew-size pay: the app-side entry point ────────────────────────────────
//
// Mirror of supabase/functions/_shared/crew-pay.ts for Next.js callers.
//
// Like that module, this holds NO rate table and NO arithmetic. Rates live in
// public.cleaner_pay_rates and the calculation lives in
// public.compute_crew_pay(). The tier percentages used to be duplicated across
// three TS files plus inline hardcodes, which is why a rate change never
// actually propagated everywhere. One source of truth is what makes the
// configurability real — and what lets a new crew-size bracket ship without code.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PayTier = "foundation" | "proven" | "elite";

export interface CrewPayShare {
  cleanerId: string;
  payTier: PayTier;
  crewSize: number;
  /** Rate applied for this cleaner at this crew size, e.g. 45. */
  ratePercent: number;
  /** This cleaner's pay in whole cents. */
  shareCents: number;
}

export function normalizePayTier(value: unknown): PayTier {
  const v = String(value || "").toLowerCase().trim();
  if (v === "elite") return "elite";
  if (v === "proven") return "proven";
  return "foundation";
}

/**
 * Compute pay for the crew that performed a job.
 *
 * `cleanerIds` must be the cleaners credited with COMPLETING the job, not the
 * booked crew — a no-show means the remaining cleaner did solo work and is paid
 * the solo rate.
 */
export async function computeCrewPay(
  supabase: SupabaseClient,
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

export function tierLabel(tier: PayTier | string): string {
  return TIER_LABEL[normalizePayTier(tier)];
}

/** 45.00 -> "45", 42.50 -> "42.5". Rates are configurable, so don't assume integers. */
export function trimRate(rate: number): string {
  const n = Number(rate) || 0;
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/**
 * The line a cleaner reads on their job. States the crew size AND that the
 * percentage is a pool — "45%" beside a number that plainly isn't 45% of the job
 * is the quickest way to convince somebody they've been underpaid.
 */
export function payExplanation(share: CrewPayShare): string {
  const money = `$${(share.shareCents / 100).toFixed(2)}`;
  const rate = `${trimRate(share.ratePercent)}%`;
  const tier = tierLabel(share.payTier);
  if (share.crewSize <= 1) {
    return `Solo · ${tier} rate ${rate} · your share ${money}`;
  }
  return `Crew of ${share.crewSize} · ${tier} rate ${rate} (crew pool) · your share ${money}`;
}

/** What moves a cleaner's pay — now crew size as well as job value. */
export const PAY_BASIS_NOTE =
  "Your pay is based on the final value of the job and the size of the crew " +
  "assigned. If the job's value changes or the crew changes, your pay is " +
  "recalculated to match.";
