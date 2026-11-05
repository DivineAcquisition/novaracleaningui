// ─── Server: live data for the public landing page ─────────────────────────
//
// Everything a visitor reads as a number on the marketing pages comes from here:
// prices from the tables the public booking flow charges (src/lib/pricing.ts),
// and proof numbers counted from completed jobs and post-visit ratings.
//
// Proof numbers are only shown once they clear a threshold (see
// LANDING_PROOF_THRESHOLDS). Below it the page shows commitments instead of
// counts, so the page never advertises a number it cannot back up.
//
// Pure helpers and types, safe in client and server code. The database read
// lives in data.ts.

import { ADD_ONS, HOME_SIZE_RANGES, MEMBERSHIP_PRICES, SERVICE_DISCOUNT_RATES, SERVICE_TIER_PRICING } from "@/lib/pricing";

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
  /** "live" = the booking flow's price tables; "snapshot" = fallback below. */
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

/**
 * Prices as the public booking flow charges them (src/lib/pricing.ts):
 * standard price per home size × service multiplier, before the ZIP price
 * zone (−10% to +15%). Add-ons and memberships come from the same file.
 */
export function checkoutPrices(): LandingPrices {
  const bands: Json = {};
  const base: Json = {};
  for (const h of HOME_SIZE_RANGES) {
    if (!h.standardPrice) continue;
    const crew = Number(String(h.cleaners).split("-").pop()) || 1;
    bands[h.id] = { label: h.label, hours: h.baseHours, crew_size: crew };
    base[h.id] = {
      standard: Math.round(h.standardPrice * SERVICE_TIER_PRICING.standard.multiplier * 100),
      deep: Math.round(h.standardPrice * SERVICE_TIER_PRICING.deep.multiplier * 100),
      moveInOut: Math.round(h.standardPrice * SERVICE_TIER_PRICING.moveInOut.multiplier * 100),
    };
  }
  const addOns: Record<string, number> = {};
  for (const [id, a] of Object.entries(ADD_ONS)) addOns[id] = a.price * 100;
  const moveFree = Object.entries(ADD_ONS)
    .filter(([, a]) => /move-in\/out/i.test(a.note))
    .map(([id]) => id);
  return buildPrices("live", null, bands, base, {}, ADD_ONS.firstCleanDeep.price * 100, addOns, moveFree);
}

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

/** Online discount on the service price (src/lib/pricing.ts). Extras are not discounted. */
export function onlineDiscountPct(service: LandingServiceType): number {
  return Math.round((SERVICE_DISCOUNT_RATES[service] ?? 0) * 100);
}

/** What the website charges for the clean itself, after the online discount. */
export function onlinePrice(cents: number, service: LandingServiceType): number {
  return Math.round(cents * (1 - onlineDiscountPct(service) / 100));
}

export function startingOnlinePrice(prices: LandingPrices, service: LandingServiceType): number {
  return onlinePrice(startingPrice(prices, service), service);
}
