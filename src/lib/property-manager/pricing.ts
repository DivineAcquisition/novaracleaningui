// ─── Property Manager standing rates ───────────────────────────────────────
//
// PURE module: no imports beyond the residential band table, no I/O. Every
// rule a reviewer needs to check about property-manager pricing lives here
// and is exercised offline by `npm run property-manager:verify`.
//
// Three things this file exists to hold:
//
//   1. A unit's rates are computed ONCE, at registration, from the RESIDENTIAL
//      engine — sqft band, bedroom count, zone multiplier. Never the
//      commercial facility_type × scope_level × size_tier formula. A 2BR
//      apartment is not a facility with a scope tier.
//
//   2. The portfolio volume discount is subtracted from what the property
//      manager pays and from nothing else. Cleaner pay is computed off the
//      full pre-discount value of every job, discounted or not — the standing
//      rule across this system. A discount is a margin decision; it is not a
//      pay cut for the person doing the work.
//
//   3. Anything genuinely unusual routes to a human instead of guessing. The
//      whole point of the registry is removing quoting friction at portfolio
//      scale, so "typical" has to auto-price — but a 9,000 sqft house or a
//      unit the manager flagged as non-standard is not typical.

import { HOME_SIZE_RANGES, type HomeSizeRange } from "@/lib/pricing";

// ─── Service types ─────────────────────────────────────────────────────────

/** What a property manager books. Turnovers, not guest changeovers. */
export type PmServiceType = "move_out" | "move_in" | "standard";

export const PM_SERVICE_TYPES: PmServiceType[] = ["move_out", "move_in", "standard"];

export const PM_SERVICE_LABELS: Record<PmServiceType, string> = {
  move_out: "Move-Out",
  move_in: "Move-In",
  standard: "Standard (vacant refresh)",
};

export const PM_SERVICE_SUMMARIES: Record<PmServiceType, string> = {
  move_out: "Full turnover clean after a tenant vacates.",
  move_in: "Move-in ready clean before a new tenant takes possession.",
  standard: "Refresh on a vacant unit between showings.",
};

/**
 * The residential engine's service type each turnover maps onto. Move-In and
 * Move-Out are both the residential Move-In/Move-Out service — the direction
 * of the lease does not change the work — so they price identically. They
 * stay separate on the unit because the property manager books, schedules,
 * and reconciles them separately.
 */
export function engineServiceType(service: PmServiceType): "moveInOut" | "standard" {
  return service === "standard" ? "standard" : "moveInOut";
}

/** Column suffix on property_manager_units for a service's stored rates. */
export function rateColumnSuffix(service: PmServiceType): string {
  return service;
}

// ─── Volume discount ───────────────────────────────────────────────────────

export interface VolumeDiscountTier {
  /** Registered unit count at which this tier starts. */
  min_units: number;
  /** Percent off the standard residential rate, 0–100. */
  percent: number;
  label?: string;
}

export interface VolumeDiscountConfig {
  enabled: boolean;
  tiers: VolumeDiscountTier[];
}

/** Shipped defaults. The live values are admin-editable in app_settings. */
export const DEFAULT_VOLUME_DISCOUNTS: VolumeDiscountConfig = {
  enabled: true,
  tiers: [
    { min_units: 1, percent: 0, label: "Standard" },
    { min_units: 5, percent: 5, label: "Portfolio 5+" },
    { min_units: 10, percent: 8, label: "Portfolio 10+" },
    { min_units: 20, percent: 12, label: "Portfolio 20+" },
    { min_units: 50, percent: 15, label: "Portfolio 50+" },
  ],
};

export interface ResolvedDiscount {
  percent: number;
  label: string | null;
  /** The unit count that produced this tier. */
  unitCount: number;
  /** Units still needed for the next tier, when there is one. */
  unitsToNextTier: number | null;
  nextPercent: number | null;
}

function sortedTiers(config: VolumeDiscountConfig): VolumeDiscountTier[] {
  return (config.tiers || [])
    .filter((t) => Number.isFinite(Number(t?.min_units)) && Number.isFinite(Number(t?.percent)))
    .map((t) => ({
      min_units: Math.max(0, Math.floor(Number(t.min_units))),
      percent: Math.min(99, Math.max(0, Number(t.percent))),
      label: t.label,
    }))
    .sort((a, b) => a.min_units - b.min_units);
}

/**
 * The tier a portfolio of `unitCount` registered units sits in — the highest
 * threshold it has reached. Disabling the discount config returns 0% without
 * removing the tier table, so an admin can switch it off and back on.
 */
export function resolveVolumeDiscount(
  config: VolumeDiscountConfig,
  unitCount: number,
): ResolvedDiscount {
  const count = Math.max(0, Math.floor(Number(unitCount) || 0));
  const tiers = sortedTiers(config);
  if (!config.enabled || tiers.length === 0) {
    return { percent: 0, label: null, unitCount: count, unitsToNextTier: null, nextPercent: null };
  }

  let current: VolumeDiscountTier | null = null;
  let next: VolumeDiscountTier | null = null;
  for (const tier of tiers) {
    if (count >= tier.min_units) current = tier;
    else if (!next) next = tier;
  }

  return {
    percent: current?.percent ?? 0,
    label: current?.label ?? null,
    unitCount: count,
    unitsToNextTier: next ? next.min_units - count : null,
    nextPercent: next ? next.percent : null,
  };
}

/**
 * What the property manager pays. Rounded to the nearest cent, and never
 * below zero. The gap between this and the list price is company margin —
 * it is not taken out of anyone's pay.
 */
export function applyVolumeDiscount(listCents: number, percent: number): number {
  const list = Math.max(0, Math.round(Number(listCents) || 0));
  const pct = Math.min(99, Math.max(0, Number(percent) || 0));
  if (pct === 0) return list;
  return Math.max(0, Math.round(list * (1 - pct / 100)));
}

// ─── Cleaner pay basis ─────────────────────────────────────────────────────

/**
 * The value cleaner pay is computed off, in cents.
 *
 * Two rules meet here and neither bends:
 *   • The portfolio discount is margin-funded, so pay starts from the full
 *     pre-discount value of the job, not from what was invoiced.
 *   • Pay follows an approved scope adjustment upward, because the crew did
 *     the heavier work.
 *
 * So: full list value, plus any approved scope delta. A negative delta (a
 * goodwill reduction to the customer) never pulls pay down.
 */
export function payBasisCents(input: {
  listPriceCents: number;
  scopeAdjustmentCents?: number;
}): number {
  const list = Math.max(0, Math.round(Number(input.listPriceCents) || 0));
  const delta = Math.max(0, Math.round(Number(input.scopeAdjustmentCents) || 0));
  return list + delta;
}

// ─── Size bands ────────────────────────────────────────────────────────────

/** The residential sqft band a unit falls in, or null when it is off the table. */
export function bandForSqft(sqft: number | null | undefined): HomeSizeRange | null {
  const n = Number(sqft);
  if (!Number.isFinite(n) || n <= 0) return null;
  const band = HOME_SIZE_RANGES.find((b) => n >= b.minSqft && n <= b.maxSqft) || null;
  // The 5,000+ band carries no published price — it is the "custom quote"
  // bucket, which for this type means a human, not a guess.
  if (!band || band.standardPrice <= 0) return null;
  return band;
}

// ─── What is unusual enough to need a human ────────────────────────────────

export interface AutoPriceBounds {
  reviewMinSqft: number;
  reviewMaxSqft: number;
  reviewMaxBedrooms: number;
}

export const DEFAULT_AUTO_PRICE_BOUNDS: AutoPriceBounds = {
  reviewMinSqft: 250,
  reviewMaxSqft: 5000,
  reviewMaxBedrooms: 5,
};

export type UnitReviewReason =
  | "outside_size_bands"
  | "missing_size"
  | "too_many_bedrooms"
  | "flagged_non_standard"
  | "zone_not_served"
  | "pricing_unavailable";

export interface ReviewDecision {
  needsReview: boolean;
  reason: UnitReviewReason | null;
  message: string | null;
}

const REVIEW_MESSAGES: Record<UnitReviewReason, string> = {
  outside_size_bands:
    "This unit is outside our normal residential size range, so a person prices it rather than the table.",
  missing_size:
    "We need the square footage to set this unit's standing rates.",
  too_many_bedrooms:
    "This unit has more bedrooms than our standard residential bands cover — our team will price it.",
  flagged_non_standard:
    "You flagged this unit as non-standard, so it's with our team rather than auto-priced.",
  zone_not_served:
    "This address is outside our current service area. Our team will follow up.",
  pricing_unavailable:
    "We couldn't reach the pricing tables for this unit. Our team will set its rates.",
};

/**
 * Everything typical auto-prices. Only genuinely unusual units route.
 *
 * "Unusual" is deliberately narrow: materially outside the residential size
 * bands, missing the size we need, more bedrooms than the bands describe, in
 * an area we don't serve, or explicitly flagged by the property manager. A
 * two-bedroom apartment in a served zip never lands here.
 */
export function reviewDecisionForUnit(input: {
  sqft: number | null | undefined;
  bedrooms?: number | null;
  flaggedNonStandard?: boolean;
  zoneServed?: boolean;
  bounds?: AutoPriceBounds;
}): ReviewDecision {
  const bounds = input.bounds || DEFAULT_AUTO_PRICE_BOUNDS;
  const decide = (reason: UnitReviewReason): ReviewDecision => ({
    needsReview: true,
    reason,
    message: REVIEW_MESSAGES[reason],
  });

  if (input.flaggedNonStandard) return decide("flagged_non_standard");
  if (input.zoneServed === false) return decide("zone_not_served");

  const sqft = Number(input.sqft);
  if (!Number.isFinite(sqft) || sqft <= 0) return decide("missing_size");
  if (sqft < bounds.reviewMinSqft || sqft >= bounds.reviewMaxSqft) {
    return decide("outside_size_bands");
  }

  const beds = Number(input.bedrooms);
  if (Number.isFinite(beds) && beds > bounds.reviewMaxBedrooms) {
    return decide("too_many_bedrooms");
  }

  if (!bandForSqft(sqft)) return decide("outside_size_bands");

  return { needsReview: false, reason: null, message: null };
}

export function reviewReasonMessage(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REVIEW_MESSAGES[reason as UnitReviewReason] || null;
}

// ─── Rate set shape ────────────────────────────────────────────────────────

export interface StandingRateSet {
  /** Full pre-discount residential value per service, in cents. */
  list: Record<PmServiceType, number>;
  /** What the property manager pays per service, in cents. */
  standing: Record<PmServiceType, number>;
  discountPercent: number;
  discountLabel: string | null;
  zoneCode: string | null;
  zoneMultiplier: number | null;
  homeSizeId: string | null;
  /** Engine breakdown per service, kept for audit and dispute. */
  basis: Record<string, unknown>;
}

/** Apply a portfolio discount across a full list-rate set. */
export function standingFromList(
  list: Record<PmServiceType, number>,
  percent: number,
): Record<PmServiceType, number> {
  return {
    move_out: applyVolumeDiscount(list.move_out, percent),
    move_in: applyVolumeDiscount(list.move_in, percent),
    standard: applyVolumeDiscount(list.standard, percent),
  };
}

export function formatRate(cents: number | null | undefined): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function unitDisplayName(unit: {
  unit_label?: string | null;
  address?: string | null;
}): string {
  return unit.unit_label || unit.address || "Unit";
}
