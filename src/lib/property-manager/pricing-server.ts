// ─── Property Manager standing rates, server side ──────────────────────────
//
// The Node-side glue between the pure rules in `pricing.ts` and the live
// residential pricing tables. `dynamic-pricing.ts` is the same engine the
// customer funnel and the VA booking screen quote from — this file loads its
// config, resolves the unit's zone from its zip, and runs it once per service
// type to produce the numbers that get frozen onto the unit.
//
// Two deliberate choices about how the engine is called:
//
//   • DEMAND IS OFF. Reactive pricing exists to move a live quote with
//     capacity and lead time. A standing rate is a published schedule a
//     property manager books against for months without asking; a number
//     that drifts with Tuesday's booking density is not that. Turnovers get
//     the zone-adjusted rate, full stop.
//
//   • CONDITION IS THE NORMAL-TURNOVER BASELINE. A standing rate assumes an
//     ordinary tenant turnover. When a unit is genuinely worse than that, the
//     crew flags it in the field and the existing scope-adjustment flow
//     handles it — with photos, a defined reason, admin approval, and
//     customer notification. The unit's stored rate is never quietly moved.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  computeQuote,
  type ConditionLevel,
  type DemandResolution,
  type DynamicPricingConfig,
  type FloorPayRates,
  type QuoteBreakdown,
  type ZoneInfo,
} from "@/lib/dynamic-pricing";
import {
  DEFAULT_AUTO_PRICE_BOUNDS,
  DEFAULT_VOLUME_DISCOUNTS,
  PM_SERVICE_TYPES,
  applyVolumeDiscount,
  bandForSqft,
  engineServiceType,
  resolveVolumeDiscount,
  reviewDecisionForUnit,
  type AutoPriceBounds,
  type PmServiceType,
  type ResolvedDiscount,
  type StandingRateSet,
  type UnitReviewReason,
  type VolumeDiscountConfig,
} from "./pricing";

type Admin = ReturnType<typeof getAdminSupabase>;

/** Standing rates are a published schedule — reactive pricing does not apply. */
const NO_DEMAND: DemandResolution = { mode: "off", multiplier: 1, reasons: [] };

export interface PmPricingContext {
  config: DynamicPricingConfig;
  configVersion: number;
  zones: ZoneInfo[];
  payRates: FloorPayRates;
  discounts: VolumeDiscountConfig;
  bounds: AutoPriceBounds;
  condition: ConditionLevel;
}

// ─── Settings ──────────────────────────────────────────────────────────────

export async function loadPmSettings(
  supabase: Admin,
): Promise<{ bounds: AutoPriceBounds; condition: ConditionLevel; raw: Record<string, unknown> }> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_settings")
    .maybeSingle();
  const raw = ((data?.value as Record<string, unknown>) || {}) as Record<string, unknown>;
  const num = (key: string, fallback: number) => {
    const n = Number(raw[key]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const condition = String(raw.standing_condition || "standard");
  return {
    bounds: {
      reviewMinSqft: num("review_min_sqft", DEFAULT_AUTO_PRICE_BOUNDS.reviewMinSqft),
      reviewMaxSqft: num("review_max_sqft", DEFAULT_AUTO_PRICE_BOUNDS.reviewMaxSqft),
      reviewMaxBedrooms: num("review_max_bedrooms", DEFAULT_AUTO_PRICE_BOUNDS.reviewMaxBedrooms),
    },
    condition: (["light", "standard", "heavy"].includes(condition)
      ? condition
      : "standard") as ConditionLevel,
    raw,
  };
}

export async function loadVolumeDiscounts(supabase: Admin): Promise<VolumeDiscountConfig> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_volume_discounts")
    .maybeSingle();
  const raw = (data?.value as Partial<VolumeDiscountConfig>) || null;
  if (!raw || !Array.isArray(raw.tiers) || raw.tiers.length === 0) {
    return DEFAULT_VOLUME_DISCOUNTS;
  }
  return { enabled: raw.enabled !== false, tiers: raw.tiers };
}

// ─── Residential engine context ────────────────────────────────────────────

/**
 * Load the active residential pricing config, the zone table, and the pay
 * percentages the price floor is derived from. Returns null when dynamic
 * pricing has never been configured — in that case a unit routes for review
 * rather than being priced off a stale fallback.
 */
export async function loadPmPricingContext(supabase: Admin): Promise<PmPricingContext | null> {
  const [{ data: cfgRow }, { data: zoneRows }, settings, discounts] = await Promise.all([
    supabase
      .from("dynamic_pricing_config_versions")
      .select("version, config")
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("pricing_zones")
      .select("id, code, name, description, multiplier, status, min_job_value_cents, travel_minutes, is_default"),
    loadPmSettings(supabase),
    loadVolumeDiscounts(supabase),
  ]);

  if (!cfgRow?.config) return null;
  const zones: ZoneInfo[] = ((zoneRows || []) as Array<Record<string, unknown>>).map((z) => ({
    id: String(z.id),
    code: String(z.code),
    name: String(z.name),
    description: (z.description as string) ?? null,
    multiplier: Number(z.multiplier),
    status: z.status as ZoneInfo["status"],
    min_job_value_cents: z.min_job_value_cents == null ? null : Number(z.min_job_value_cents),
    travel_minutes: z.travel_minutes == null ? null : Number(z.travel_minutes),
    is_default: Boolean(z.is_default),
  }));
  if (zones.length === 0) return null;

  // The floor uses the FOUNDATION pool percentages (the lowest) so the
  // per-cleaner hourly guarantee holds for every tier.
  const payRates: FloorPayRates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
  const { data: rateRows } = await supabase
    .from("cleaner_pay_rates")
    .select("min_crew_size, max_crew_size, rate_percent")
    .eq("pay_tier", "foundation");
  for (const r of (rateRows || []) as Array<Record<string, unknown>>) {
    const min = Number(r.min_crew_size);
    const max = r.max_crew_size == null ? Infinity : Number(r.max_crew_size);
    if (min <= 1 && 1 <= max) payRates.soloFoundationPercent = Number(r.rate_percent);
    if (min <= 2 && 2 <= max) payRates.crewFoundationPercent = Number(r.rate_percent);
  }

  return {
    config: cfgRow.config as DynamicPricingConfig,
    configVersion: Number(cfgRow.version),
    zones,
    payRates,
    discounts: discounts,
    bounds: settings.bounds,
    condition: settings.condition,
  };
}

// ─── Zone from address ─────────────────────────────────────────────────────

export interface PmZoneResolution {
  served: boolean;
  zone: ZoneInfo | null;
  defaulted: boolean;
  message?: string;
}

/** Pull a 5-digit ZIP out of a free-text US address. */
export function zipFromAddress(address: string | null | undefined): string | null {
  const match = String(address || "").match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/);
  return match ? match[1] : null;
}

/**
 * Zip → zone, the same mapping the residential funnel uses. A served zip that
 * has not been explicitly mapped falls to the default zone so a new zip never
 * blocks a registration; an address outside every served area is not priced.
 */
export async function resolveUnitZone(
  supabase: Admin,
  zip: string | null | undefined,
  zones: ZoneInfo[],
): Promise<PmZoneResolution> {
  const clean = String(zip || "").trim().slice(0, 5);
  const defaultZone = zones.find((z) => z.is_default) || null;
  if (!/^\d{5}$/.test(clean)) {
    return { served: false, zone: null, defaulted: false, message: "A 5-digit ZIP is needed to set this unit's rates." };
  }

  const { data: mapped } = await supabase
    .from("pricing_zone_zips")
    .select("zone_id")
    .eq("zip", clean)
    .maybeSingle();
  if (mapped?.zone_id) {
    const zone = zones.find((z) => z.id === String(mapped.zone_id)) || null;
    if (!zone || zone.status === "not_served") {
      return { served: false, zone, defaulted: false, message: "We don't currently serve this area." };
    }
    return { served: true, zone, defaulted: false };
  }

  const { data: coverage } = await supabase
    .from("service_coverage_zones")
    .select("is_active")
    .eq("zip_code", clean)
    .maybeSingle();
  if (coverage?.is_active && defaultZone && defaultZone.status !== "not_served") {
    return { served: true, zone: { ...defaultZone, defaulted: true }, defaulted: true };
  }
  return { served: false, zone: null, defaulted: false, message: "We don't currently serve this area." };
}

// ─── Computing a unit's standing rates ─────────────────────────────────────

export interface StandingRateInput {
  address?: string | null;
  zipCode?: string | null;
  sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  flaggedNonStandard?: boolean;
  /** Registered unit count driving the portfolio tier. */
  unitCount: number;
}

/**
 * Flat rather than a discriminated union: this project compiles with
 * `strictNullChecks` off, where an `ok: true | false` discriminant does not
 * narrow. Callers branch on `ok` and read the side they asked for.
 */
export interface StandingRateResult {
  ok: boolean;
  rates?: StandingRateSet;
  discount?: ResolvedDiscount;
  /** Why the unit could not be auto-priced, when `ok` is false. */
  reason?: UnitReviewReason;
  /** Manager-facing explanation, when `ok` is false. */
  message?: string;
}

/**
 * Compute one unit's full rate set. This is the only place standing rates are
 * produced, so registration, an admin re-price, and a portfolio-wide re-tier
 * cannot drift apart.
 */
export async function computeStandingRates(
  supabase: Admin,
  ctx: PmPricingContext,
  input: StandingRateInput,
): Promise<StandingRateResult> {
  const zip = String(input.zipCode || "").trim() || zipFromAddress(input.address);
  const zoneResolution = await resolveUnitZone(supabase, zip, ctx.zones);

  const review = reviewDecisionForUnit({
    sqft: input.sqft,
    bedrooms: input.bedrooms,
    flaggedNonStandard: input.flaggedNonStandard,
    zoneServed: zoneResolution.served,
    bounds: ctx.bounds,
  });
  if (review.needsReview && review.reason) {
    return { ok: false, reason: review.reason, message: review.message || "This unit needs review." };
  }

  const zone = zoneResolution.zone;
  const band = bandForSqft(input.sqft);
  if (!zone || !band) {
    return {
      ok: false,
      reason: "pricing_unavailable",
      message: "We couldn't price this unit automatically. Our team will set its rates.",
    };
  }

  const discount = resolveVolumeDiscount(ctx.discounts, input.unitCount);
  const list = {} as Record<PmServiceType, number>;
  const basis: Record<string, unknown> = {
    engine: "residential_dynamic",
    config_version: ctx.configVersion,
    condition: ctx.condition,
    demand: "off_standing_rate",
    home_size_id: band.id,
    zone_code: zone.code,
    zone_multiplier: zone.multiplier,
    zone_defaulted: zoneResolution.defaulted,
    zip: zip || null,
    computed_at: new Date().toISOString(),
    services: {} as Record<string, unknown>,
  };

  for (const service of PM_SERVICE_TYPES) {
    const breakdown: QuoteBreakdown = computeQuote(
      ctx.config,
      zone,
      {
        serviceType: engineServiceType(service),
        homeSizeId: band.id,
        focused: null,
        condition: ctx.condition,
        addOns: [],
        sameDay: false,
        membershipPlan: "none",
      },
      NO_DEMAND,
      ctx.payRates,
    );
    if (!breakdown.ok || breakdown.totalCents <= 0) {
      return {
        ok: false,
        reason: "pricing_unavailable",
        message: breakdown.error || "We couldn't price this unit automatically. Our team will set its rates.",
      };
    }
    list[service] = breakdown.totalCents;
    (basis.services as Record<string, unknown>)[service] = {
      engine_service_type: engineServiceType(service),
      list_cents: breakdown.totalCents,
      standing_cents: applyVolumeDiscount(breakdown.totalCents, discount.percent),
      base_cents: breakdown.baseCents,
      condition_delta_cents: breakdown.conditionDeltaCents,
      zone_delta_cents: breakdown.zoneDeltaCents,
      floor_cents: breakdown.floorCents,
      floor_clamped: breakdown.floorClamped,
      lines: breakdown.lines,
    };
  }

  return {
    ok: true,
    discount,
    rates: {
      list,
      standing: {
        move_out: applyVolumeDiscount(list.move_out, discount.percent),
        move_in: applyVolumeDiscount(list.move_in, discount.percent),
        standard: applyVolumeDiscount(list.standard, discount.percent),
      },
      discountPercent: discount.percent,
      discountLabel: discount.label,
      zoneCode: zone.code,
      zoneMultiplier: zone.multiplier,
      homeSizeId: band.id,
      basis,
    },
  };
}

/** Column patch shape for property_manager_units from a computed rate set. */
export function ratesToColumns(rates: StandingRateSet): Record<string, unknown> {
  return {
    list_move_out_cents: rates.list.move_out,
    list_move_in_cents: rates.list.move_in,
    list_standard_cents: rates.list.standard,
    standing_move_out_cents: rates.standing.move_out,
    standing_move_in_cents: rates.standing.move_in,
    standing_standard_cents: rates.standing.standard,
    discount_percent_applied: rates.discountPercent,
    zone_code: rates.zoneCode,
    zone_multiplier: rates.zoneMultiplier,
    home_size_id: rates.homeSizeId,
    rates_computed_at: new Date().toISOString(),
    pricing_basis: rates.basis,
  };
}
