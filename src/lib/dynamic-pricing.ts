// ─── Dynamic pricing engine — zones + demand-reactive layers ───────────────
//
// PURE module: no imports, no I/O, no Deno/Node APIs. It is mirrored 1:1
// between `supabase/functions/_shared/dynamic-pricing.ts` (Deno) and
// `src/lib/dynamic-pricing.ts` (React) — keep the two byte-identical
// (`npm run pricing:verify` checks this).
//
// Price is computed in a strict, auditable sequence:
//
//   BASE            band price for the service type (or focused-area total)
//     × CONDITION   light / standard / heavy
//     × ZONE        fixed market multiplier for the service address
//     × DEMAND      reactive multiplier (capacity / lead time / peak)
//                   → zone × demand capped by the total-uplift ceiling
//                   → clamped to the per-service/band price floor
//     + SURCHARGES  add-ons, same-day fee (flat, never multiplied)
//   = QUOTED PRICE  (then the optional per-zone minimum)
//
// Every layer is returned as its own breakdown line with a plain-language
// reason, so the VA can state and defend the number on a live call and any
// historical quote can be reconstructed exactly.
//
// HARD RULES this module enforces (not convention — code):
//   • No value is hardcoded: band prices, multipliers, focused rates,
//     add-ons, membership rates, the same-day fee, demand weights/bounds and
//     guardrails all come from the DynamicPricingConfig row (DB, versioned).
//   • Pricing inputs are property, service, timing, and location — customer
//     identity, device, or behavior are not accepted as inputs anywhere.
//   • The floor is absolute: no zone/demand combination and no override may
//     price below it, because it protects cleaner per-hour earnings.
//   • Members are exempt from demand on scheduled visits; their rate is
//     part of what they bought.

// ─── Config shape (stored in dynamic_pricing_config_versions.config) ───────

export type ConditionLevel = "light" | "standard" | "heavy";
export type DynamicServiceType =
  | "standard"
  | "deep"
  | "moveInOut"
  | "combo"
  | "focused";
export type MembershipPlanId = "none" | "monthly" | "biweekly" | "weekly";

export interface BandPriceRow {
  standard: number;
  deep: number;
  moveInOut?: number;
}

export interface DynamicPricingConfig {
  base_tables: {
    /** Which table quotes are computed from. */
    authoritative: "training_guide" | "later_sqft_model";
    /** False until admin confirms which table is correct — keeps the
     *  discrepancy banner up in the admin pricing view. */
    reconciled: boolean;
    training_guide: Record<string, BandPriceRow>;
    later_sqft_model: Record<string, BandPriceRow>;
  };
  bands: Record<string, { label: string; hours: number; crew_size: number }>;
  condition_multipliers: Record<ConditionLevel, number>;
  focused_clean: {
    area_cents: number;
    bedroom_cents: number;
    minimum_cents: number;
    /** Focused cleans sit near the floor already — demand off by default. */
    demand_enabled: boolean;
  };
  add_ons_cents: Record<string, number>;
  move_in_out_free_add_ons: string[];
  membership: {
    prices_cents: Record<
      string,
      { monthly: number | null; biweekly: number | null; weekly: number | null }
    >;
    first_month_deep_clean_fee_cents: number;
    demand_exempt: boolean;
  };
  surcharges: { same_day_cents: number };
  demand: {
    /** Master switch. Off leaves base × condition × zone fully functional. */
    enabled: boolean;
    /** Compute + log what demand WOULD do while charging zone-only prices. */
    shadow_mode: boolean;
    min_multiplier: number;
    max_multiplier: number;
    /** Rate limit: the multiplier for a (zone, date) may move at most this
     *  much per hour, so identical requests minutes apart stay consistent. */
    max_delta_per_hour: number;
    inputs: Record<
      "capacity_utilization" | "lead_time" | "peak_period" | "zone_capacity",
      { enabled: boolean; weight: number }
    >;
    lead_time_short_days: number;
    lead_time_long_days: number;
    peak_periods: Array<
      | { type: "weekday"; days: number[]; pressure: number; label: string }
      | { type: "month_end"; from_day: number; pressure: number; label: string }
      | { type: "date_range"; from: string; to: string; pressure: number; label: string }
    >;
  };
  guardrails: {
    /** Minimum per-cleaner hourly the floor must protect, in cents. */
    min_effective_hourly_cents: number;
    /** Optional explicit floors: floor_cents[serviceType][bandId] (cents).
     *  The effective floor is max(explicit, derived-from-hourly). */
    floor_cents: Record<string, Record<string, number>>;
    /** Zone × demand combined may not exceed this over base × condition. */
    max_total_uplift: number;
    /** VA self-serve override band, ± percent of the computed price. */
    override_band_percent: number;
    /** Quote-lock window in hours. */
    quote_lock_hours: number;
  };
  override_reasons: Array<{ code: string; label: string }>;
}

export interface ZoneInfo {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  multiplier: number;
  status: "active" | "surcharge_only" | "not_served";
  min_job_value_cents?: number | null;
  travel_minutes?: number | null;
  is_default: boolean;
  /** True when the zip wasn't explicitly mapped and fell to the default. */
  defaulted?: boolean;
}

/** Cleaner pay rates relevant to the floor (read from cleaner_pay_rates —
 *  the floor uses the LOWEST pool percentage so the guarantee holds for the
 *  worst-paid configuration). */
export interface FloorPayRates {
  soloFoundationPercent: number; // e.g. 35
  crewFoundationPercent: number; // e.g. 40 (pool for 2+)
}

// ─── Demand signals → target multiplier ─────────────────────────────────────
//
// Inputs are capacity and timing ONLY. Nothing about the customer.

export interface DemandSignals {
  /** 0..1 — how booked the requested date already is (null = unknown). */
  capacityUtilization: number | null;
  /** Whole days between now and the service date. */
  leadTimeDays: number;
  /** ISO date being quoted, for the peak-period calendar. */
  serviceDate: string;
  /** Cleaners able to serve the zone that day (null = unknown). */
  zoneAvailableCleaners: number | null;
}

export interface DemandTarget {
  target: number;
  /** Plain-language contributions, e.g. "high booking density (+6%)". */
  reasons: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to whole cents, half away from zero (matches worked examples). */
export function roundCents(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

export function peakPressureForDate(
  config: DynamicPricingConfig,
  serviceDate: string,
): { pressure: number; labels: string[] } {
  const d = new Date(`${serviceDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { pressure: 0, labels: [] };
  const dow = d.getUTCDay();
  const dom = d.getUTCDate();
  let pressure = 0;
  const labels: string[] = [];
  for (const p of config.demand.peak_periods || []) {
    let hit = false;
    if (p.type === "weekday") hit = p.days.includes(dow);
    else if (p.type === "month_end") hit = dom >= p.from_day;
    else if (p.type === "date_range") hit = serviceDate >= p.from && serviceDate <= p.to;
    if (hit) {
      pressure += p.pressure;
      labels.push(p.label);
    }
  }
  return { pressure: clamp(pressure, -1, 1), labels };
}

/**
 * Combine the enabled, weighted signals into a bounded target multiplier.
 * Each signal contributes a pressure in [-1, 1] — negative pressure DISCOUNTS
 * (idle capacity should lower price; this is a demand system, not a
 * surcharge system).
 */
export function computeDemandTarget(
  config: DynamicPricingConfig,
  signals: DemandSignals,
): DemandTarget {
  const d = config.demand;
  let delta = 0;
  const reasons: string[] = [];
  const add = (weight: number, pressure: number, label: string) => {
    const contribution = weight * clamp(pressure, -1, 1);
    if (Math.abs(contribution) < 0.0005) return;
    delta += contribution;
    const pct = (contribution * 100).toFixed(1).replace(/\.0$/, "");
    reasons.push(`${label} (${contribution > 0 ? "+" : ""}${pct}%)`);
  };

  const inCap = d.inputs.capacity_utilization;
  if (inCap?.enabled && signals.capacityUtilization !== null) {
    // 50% booked is neutral; empty day pushes down, full day pushes up.
    const pressure = (clamp(signals.capacityUtilization, 0, 1) - 0.5) * 2;
    add(
      inCap.weight,
      pressure,
      pressure >= 0
        ? "High booking density for this date"
        : "Open capacity on this date",
    );
  }

  const inLead = d.inputs.lead_time;
  if (inLead?.enabled) {
    const short = Math.max(1, d.lead_time_short_days);
    const long = Math.max(short + 1, d.lead_time_long_days);
    const days = Math.max(0, signals.leadTimeDays);
    let pressure: number;
    if (days <= short) {
      pressure = 1 - (days / short) * 0.5; // 0 days → 1.0, short → 0.5
    } else if (days >= long) {
      pressure = -0.25; // booked well ahead — slight downward pressure
    } else {
      pressure = 0.5 * (1 - (days - short) / (long - short)); // taper to 0
    }
    add(
      inLead.weight,
      pressure,
      pressure >= 0 ? "Short-notice scheduling" : "Booked well in advance",
    );
  }

  const inPeak = d.inputs.peak_period;
  if (inPeak?.enabled) {
    const peak = peakPressureForDate(config, signals.serviceDate);
    if (peak.pressure !== 0) {
      add(inPeak.weight, peak.pressure, peak.labels.join(" · ") || "Peak period");
    }
  }

  const inZone = d.inputs.zone_capacity;
  if (inZone?.enabled && signals.zoneAvailableCleaners !== null) {
    const n = Math.max(0, signals.zoneAvailableCleaners);
    const pressure = n === 0 ? 1 : n === 1 ? 0.6 : n === 2 ? 0.3 : 0;
    add(inZone.weight, pressure, "Limited cleaner coverage in this area that day");
  }

  return {
    target: clamp(1 + delta, d.min_multiplier, d.max_multiplier),
    reasons,
  };
}

/**
 * Rate-limit the multiplier's movement toward its target: at most
 * max_delta_per_hour × elapsed hours away from the previous published value
 * for this (zone, date), so identical requests minutes apart don't produce
 * jarringly different prices.
 */
export function applyRateLimit(
  config: DynamicPricingConfig,
  target: number,
  previous: { multiplier: number; updatedAtMs: number } | null,
  nowMs: number,
): number {
  const d = config.demand;
  if (!previous) return clamp(target, d.min_multiplier, d.max_multiplier);
  const hours = Math.max(0, (nowMs - previous.updatedAtMs) / 3_600_000);
  const allowed = d.max_delta_per_hour * hours;
  const next = previous.multiplier + clamp(target - previous.multiplier, -allowed, allowed);
  return clamp(next, d.min_multiplier, d.max_multiplier);
}

// ─── Price floor ────────────────────────────────────────────────────────────

/**
 * Floor per service type and band: the price at which, after the applicable
 * cleaner pay pool percentage, per-cleaner hourly earnings stay at or above
 * the configured minimum for the projected duration and crew size.
 *
 *   perCleanerHourly = price × poolPct / crewSize / hours  ≥  minHourly
 *   ⇒ price ≥ minHourly × hours × crewSize / poolPct
 *
 * The FOUNDATION percentage (the lowest) is used so the guarantee holds for
 * every tier. An explicit configured floor for the service/band wins when it
 * is higher. Discounts below the computed price are always funded by company
 * margin — cleaner pay stays a percentage of final job value.
 */
export function computeFloorCents(
  config: DynamicPricingConfig,
  serviceType: DynamicServiceType,
  homeSizeId: string | null,
  payRates: FloorPayRates,
): number {
  const explicit =
    (homeSizeId && config.guardrails.floor_cents?.[serviceType]?.[homeSizeId]) ||
    config.guardrails.floor_cents?.[serviceType]?.["default"] ||
    0;
  if (serviceType === "focused" || !homeSizeId) {
    // Focused cleans have a flat minimum already; only an explicit floor adds.
    return Math.max(explicit, serviceType === "focused" ? config.focused_clean.minimum_cents : 0);
  }
  const band = config.bands[homeSizeId];
  if (!band || band.hours <= 0) return explicit;
  const crew = Math.max(1, band.crew_size);
  const poolPct =
    (crew > 1 ? payRates.crewFoundationPercent : payRates.soloFoundationPercent) / 100;
  if (poolPct <= 0) return explicit;
  // Combo is two visits (deep + standard) — floor covers both.
  const visits = serviceType === "combo" ? 2 : 1;
  const derived = roundCents(
    (config.guardrails.min_effective_hourly_cents * band.hours * crew * visits) / poolPct,
  );
  return Math.max(explicit, derived);
}

// ─── Quote computation ──────────────────────────────────────────────────────

export interface QuoteInput {
  serviceType: DynamicServiceType;
  /** Band id for sized services; null for focused cleans. */
  homeSizeId: string | null;
  /** Focused-clean composition (areas = non-bedroom areas). */
  focused?: { areas: number; bedrooms: number } | null;
  condition: ConditionLevel;
  addOns: string[];
  /** Same-day flag — flat surcharge, applied after all multipliers. */
  sameDay: boolean;
  membershipPlan: MembershipPlanId;
  /** Membership only: include the first-month deep-clean fee. */
  firstMonth?: boolean;
}

/** Demand as resolved by the caller (rate-limited, bounded). */
export interface DemandResolution {
  /** 'off' — master switch off · 'shadow' — logged only · 'live' — applied. */
  mode: "off" | "shadow" | "live";
  /** The bounded, rate-limited multiplier reactive pricing arrived at. */
  multiplier: number;
  reasons: string[];
}

export interface BreakdownLine {
  key: string;
  label: string;
  /** Plain-language reason the VA can read to themselves (never aloud). */
  reason: string;
  amountCents: number;
  multiplier?: number;
  kind: "base" | "multiplier" | "surcharge" | "clamp" | "minimum" | "info";
}

export interface QuoteBreakdown {
  ok: boolean;
  error?: string;
  serviceType: DynamicServiceType;
  homeSizeId: string | null;
  condition: ConditionLevel;
  zoneCode: string;
  zoneMultiplier: number;
  conditionMultiplier: number;
  /** Demand multiplier APPLIED to the price (1.0 when off/shadow/exempt). */
  demandMultiplier: number;
  /** What reactive pricing WOULD apply — logged on every quote (shadow). */
  shadowDemandMultiplier: number;
  demandMode: "off" | "shadow" | "live" | "exempt_member" | "exempt_service";
  baseCents: number;
  conditionDeltaCents: number;
  zoneDeltaCents: number;
  demandDeltaCents: number;
  addOnsCents: number;
  surchargesCents: number;
  /** Multiplied service price after clamps, before add-ons/surcharges. */
  serviceTotalCents: number;
  totalCents: number;
  floorCents: number;
  floorClamped: boolean;
  ceilingClamped: boolean;
  zoneMinimumApplied: boolean;
  lines: BreakdownLine[];
  membership: null | {
    plan: MembershipPlanId;
    monthlyCents: number;
    firstMonthFeeCents: number;
    firstMonthTotalCents: number;
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(mult: number): string {
  const p = (mult - 1) * 100;
  const s = Math.abs(p) < 10 ? p.toFixed(1).replace(/\.0$/, "") : Math.round(p).toString();
  return `${p >= 0 ? "+" : ""}${s}%`;
}

function failed(input: QuoteInput, zoneCode: string, error: string): QuoteBreakdown {
  return {
    ok: false,
    error,
    serviceType: input.serviceType,
    homeSizeId: input.homeSizeId,
    condition: input.condition,
    zoneCode,
    zoneMultiplier: 1,
    conditionMultiplier: 1,
    demandMultiplier: 1,
    shadowDemandMultiplier: 1,
    demandMode: "off",
    baseCents: 0,
    conditionDeltaCents: 0,
    zoneDeltaCents: 0,
    demandDeltaCents: 0,
    addOnsCents: 0,
    surchargesCents: 0,
    serviceTotalCents: 0,
    totalCents: 0,
    floorCents: 0,
    floorClamped: false,
    ceilingClamped: false,
    zoneMinimumApplied: false,
    lines: [],
    membership: null,
  };
}

/** Base price in cents from the authoritative table for a sized service. */
export function baseCentsFor(
  config: DynamicPricingConfig,
  serviceType: DynamicServiceType,
  homeSizeId: string,
): number {
  const table = config.base_tables[config.base_tables.authoritative] ||
    config.base_tables.training_guide;
  const row = table[homeSizeId];
  if (!row) return 0;
  switch (serviceType) {
    case "standard":
      return row.standard || 0;
    case "deep":
      return row.deep || 0;
    case "moveInOut":
      return row.moveInOut ?? roundCents((row.standard || 0) * 2);
    case "combo":
      return (row.standard || 0) + (row.deep || 0);
    default:
      return 0;
  }
}

/**
 * The layered quote. Deterministic: same property, service, timing, and
 * location → same price, regardless of who is asking.
 */
export function computeQuote(
  config: DynamicPricingConfig,
  zone: ZoneInfo,
  input: QuoteInput,
  demand: DemandResolution,
  payRates: FloorPayRates,
): QuoteBreakdown {
  const lines: BreakdownLine[] = [];

  // ── Membership rail: zone applies, demand never does (locked plan rate) ──
  if (input.membershipPlan !== "none") {
    if (!input.homeSizeId) return failed(input, zone.code, "Membership pricing requires a home size band.");
    const row = config.membership.prices_cents[input.homeSizeId];
    const planBase = row?.[input.membershipPlan as "monthly" | "biweekly" | "weekly"];
    if (planBase == null) {
      return failed(
        input,
        zone.code,
        "This plan frequency is not offered for this home size — quote a custom plan.",
      );
    }
    const monthly = roundCents(planBase * zone.multiplier);
    const fee = input.firstMonth ? config.membership.first_month_deep_clean_fee_cents : 0;
    const bandLabel = config.bands[input.homeSizeId]?.label || input.homeSizeId;
    lines.push({
      key: "base",
      label: `Membership (${input.membershipPlan}) · ${bandLabel}`,
      reason: "Published membership rate for this home size",
      amountCents: planBase,
      kind: "base",
    });
    if (zone.multiplier !== 1) {
      lines.push({
        key: "zone",
        label: `Zone ${zone.code} — ${zone.name}`,
        reason: `Service-area rate for this address (${pct(zone.multiplier)})`,
        amountCents: monthly - planBase,
        multiplier: zone.multiplier,
        kind: "multiplier",
      });
    }
    if (fee > 0) {
      lines.push({
        key: "first_month_fee",
        label: "First-month deep clean",
        reason: "One-time onboarding deep clean for new members",
        amountCents: fee,
        kind: "surcharge",
      });
    }
    lines.push({
      key: "demand_exempt",
      label: "Demand adjustment",
      reason: "Members are exempt — plan rate is locked",
      amountCents: 0,
      kind: "info",
    });
    return {
      ok: true,
      serviceType: input.serviceType,
      homeSizeId: input.homeSizeId,
      condition: input.condition,
      zoneCode: zone.code,
      zoneMultiplier: zone.multiplier,
      conditionMultiplier: 1,
      demandMultiplier: 1,
      shadowDemandMultiplier: demand.multiplier,
      demandMode: "exempt_member",
      baseCents: planBase,
      conditionDeltaCents: 0,
      zoneDeltaCents: monthly - planBase,
      demandDeltaCents: 0,
      addOnsCents: 0,
      surchargesCents: fee,
      serviceTotalCents: monthly,
      totalCents: monthly + fee,
      floorCents: 0,
      floorClamped: false,
      ceilingClamped: false,
      zoneMinimumApplied: false,
      lines,
      membership: {
        plan: input.membershipPlan,
        monthlyCents: monthly,
        firstMonthFeeCents: fee,
        firstMonthTotalCents: monthly + fee,
      },
    };
  }

  // ── BASE ──
  let baseCents = 0;
  let baseLabel = "";
  let baseReason = "";
  if (input.serviceType === "focused") {
    const areas = Math.max(0, input.focused?.areas || 0);
    const bedrooms = Math.max(0, input.focused?.bedrooms || 0);
    if (areas + bedrooms === 0) return failed(input, zone.code, "Pick at least one area for a focused clean.");
    const raw = areas * config.focused_clean.area_cents + bedrooms * config.focused_clean.bedroom_cents;
    baseCents = Math.max(raw, config.focused_clean.minimum_cents);
    const parts: string[] = [];
    if (areas > 0) parts.push(`${areas} × area ${money(config.focused_clean.area_cents)}`);
    if (bedrooms > 0) parts.push(`${bedrooms} × bedroom ${money(config.focused_clean.bedroom_cents)}`);
    baseLabel = "Focused clean";
    baseReason = parts.join(" + ") + (baseCents > raw ? ` (minimum ${money(config.focused_clean.minimum_cents)})` : "");
  } else {
    if (!input.homeSizeId) return failed(input, zone.code, "Home size is required.");
    baseCents = baseCentsFor(config, input.serviceType, input.homeSizeId);
    if (baseCents <= 0) {
      return failed(input, zone.code, "This home size needs a custom quote — flag it for admin.");
    }
    baseLabel = `${config.bands[input.homeSizeId]?.label || input.homeSizeId}`;
    baseReason = "Base rate for this home size and service (quoted at Zone B)";
  }
  lines.push({ key: "base", label: baseLabel, reason: baseReason, amountCents: baseCents, kind: "base" });

  // ── × CONDITION ──
  const condMult = config.condition_multipliers[input.condition] ?? 1;
  const afterCondition = roundCents(baseCents * condMult);
  if (condMult !== 1) {
    lines.push({
      key: "condition",
      label: `Condition: ${input.condition}`,
      reason: `Projected effort for a ${input.condition}-condition home (${pct(condMult)})`,
      amountCents: afterCondition - baseCents,
      multiplier: condMult,
      kind: "multiplier",
    });
  }

  // ── × ZONE ──
  const afterZone = roundCents(afterCondition * zone.multiplier);
  if (zone.multiplier !== 1) {
    lines.push({
      key: "zone",
      label: `Zone ${zone.code} — ${zone.name}`,
      reason:
        zone.multiplier > 1
          ? `Premium service area — travel and market rates (${pct(zone.multiplier)})`
          : `Outer service area rate (${pct(zone.multiplier)})`,
      amountCents: afterZone - afterCondition,
      multiplier: zone.multiplier,
      kind: "multiplier",
    });
  }

  // ── × DEMAND (bounded, rate-limited by the caller; exemptions here) ──
  const focusedExempt = input.serviceType === "focused" && !config.focused_clean.demand_enabled;
  let demandMode: QuoteBreakdown["demandMode"] = demand.mode;
  let appliedDemand = demand.mode === "live" ? demand.multiplier : 1;
  if (focusedExempt) {
    demandMode = "exempt_service";
    appliedDemand = 1;
  }
  let afterDemand = roundCents(afterZone * appliedDemand);

  // ── CEILING: zone × demand combined may not exceed max_total_uplift ──
  const cap = config.guardrails.max_total_uplift;
  const maxAllowed = roundCents(afterCondition * cap);
  let ceilingClamped = false;
  if (afterDemand > maxAllowed) {
    ceilingClamped = true;
    afterDemand = maxAllowed;
  }
  if (appliedDemand !== 1) {
    lines.push({
      key: "demand",
      label: "Demand adjustment",
      reason:
        (demand.reasons.length ? demand.reasons.join(" · ") : "Scheduling demand for this date") +
        ` (${pct(appliedDemand)})`,
      amountCents: afterDemand - afterZone,
      multiplier: appliedDemand,
      kind: "multiplier",
    });
  } else if (demandMode === "exempt_service") {
    lines.push({
      key: "demand",
      label: "Demand adjustment",
      reason: "Not applied to focused cleans (already near the minimum)",
      amountCents: 0,
      kind: "info",
    });
  } else if (demandMode === "shadow") {
    lines.push({
      key: "demand",
      label: "Demand adjustment (shadow)",
      reason: `Reactive pricing is in shadow mode — would apply ×${demand.multiplier.toFixed(2)}, not charged`,
      amountCents: 0,
      kind: "info",
    });
  }
  if (ceilingClamped) {
    lines.push({
      key: "ceiling",
      label: "Ceiling applied",
      reason: `Total uplift is capped at ×${cap.toFixed(2)} over the base — trust protection`,
      amountCents: 0,
      kind: "clamp",
    });
  }

  // ── FLOOR: absolute, protects cleaner per-hour earnings ──
  const floorCents = computeFloorCents(config, input.serviceType, input.homeSizeId, payRates);
  let serviceTotal = afterDemand;
  let floorClamped = false;
  if (floorCents > 0 && serviceTotal < floorCents) {
    floorClamped = true;
    lines.push({
      key: "floor",
      label: "Floor applied",
      reason: `Minimum for this service and size (${money(floorCents)}) — protects cleaner pay`,
      amountCents: floorCents - serviceTotal,
      kind: "clamp",
    });
    serviceTotal = floorCents;
  }

  // ── + SURCHARGES (flat, added after all multipliers, never multiplied) ──
  let addOnsCents = 0;
  const freeAddOns = input.serviceType === "moveInOut" ? config.move_in_out_free_add_ons : [];
  for (const a of input.addOns || []) {
    const price = config.add_ons_cents[a];
    if (price == null) continue;
    if (freeAddOns.includes(a)) {
      lines.push({
        key: `addon_${a}`,
        label: `Add-on: ${a}`,
        reason: "Included free with Move-In/Move-Out",
        amountCents: 0,
        kind: "info",
      });
      continue;
    }
    addOnsCents += price;
    lines.push({
      key: `addon_${a}`,
      label: `Add-on: ${a}`,
      reason: "Flat add-on rate — not affected by multipliers",
      amountCents: price,
      kind: "surcharge",
    });
  }
  let surchargesCents = 0;
  if (input.sameDay) {
    surchargesCents += config.surcharges.same_day_cents;
    lines.push({
      key: "same_day",
      label: "Same-day service",
      reason: `Flat ${money(config.surcharges.same_day_cents)} same-day fee — added after multipliers`,
      amountCents: config.surcharges.same_day_cents,
      kind: "surcharge",
    });
  }

  let totalCents = serviceTotal + addOnsCents + surchargesCents;

  // ── Optional per-zone minimum job value ──
  let zoneMinimumApplied = false;
  if (zone.min_job_value_cents && totalCents < zone.min_job_value_cents) {
    zoneMinimumApplied = true;
    lines.push({
      key: "zone_minimum",
      label: `Zone ${zone.code} minimum`,
      reason: `Minimum job value for this service area is ${money(zone.min_job_value_cents)}`,
      amountCents: zone.min_job_value_cents - totalCents,
      kind: "minimum",
    });
    totalCents = zone.min_job_value_cents;
  }

  return {
    ok: true,
    serviceType: input.serviceType,
    homeSizeId: input.homeSizeId,
    condition: input.condition,
    zoneCode: zone.code,
    zoneMultiplier: zone.multiplier,
    conditionMultiplier: condMult,
    demandMultiplier: appliedDemand,
    shadowDemandMultiplier: demand.multiplier,
    demandMode,
    baseCents,
    conditionDeltaCents: afterCondition - baseCents,
    zoneDeltaCents: afterZone - afterCondition,
    demandDeltaCents: afterDemand - afterZone,
    addOnsCents,
    surchargesCents,
    serviceTotalCents: serviceTotal,
    totalCents,
    floorCents,
    floorClamped,
    ceilingClamped,
    zoneMinimumApplied,
    lines,
    membership: null,
  };
}

// ─── VA override validation ─────────────────────────────────────────────────

export interface OverrideCheck {
  allowed: boolean;
  requiresApproval: boolean;
  belowFloor: boolean;
  deltaPercent: number;
  reason: string;
}

/**
 * A VA may adjust within ±override_band_percent with a required reason.
 * Beyond the band → admin approval. Below the floor → never, at any level:
 * the floor exists to protect cleaner pay and is not overridable.
 */
export function checkOverride(
  config: DynamicPricingConfig,
  computedCents: number,
  overrideCents: number,
  floorCents: number,
): OverrideCheck {
  const deltaPercent = computedCents > 0
    ? ((overrideCents - computedCents) / computedCents) * 100
    : 0;
  if (floorCents > 0 && overrideCents < floorCents) {
    return {
      allowed: false,
      requiresApproval: false,
      belowFloor: true,
      deltaPercent,
      reason: `Override is below the ${money(floorCents)} floor for this service — the floor protects cleaner pay and cannot be overridden.`,
    };
  }
  const band = config.guardrails.override_band_percent;
  if (Math.abs(deltaPercent) > band) {
    return {
      allowed: false,
      requiresApproval: true,
      belowFloor: false,
      deltaPercent,
      reason: `Adjustment of ${deltaPercent.toFixed(1)}% is outside the ±${band}% VA band — needs admin approval.`,
    };
  }
  return {
    allowed: true,
    requiresApproval: false,
    belowFloor: false,
    deltaPercent,
    reason: "Within the VA adjustment band.",
  };
}
