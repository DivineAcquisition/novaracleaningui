// ─── Server: live data for the public landing page ─────────────────────────
//
// Everything a visitor reads as a number on the landing page comes from here:
// starting prices and membership rates from the active dynamic-pricing config
// (the same table the booking engine prices from), and proof numbers counted
// from completed jobs and post-visit ratings.
//
// Proof numbers are only shown once they clear a threshold (see
// LANDING_PROOF_THRESHOLDS). Below it the page shows commitments instead of
// counts, so the page never advertises a number it cannot back up.
//
// SERVER ONLY. Uses the service-role client. Cached for an hour.

import { unstable_cache } from "next/cache";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { MEMBERSHIP_PRICES } from "@/lib/pricing";

export type LandingServiceType = "standard" | "deep" | "moveInOut";
export type LandingPlan = "monthly" | "biweekly" | "weekly";

export interface LandingBand {
  id: string;
  label: string;
  hours: number;
  crewSize: number;
}

export interface LandingAddOn {
  id: string;
  label: string;
  cents: number;
  includedWithMoveOut: boolean;
}

export interface LandingPrices {
  /** "live" = read from the active config row; "snapshot" = fallback below. */
  source: "live" | "snapshot";
  configVersion: number | null;
  bands: LandingBand[];
  base: Record<string, Record<LandingServiceType, number>>;
  membership: Record<string, Record<LandingPlan, number | null>>;
  firstMonthFeeCents: number;
  addOns: LandingAddOn[];
}

export interface LandingStats {
  completedCleans: number;
  ratingCount: number;
  ratingAverage: number | null;
}

export interface LandingData {
  prices: LandingPrices;
  stats: LandingStats | null;
}

/** A proof number appears on the page only at or above these values. */
export const LANDING_PROOF_THRESHOLDS = {
  completedCleans: 100,
  ratingCount: 25,
  ratingAverage: 4.5,
} as const;

/** Add-ons offered on the landing price explorer, in display order. */
const ADD_ON_LABELS: Array<[string, string]> = [
  ["oven", "Inside oven"],
  ["fridge", "Inside fridge"],
  ["cabinets", "Inside cabinets"],
  ["baseboards", "Baseboards by hand"],
  ["windows", "Interior windows"],
  ["petHair", "Pet hair"],
  ["laundry", "Laundry"],
  ["blinds", "Blinds"],
];

/** Bands the explorer offers. 5,000+ is quoted by a person, so it's left out. */
const EXCLUDED_BANDS = new Set(["5000_plus"]);

/**
 * Snapshot of pricing config v5 (active on 2026-11-05). Used only when the
 * live config cannot be read, so the page still renders real prices.
 */
const SNAPSHOT = {
  version: 5,
  bands: {
    "0_999": { label: "0 – 999 sq ft", hours: 2, crew_size: 1 },
    "1000_1500": { label: "1,000 – 1,500 sq ft", hours: 2.5, crew_size: 1 },
    "1501_2000": { label: "1,501 – 2,000 sq ft", hours: 3, crew_size: 1 },
    "2001_2500": { label: "2,001 – 2,500 sq ft", hours: 3.5, crew_size: 1 },
    "2501_3000": { label: "2,501 – 3,000 sq ft", hours: 4, crew_size: 2 },
    "3001_3500": { label: "3,001 – 3,500 sq ft", hours: 4.5, crew_size: 2 },
    "3501_4000": { label: "3,501 – 4,000 sq ft", hours: 5, crew_size: 2 },
    "4001_4500": { label: "4,001 – 4,500 sq ft", hours: 5.5, crew_size: 2 },
    "4501_5000": { label: "4,501 – 5,000 sq ft", hours: 6, crew_size: 2 },
  },
  base: {
    "0_999": { standard: 15000, deep: 22500, moveInOut: 30000 },
    "1000_1500": { standard: 18900, deep: 28400, moveInOut: 37800 },
    "1501_2000": { standard: 23900, deep: 35900, moveInOut: 47800 },
    "2001_2500": { standard: 27900, deep: 41900, moveInOut: 55800 },
    "2501_3000": { standard: 33900, deep: 50900, moveInOut: 67800 },
    "3001_3500": { standard: 37900, deep: 56900, moveInOut: 75800 },
    "3501_4000": { standard: 43900, deep: 65900, moveInOut: 87800 },
    "4001_4500": { standard: 48900, deep: 73400, moveInOut: 97800 },
    "4501_5000": { standard: 53900, deep: 80900, moveInOut: 107800 },
  },
  membership: {
    "0_999": { monthly: 12900, biweekly: 19900, weekly: 35900 },
    "1000_1500": { monthly: 15900, biweekly: 24900, weekly: 44900 },
    "1501_2000": { monthly: 19900, biweekly: 31900, weekly: 56900 },
    "2001_2500": { monthly: 23900, biweekly: 36900, weekly: 65900 },
    "2501_3000": { monthly: 27900, biweekly: 44900, weekly: 79900 },
    "3001_3500": { monthly: 31900, biweekly: 49900, weekly: null },
    "3501_4000": { monthly: 36900, biweekly: 57900, weekly: null },
    "4001_4500": { monthly: 40900, biweekly: 64900, weekly: null },
    "4501_5000": { monthly: 45900, biweekly: 71900, weekly: null },
  },
  firstMonthFeeCents: 7500,
  addOnsCents: {
    oven: 3000, fridge: 3000, cabinets: 3500, baseboards: 3500,
    windows: 4000, petHair: 3500, laundry: 3500, blinds: 3000,
  } as Record<string, number>,
  moveInOutFreeAddOns: [] as string[],
};

type Json = Record<string, unknown>;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function orderBands(ids: string[]): string[] {
  return ids
    .filter((id) => !EXCLUDED_BANDS.has(id))
    .sort((a, b) => num(a.split("_")[0]) - num(b.split("_")[0]));
}

function buildPrices(
  source: "live" | "snapshot",
  version: number | null,
  bandsRaw: Json,
  baseRaw: Json,
  membershipRaw: Json,
  firstMonthFeeCents: number,
  addOnsCents: Record<string, number>,
  moveFree: string[],
): LandingPrices {
  const ids = orderBands(Object.keys(bandsRaw)).filter((id) => {
    const row = baseRaw[id] as Json | undefined;
    return row && num(row.standard) > 0;
  });
  const bands: LandingBand[] = ids.map((id) => {
    const b = (bandsRaw[id] || {}) as Json;
    return {
      id,
      label: String(b.label || id),
      hours: num(b.hours),
      crewSize: num(b.crew_size) || 1,
    };
  });
  const base: LandingPrices["base"] = {};
  const membership: LandingPrices["membership"] = {};
  for (const id of ids) {
    const row = (baseRaw[id] || {}) as Json;
    const standard = num(row.standard);
    base[id] = {
      standard,
      deep: num(row.deep),
      moveInOut: row.moveInOut != null ? num(row.moveInOut) : standard * 2,
    };
    // Membership rates come from the table checkout charges
    // (src/lib/pricing.ts, mirrored in supabase/functions/_shared/pricing.ts),
    // not the dynamic config, so the page shows what the customer pays.
    const charged = MEMBERSHIP_PRICES[id];
    const m = (membershipRaw[id] || {}) as Json;
    membership[id] = charged
      ? { monthly: charged.monthly * 100, biweekly: charged.biweekly * 100, weekly: charged.weekly * 100 }
      : {
          monthly: m.monthly == null ? null : num(m.monthly),
          biweekly: m.biweekly == null ? null : num(m.biweekly),
          weekly: m.weekly == null ? null : num(m.weekly),
        };
  }
  const addOns: LandingAddOn[] = ADD_ON_LABELS.filter(([id]) => addOnsCents[id] != null).map(
    ([id, label]) => ({
      id,
      label,
      cents: num(addOnsCents[id]),
      includedWithMoveOut: moveFree.includes(id),
    }),
  );
  return { source, configVersion: version, bands, base, membership, firstMonthFeeCents, addOns };
}

function snapshotPrices(): LandingPrices {
  return buildPrices(
    "snapshot",
    SNAPSHOT.version,
    SNAPSHOT.bands,
    SNAPSHOT.base,
    SNAPSHOT.membership,
    SNAPSHOT.firstMonthFeeCents,
    SNAPSHOT.addOnsCents,
    SNAPSHOT.moveInOutFreeAddOns,
  );
}

async function loadPrices(): Promise<LandingPrices> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("dynamic_pricing_config_versions")
    .select("version, config")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.config) throw error || new Error("No active pricing config");
  const config = data.config as Json;
  const tables = (config.base_tables || {}) as Json;
  const authoritative = String(tables.authoritative || "training_guide");
  const baseRaw = (tables[authoritative] || tables.training_guide || {}) as Json;
  const membership = (config.membership || {}) as Json;
  return buildPrices(
    "live",
    num(data.version) || null,
    (config.bands || {}) as Json,
    baseRaw,
    (membership.prices_cents || {}) as Json,
    num(membership.first_month_deep_clean_fee_cents),
    (config.add_ons_cents || {}) as Record<string, number>,
    Array.isArray(config.move_in_out_free_add_ons)
      ? (config.move_in_out_free_add_ons as string[])
      : [],
  );
}

async function loadStats(): Promise<LandingStats> {
  const supabase = getAdminSupabase();
  const [jobs, feedback] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).ilike("status", "complete%"),
    supabase.from("job_feedback").select("overall_rating").not("overall_rating", "is", null),
  ]);
  const ratings = (feedback.data || [])
    .map((r) => num((r as Json).overall_rating))
    .filter((n) => n > 0);
  const ratingAverage = ratings.length
    ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    : null;
  return {
    completedCleans: jobs.count || 0,
    ratingCount: ratings.length,
    ratingAverage,
  };
}

async function loadLandingDataUncached(): Promise<LandingData> {
  const [prices, stats] = await Promise.all([
    loadPrices().catch((err) => {
      console.error("[landing] pricing config unavailable, using snapshot:", err);
      return snapshotPrices();
    }),
    loadStats().catch((err) => {
      console.error("[landing] stats unavailable:", err);
      return null;
    }),
  ]);
  return { prices, stats };
}

export const getLandingData = unstable_cache(loadLandingDataUncached, ["landing-data-v1"], {
  revalidate: 3600,
  tags: ["landing-data"],
});

/** Which proof numbers have earned a place on the page. */
export function visibleProof(stats: LandingStats | null) {
  const t = LANDING_PROOF_THRESHOLDS;
  return {
    completedCleans:
      stats && stats.completedCleans >= t.completedCleans ? stats.completedCleans : null,
    rating:
      stats &&
      stats.ratingAverage != null &&
      stats.ratingCount >= t.ratingCount &&
      stats.ratingAverage >= t.ratingAverage
        ? { average: stats.ratingAverage, count: stats.ratingCount }
        : null,
  };
}

export function startingPrice(prices: LandingPrices, service: LandingServiceType): number {
  const values = prices.bands
    .map((b) => prices.base[b.id]?.[service] || 0)
    .filter((v) => v > 0);
  return values.length ? Math.min(...values) : 0;
}
