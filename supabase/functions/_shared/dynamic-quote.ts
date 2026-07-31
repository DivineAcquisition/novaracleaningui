// ─── Dynamic quote glue (Deno) ──────────────────────────────────────────────
//
// Everything I/O-flavored that the pure engine (`dynamic-pricing.ts`) must not
// contain: loading the active config version, resolving a zip to a zone,
// reading demand signals from live tables, persisting the rate-limit state,
// and writing the price audit row. Used by BOTH `quote-dynamic-price` (the
// internal booking screen's quote endpoint) and `book-as-va` (the booking
// submit path) so the number the VA sees is computed by the same code that
// charges it.

import {
  applyRateLimit,
  checkOverride,
  computeDemandTarget,
  computeFloorCents,
  computeQuote,
  type ConditionLevel,
  type DemandResolution,
  type DynamicPricingConfig,
  type DynamicServiceType,
  type FloorPayRates,
  type MembershipPlanId,
  type QuoteBreakdown,
  type QuoteInput,
  type ZoneInfo,
} from "./dynamic-pricing.ts";

export { checkOverride, computeFloorCents };
export type {
  ConditionLevel,
  DynamicPricingConfig,
  DynamicServiceType,
  MembershipPlanId,
  QuoteBreakdown,
  ZoneInfo,
};

// deno-lint-ignore no-explicit-any
type Supa = any;

export interface DynamicPricingContext {
  config: DynamicPricingConfig;
  configVersion: number;
  zones: ZoneInfo[];
  payRates: FloorPayRates;
}

/** Load the active config version + zones + floor pay rates. Returns null
 *  when dynamic pricing has never been configured (legacy pricing applies). */
export async function loadDynamicPricingContext(
  supabase: Supa,
): Promise<DynamicPricingContext | null> {
  const { data: cfgRow } = await supabase
    .from("dynamic_pricing_config_versions")
    .select("version, config")
    .eq("is_active", true)
    .maybeSingle();
  if (!cfgRow?.config) return null;

  const { data: zoneRows } = await supabase
    .from("pricing_zones")
    .select("id, code, name, description, multiplier, status, min_job_value_cents, travel_minutes, is_default");
  const zones: ZoneInfo[] = (zoneRows || []).map((z: Record<string, unknown>) => ({
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

  // Floor math uses the FOUNDATION pool percentages (the lowest) so the
  // per-cleaner hourly guarantee holds for every tier. Read from the live
  // cleaner_pay_rates table — never hardcoded here.
  const payRates: FloorPayRates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
  const { data: rateRows } = await supabase
    .from("cleaner_pay_rates")
    .select("min_crew_size, max_crew_size, rate_percent")
    .eq("pay_tier", "foundation");
  for (const r of rateRows || []) {
    const min = Number(r.min_crew_size);
    const max = r.max_crew_size == null ? Infinity : Number(r.max_crew_size);
    if (min <= 1 && 1 <= max) payRates.soloFoundationPercent = Number(r.rate_percent);
    if (min <= 2 && 2 <= max) payRates.crewFoundationPercent = Number(r.rate_percent);
  }

  return { config: cfgRow.config as DynamicPricingConfig, configVersion: Number(cfgRow.version), zones, payRates };
}

// ─── Zone resolution ────────────────────────────────────────────────────────

export interface ZoneResolution {
  served: boolean;
  zone: ZoneInfo | null;
  /** Unmapped zip that fell to the default zone. */
  defaulted: boolean;
  message?: string;
}

export const WAITLIST_MESSAGE =
  "We don't currently serve this area. Offer the customer the expansion waitlist — they'll be first in line when coverage opens.";

/**
 * Zip → zone. A zip belongs to exactly one zone; a served-but-unmapped zip
 * falls to the default zone so a new zip never breaks a quote; an address
 * outside all served areas gets a clear waitlist message, never a wrong price.
 */
export async function resolveZoneForZip(
  supabase: Supa,
  zip: string | null | undefined,
  zones: ZoneInfo[],
): Promise<ZoneResolution> {
  const clean = String(zip || "").trim().slice(0, 5);
  const defaultZone = zones.find((z) => z.is_default) || null;
  if (!/^[0-9]{5}$/.test(clean)) {
    return { served: false, zone: null, defaulted: false, message: "Enter a 5-digit ZIP to price this quote." };
  }

  const { data: mapped } = await supabase
    .from("pricing_zone_zips")
    .select("zone_id")
    .eq("zip", clean)
    .maybeSingle();
  if (mapped?.zone_id) {
    const zone = zones.find((z) => z.id === String(mapped.zone_id)) || null;
    if (!zone || zone.status === "not_served") {
      return { served: false, zone, defaulted: false, message: WAITLIST_MESSAGE };
    }
    return { served: true, zone, defaulted: false };
  }

  // Unmapped: served area (active coverage) → default zone; otherwise waitlist.
  const { data: coverage } = await supabase
    .from("service_coverage_zones")
    .select("is_active")
    .eq("zip_code", clean)
    .maybeSingle();
  if (coverage?.is_active && defaultZone && defaultZone.status !== "not_served") {
    return { served: true, zone: { ...defaultZone, defaulted: true }, defaulted: true };
  }
  return { served: false, zone: null, defaulted: false, message: WAITLIST_MESSAGE };
}

// ─── Demand resolution (signals → bounded, rate-limited multiplier) ────────

export interface DemandOutcome extends DemandResolution {
  /** The un-rate-limited target, for reporting. */
  target: number;
  signals: {
    capacityUtilization: number | null;
    leadTimeDays: number;
    zoneAvailableCleaners: number | null;
  };
}

function todayIso(): string {
  // Business calendar runs on America/New_York.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function isSameDayBooking(serviceDate: string): boolean {
  return serviceDate === todayIso();
}

function leadDays(serviceDate: string): number {
  const now = new Date(`${todayIso()}T00:00:00Z`).getTime();
  const svc = new Date(`${serviceDate}T00:00:00Z`).getTime();
  if (Number.isNaN(svc)) return 0;
  return Math.max(0, Math.round((svc - now) / 86_400_000));
}

async function capacityUtilizationFor(supabase: Supa, serviceDate: string): Promise<number | null> {
  const { data } = await supabase
    .from("availability_slots")
    .select("max_capacity, current_bookings")
    .eq("service_date", serviceDate);
  if (!data || data.length === 0) return null;
  let cap = 0;
  let booked = 0;
  for (const r of data) {
    cap += Number(r.max_capacity) || 0;
    booked += Number(r.current_bookings) || 0;
  }
  return cap > 0 ? Math.min(1, booked / cap) : null;
}

async function zoneAvailableCleaners(
  supabase: Supa,
  zone: ZoneInfo,
): Promise<number | null> {
  if (!zone.id) return null;
  try {
    const { data: zipRows } = await supabase
      .from("pricing_zone_zips")
      .select("zip")
      .eq("zone_id", zone.id)
      .limit(200);
    const zips = (zipRows || []).map((r: { zip: string }) => r.zip);
    if (zips.length === 0) return null;
    const { count } = await supabase
      .from("cleaners")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("available_for_bookings", true)
      .overlaps("service_zip_codes", zips);
    return typeof count === "number" ? count : null;
  } catch (_) {
    return null; // unknown → neutral pressure, never an error mid-quote
  }
}

/**
 * The full demand pipeline for one (zone, date): read signals → weighted
 * target → clamp to bounds → rate-limit against the last published value →
 * optionally persist the new state (only for real quotes, not probes).
 */
export async function resolveDemand(
  supabase: Supa,
  config: DynamicPricingConfig,
  zone: ZoneInfo,
  serviceDate: string,
  opts: { persist: boolean; includeZoneCapacity?: boolean } = { persist: true },
): Promise<DemandOutcome> {
  const off: DemandOutcome = {
    mode: "off",
    multiplier: 1,
    reasons: [],
    target: 1,
    signals: { capacityUtilization: null, leadTimeDays: leadDays(serviceDate), zoneAvailableCleaners: null },
  };
  if (!config.demand.enabled && !config.demand.shadow_mode) return off;

  const [capacityUtilization, availableCleaners] = await Promise.all([
    capacityUtilizationFor(supabase, serviceDate),
    opts.includeZoneCapacity === false ? Promise.resolve(null) : zoneAvailableCleaners(supabase, zone),
  ]);
  const signals = {
    capacityUtilization,
    leadTimeDays: leadDays(serviceDate),
    serviceDate,
    zoneAvailableCleaners: availableCleaners,
  };
  const { target, reasons } = computeDemandTarget(config, signals);

  let previous: { multiplier: number; updatedAtMs: number } | null = null;
  if (zone.id) {
    const { data: prev } = await supabase
      .from("demand_rate_state")
      .select("multiplier, updated_at")
      .eq("zone_id", zone.id)
      .eq("service_date", serviceDate)
      .maybeSingle();
    if (prev) {
      previous = { multiplier: Number(prev.multiplier), updatedAtMs: new Date(prev.updated_at).getTime() };
    }
  }
  const multiplier = applyRateLimit(config, target, previous, Date.now());

  if (opts.persist && zone.id && Math.abs(multiplier - (previous?.multiplier ?? -1)) > 0.00005) {
    await supabase
      .from("demand_rate_state")
      .upsert(
        { zone_id: zone.id, service_date: serviceDate, multiplier, updated_at: new Date().toISOString() },
        { onConflict: "zone_id,service_date" },
      );
  }

  return {
    mode: config.demand.enabled ? "live" : "shadow",
    multiplier,
    reasons,
    target,
    signals: {
      capacityUtilization,
      leadTimeDays: signals.leadTimeDays,
      zoneAvailableCleaners: availableCleaners,
    },
  };
}

// ─── One-call server quote (zone + demand + engine + audit) ────────────────

export interface ServerQuoteParams {
  zip: string | null | undefined;
  serviceType: DynamicServiceType;
  homeSizeId: string | null;
  focused?: { areas: number; bedrooms: number } | null;
  condition: ConditionLevel;
  addOns: string[];
  serviceDate: string | null;
  membershipPlan?: MembershipPlanId;
  firstMonth?: boolean;
  quotedBy?: string | null;
  /** Persist demand rate-limit state (true for real quotes, false for probes). */
  persistDemandState?: boolean;
  /** Write a price_quote_audit row (default true). */
  audit?: boolean;
  quoteId?: string | null;
  bookingId?: string | null;
  chargedCents?: number | null;
}

export interface ServerQuoteResult {
  ok: boolean;
  served: boolean;
  message?: string;
  zone: ZoneInfo | null;
  breakdown: QuoteBreakdown | null;
  demand: DemandOutcome | null;
  configVersion: number;
  auditId: string | null;
}

export async function computeServerQuote(
  supabase: Supa,
  ctx: DynamicPricingContext,
  params: ServerQuoteParams,
): Promise<ServerQuoteResult> {
  const resolution = await resolveZoneForZip(supabase, params.zip, ctx.zones);
  if (!resolution.served || !resolution.zone) {
    return {
      ok: false,
      served: false,
      message: resolution.message || WAITLIST_MESSAGE,
      zone: resolution.zone,
      breakdown: null,
      demand: null,
      configVersion: ctx.configVersion,
      auditId: null,
    };
  }
  const zone = resolution.zone;

  const serviceDate = params.serviceDate || todayIso();
  const demand = await resolveDemand(supabase, ctx.config, zone, serviceDate, {
    persist: params.persistDemandState !== false,
  });

  const input: QuoteInput = {
    serviceType: params.serviceType,
    homeSizeId: params.homeSizeId,
    focused: params.focused || null,
    condition: params.condition,
    addOns: params.addOns || [],
    sameDay: Boolean(params.serviceDate) && isSameDayBooking(serviceDate),
    membershipPlan: params.membershipPlan || "none",
    firstMonth: params.firstMonth,
  };
  const breakdown = computeQuote(ctx.config, zone, input, demand, ctx.payRates);

  let auditId: string | null = null;
  if (params.audit !== false && breakdown.ok) {
    auditId = await writePriceAudit(supabase, {
      quoteId: params.quoteId || null,
      bookingId: params.bookingId || null,
      zip: String(params.zip || "").slice(0, 5),
      breakdown,
      configVersion: ctx.configVersion,
      serviceDate,
      membershipPlan: input.membershipPlan,
      quotedBy: params.quotedBy || null,
      chargedCents: params.chargedCents ?? null,
    });
  }

  return {
    ok: breakdown.ok,
    served: true,
    message: breakdown.ok ? undefined : breakdown.error,
    zone,
    breakdown,
    demand,
    configVersion: ctx.configVersion,
    auditId,
  };
}

export async function writePriceAudit(
  supabase: Supa,
  row: {
    quoteId: string | null;
    bookingId: string | null;
    zip: string;
    breakdown: QuoteBreakdown;
    configVersion: number;
    serviceDate: string;
    membershipPlan: MembershipPlanId;
    quotedBy: string | null;
    chargedCents: number | null;
  },
): Promise<string | null> {
  try {
    const b = row.breakdown;
    const { data } = await supabase
      .from("price_quote_audit")
      .insert({
        quote_id: row.quoteId,
        booking_id: row.bookingId,
        zip: row.zip || null,
        zone_code: b.zoneCode,
        service_type: b.serviceType,
        home_size_id: b.homeSizeId,
        condition: b.condition,
        service_date: row.serviceDate,
        membership_plan: row.membershipPlan,
        breakdown: b,
        config_version: row.configVersion,
        demand_mode: b.demandMode,
        demand_multiplier: b.demandMultiplier,
        shadow_demand_multiplier: b.shadowDemandMultiplier,
        floor_clamped: b.floorClamped,
        ceiling_clamped: b.ceilingClamped,
        final_cents: b.totalCents,
        charged_cents: row.chargedCents,
        quoted_by: row.quotedBy,
      })
      .select("id")
      .single();
    return data?.id ? String(data.id) : null;
  } catch (err) {
    // Audit is best-effort at write time; a quote must never fail because
    // logging did. (The booking path re-stamps charged_cents afterwards.)
    console.error("[dynamic-quote] audit write failed", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Alternative dates — reactive pricing as a sales tool ──────────────────
//
// Surface nearby dates with LOWER demand pricing so the VA can offer the
// customer a cheaper option instead of discounting.

export interface AlternativeDate {
  serviceDate: string;
  demandMultiplier: number;
  totalCents: number;
}

export async function findCheaperDates(
  supabase: Supa,
  ctx: DynamicPricingContext,
  zone: ZoneInfo,
  params: Omit<ServerQuoteParams, "serviceDate">,
  aroundDate: string,
  currentTotalCents: number,
  lookAheadDays = 10,
): Promise<AlternativeDate[]> {
  if (!ctx.config.demand.enabled) return []; // only meaningful when live
  const out: AlternativeDate[] = [];
  const start = new Date(`${aroundDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const today = todayIso();

  for (let i = 1; i <= lookAheadDays; i++) {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    if (d <= today) continue;
    // Probe: no state persistence, skip the per-date zone-capacity query
    // (a 10-date scan should stay cheap; capacity + calendar still count).
    const demand = await resolveDemand(supabase, ctx.config, zone, d, {
      persist: false,
      includeZoneCapacity: false,
    });
    const breakdown = computeQuote(
      ctx.config,
      zone,
      {
        serviceType: params.serviceType,
        homeSizeId: params.homeSizeId,
        focused: params.focused || null,
        condition: params.condition,
        addOns: params.addOns || [],
        sameDay: false,
        membershipPlan: params.membershipPlan || "none",
        firstMonth: params.firstMonth,
      },
      demand,
      ctx.payRates,
    );
    if (breakdown.ok && breakdown.totalCents < currentTotalCents) {
      out.push({ serviceDate: d, demandMultiplier: demand.multiplier, totalCents: breakdown.totalCents });
    }
  }
  return out.sort((a, b) => a.totalCents - b.totalCents).slice(0, 3);
}
