// ─── Commercial pricing model ──────────────────────────────────────────────
//
// Residential prices off sqft bands built for homes — bedrooms, bathrooms,
// kitchens. Commercial runs from a 1,200 sqft office suite to a 50,000 sqft
// warehouse, where the price driver is the facility and the depth of the
// scope, not the room count:
//
//   price = sqft × facility_type_base_rate × scope_multiplier × size_tier_multiplier
//
//   FACILITY TYPE  detail density per square foot — a restaurant kitchen costs
//                  multiples of open warehouse floor
//   SCOPE LEVEL    Light / Standard / Detailed, each the previous plus more
//   SIZE TIER      economies of scale: effective $/sqft FALLS as area rises,
//                  because fixed setup and travel spread further and large
//                  jobs are more efficient per labour-hour
//
// Every rate and multiplier is a database row an admin edits. The values that
// ship are an educated starting point; the real ones only appear in completed
// job data, the same way zone multipliers were tuned.
//
// Above a configurable square footage the formula stops being a price and
// becomes an anchor — see requiresWalkthrough below.
//
// This file is pure arithmetic with no imports, and is mirrored byte-for-byte
// at supabase/functions/_shared/commercial-pricing.ts so the quote a VA sees,
// the price the booking records, and the crew the dispatcher gets are all the
// same computation. Change one, change both.

export type ScopeLevelKey = "light" | "standard" | "detailed";

export interface FacilityType {
  key: string;
  label: string;
  /** Cents per square foot before scope and size-tier multipliers. */
  base_rate_cents_per_sqft: number;
  description?: string | null;
  sort_order?: number;
  active?: boolean;
}

export interface ScopeLevel {
  key: string;
  label: string;
  multiplier: number;
  summary?: string | null;
  /** Square feet one cleaner covers per hour at this depth. */
  sqft_per_cleaner_hour: number;
  sort_order?: number;
  active?: boolean;
}

export interface SizeTier {
  label: string;
  min_sqft: number;
  /** null = open-ended ("and above"). */
  max_sqft: number | null;
  multiplier: number;
}

export interface CommercialSettings {
  walkthrough_threshold_sqft: number;
  estimate_range_pct: number;
  crew_coordination_factor: number;
  min_crew_size: number;
  max_crew_size: number;
  default_window_hours: number;
  default_cleaner_pay_pct: number;
  photo_zone_threshold_sqft: number;
  photo_zone_sqft: number;
  max_photo_zones: number;
  coi_warning_days: number;
}

export interface CommercialPricingConfig {
  facilityTypes: FacilityType[];
  scopeLevels: ScopeLevel[];
  sizeTiers: SizeTier[];
  settings: CommercialSettings;
}

/** Mirrors the app_settings row seeded by the migration. */
export const DEFAULT_COMMERCIAL_SETTINGS: CommercialSettings = {
  walkthrough_threshold_sqft: 5000,
  estimate_range_pct: 0.2,
  crew_coordination_factor: 0.75,
  min_crew_size: 1,
  max_crew_size: 12,
  default_window_hours: 4,
  default_cleaner_pay_pct: 40,
  photo_zone_threshold_sqft: 5000,
  photo_zone_sqft: 10000,
  max_photo_zones: 8,
  coi_warning_days: 30,
};

export const DEFAULT_FACILITY_TYPES: FacilityType[] = [
  { key: "office", label: "Office", base_rate_cents_per_sqft: 12, sort_order: 10 },
  { key: "warehouse", label: "Warehouse/Industrial", base_rate_cents_per_sqft: 7, sort_order: 20 },
  { key: "retail", label: "Retail", base_rate_cents_per_sqft: 11, sort_order: 30 },
  { key: "restaurant", label: "Restaurant", base_rate_cents_per_sqft: 20, sort_order: 40 },
  { key: "gym", label: "Gym/Fitness", base_rate_cents_per_sqft: 15, sort_order: 50 },
  { key: "medical", label: "Medical/Clinical", base_rate_cents_per_sqft: 22, sort_order: 60 },
  { key: "other", label: "Other", base_rate_cents_per_sqft: 12, sort_order: 99 },
];

export const DEFAULT_SCOPE_LEVELS: ScopeLevel[] = [
  {
    key: "light",
    label: "Light",
    multiplier: 0.8,
    summary: "Sweep/vacuum, trash, restrooms.",
    sqft_per_cleaner_hour: 3500,
    sort_order: 10,
  },
  {
    key: "standard",
    label: "Standard",
    multiplier: 1.0,
    summary: "Light + mopping, breakroom/kitchen, individual offices and rooms.",
    sqft_per_cleaner_hour: 2200,
    sort_order: 20,
  },
  {
    key: "detailed",
    label: "Detailed",
    multiplier: 1.35,
    summary: "Standard + scrubbing, high-touch sanitization, dusting, glass.",
    sqft_per_cleaner_hour: 1300,
    sort_order: 30,
  },
];

export const DEFAULT_SIZE_TIERS: SizeTier[] = [
  { label: "Under 1,000 sq ft", min_sqft: 0, max_sqft: 999, multiplier: 1.45 },
  { label: "1,000–2,499 sq ft", min_sqft: 1000, max_sqft: 2499, multiplier: 1.3 },
  { label: "2,500–4,999 sq ft", min_sqft: 2500, max_sqft: 4999, multiplier: 1.15 },
  { label: "5,000–9,999 sq ft", min_sqft: 5000, max_sqft: 9999, multiplier: 1.0 },
  { label: "10,000–19,999 sq ft", min_sqft: 10000, max_sqft: 19999, multiplier: 0.85 },
  { label: "20,000–34,999 sq ft", min_sqft: 20000, max_sqft: 34999, multiplier: 0.7 },
  { label: "35,000+ sq ft", min_sqft: 35000, max_sqft: null, multiplier: 0.6 },
];

export const DEFAULT_COMMERCIAL_CONFIG: CommercialPricingConfig = {
  facilityTypes: DEFAULT_FACILITY_TYPES,
  scopeLevels: DEFAULT_SCOPE_LEVELS,
  sizeTiers: DEFAULT_SIZE_TIERS,
  settings: DEFAULT_COMMERCIAL_SETTINGS,
};

// ─── Lookups ───────────────────────────────────────────────────────────────

export function findFacilityType(
  config: CommercialPricingConfig,
  key: string | null | undefined,
): FacilityType | null {
  const want = String(key || "").toLowerCase().trim();
  if (!want) return null;
  return config.facilityTypes.find((f) => f.key.toLowerCase() === want) || null;
}

export function findScopeLevel(
  config: CommercialPricingConfig,
  key: string | null | undefined,
): ScopeLevel | null {
  const want = String(key || "").toLowerCase().trim();
  if (!want) return null;
  return config.scopeLevels.find((s) => s.key.toLowerCase() === want) || null;
}

/**
 * The band a square footage falls into. Bands cannot overlap (the database
 * refuses it), so at most one matches; anything past the last band uses it,
 * because a 90,000 sqft facility is not less efficient than a 40,000 one.
 */
export function findSizeTier(
  config: CommercialPricingConfig,
  sqft: number,
): SizeTier | null {
  const n = Math.max(0, Math.round(Number(sqft) || 0));
  const sorted = [...config.sizeTiers].sort((a, b) => a.min_sqft - b.min_sqft);
  for (const tier of sorted) {
    if (n >= tier.min_sqft && (tier.max_sqft == null || n <= tier.max_sqft)) return tier;
  }
  return sorted.length ? sorted[sorted.length - 1] : null;
}

// ─── The quote ─────────────────────────────────────────────────────────────

export interface CommercialQuoteInput {
  sqft: number;
  facilityTypeKey: string;
  scopeLevel: string;
  /** Hours the crew actually has on site. Sizes the crew, not the price. */
  windowHours?: number | null;
}

export interface CommercialQuoteBreakdown {
  sqft: number;
  facility_type_key: string;
  facility_type_label: string;
  base_rate_cents_per_sqft: number;
  scope_level: string;
  scope_label: string;
  scope_multiplier: number;
  size_tier_label: string;
  size_tier_multiplier: number;
  effective_cents_per_sqft: number;
  formula_cents: number;
}

export interface CommercialQuote {
  ok: boolean;
  error?: string;
  /** What the formula says. Always present when ok — the anchor, always shown. */
  formulaCents: number;
  /** Whether that number may be quoted as a firm price. */
  requiresWalkthrough: boolean;
  walkthroughThresholdSqft: number;
  estimateLowCents: number;
  estimateHighCents: number;
  breakdown: CommercialQuoteBreakdown | null;
  crew: CrewRecommendation | null;
}

function roundCents(n: number): number {
  return Math.max(0, Math.round(n));
}

/**
 * The formula, and whether its answer is quotable.
 *
 * Below the threshold the number is a price a VA can give on the call. At or
 * above it, a facility has too many variables that only show up on site —
 * racking, dock areas, floor type, restroom count, existing condition — for
 * the number to be anything but a starting anchor, and getting it wrong at
 * that size is expensive in both directions. So the caller gets a range and
 * the booking gate demands a walkthrough.
 */
export function computeCommercialQuote(
  config: CommercialPricingConfig,
  input: CommercialQuoteInput,
): CommercialQuote {
  const settings = config.settings;
  const threshold = Math.max(0, Number(settings.walkthrough_threshold_sqft) || 0);
  const sqft = Math.max(0, Math.round(Number(input.sqft) || 0));

  const empty: CommercialQuote = {
    ok: false,
    formulaCents: 0,
    requiresWalkthrough: sqft >= threshold && sqft > 0,
    walkthroughThresholdSqft: threshold,
    estimateLowCents: 0,
    estimateHighCents: 0,
    breakdown: null,
    crew: null,
  };

  if (sqft <= 0) return { ...empty, error: "Square footage is required to price a commercial job." };

  const facility = findFacilityType(config, input.facilityTypeKey);
  if (!facility) return { ...empty, error: "Pick a facility type — it sets the base rate per square foot." };

  const scope = findScopeLevel(config, input.scopeLevel);
  if (!scope) return { ...empty, error: "Pick a scope level — Light, Standard, or Detailed." };

  const tier = findSizeTier(config, sqft);
  if (!tier) return { ...empty, error: "No size tier is configured for that square footage." };

  const effectiveRate = Number(facility.base_rate_cents_per_sqft) *
    Number(scope.multiplier) * Number(tier.multiplier);
  const formulaCents = roundCents(sqft * effectiveRate);

  const rangePct = Math.min(0.9, Math.max(0, Number(settings.estimate_range_pct) || 0));

  return {
    ok: true,
    formulaCents,
    requiresWalkthrough: sqft >= threshold,
    walkthroughThresholdSqft: threshold,
    estimateLowCents: roundCents(formulaCents * (1 - rangePct)),
    estimateHighCents: roundCents(formulaCents * (1 + rangePct)),
    breakdown: {
      sqft,
      facility_type_key: facility.key,
      facility_type_label: facility.label,
      base_rate_cents_per_sqft: Number(facility.base_rate_cents_per_sqft),
      scope_level: scope.key,
      scope_label: scope.label,
      scope_multiplier: Number(scope.multiplier),
      size_tier_label: tier.label,
      size_tier_multiplier: Number(tier.multiplier),
      effective_cents_per_sqft: Math.round(effectiveRate * 10000) / 10000,
      formula_cents: formulaCents,
    },
    crew: recommendCrewSize(config, {
      sqft,
      scopeLevel: scope.key,
      windowHours: input.windowHours,
    }),
  };
}

/** Whether a facility of this size can be auto-quoted at all. */
export function requiresWalkthrough(
  config: CommercialPricingConfig,
  sqft: number,
): boolean {
  const threshold = Math.max(0, Number(config.settings.walkthrough_threshold_sqft) || 0);
  return Math.max(0, Math.round(Number(sqft) || 0)) >= threshold;
}

// ─── Crew sizing ───────────────────────────────────────────────────────────

export interface CrewSizeInput {
  sqft: number;
  scopeLevel: string;
  /** Length of the service window in hours. */
  windowHours?: number | null;
}

export interface CrewRecommendation {
  crewSize: number;
  /** Solo labour-hours the scope represents at this square footage. */
  laborHours: number;
  /** Hours the recommended crew actually needs, coordination drag included. */
  projectedHours: number;
  windowHours: number;
  /** True when even the largest allowed crew cannot finish inside the window. */
  windowTooShort: boolean;
  rationale: string;
}

/**
 * Effective throughput of n cleaners, in solo-cleaner equivalents.
 *
 * Cleaners past the first are not fully additive: two people take roughly 60%
 * of solo time, not 50%, because they hand off, share equipment, and cover
 * ground twice at the seams. The coordination factor is how much of a solo
 * cleaner each extra body actually adds — the same effect the crew-size pay
 * brackets exist to compensate for.
 */
function crewThroughput(n: number, coordinationFactor: number): number {
  const f = Math.min(1, Math.max(0.1, Number(coordinationFactor) || 0.75));
  return 1 + (Math.max(1, n) - 1) * f;
}

/**
 * The smallest crew that finishes the scope inside the window.
 *
 * A 30,000 sqft warehouse cleaned in a four-hour overnight window needs a much
 * larger crew than the same space cleaned over a full night — which is the
 * whole reason a fixed 1–2 person residential crew model does not survive
 * contact with commercial work.
 */
export function recommendCrewSize(
  config: CommercialPricingConfig,
  input: CrewSizeInput,
): CrewRecommendation {
  const settings = config.settings;
  const scope = findScopeLevel(config, input.scopeLevel) ||
    findScopeLevel(config, "standard") ||
    DEFAULT_SCOPE_LEVELS[1];

  const sqft = Math.max(0, Math.round(Number(input.sqft) || 0));
  const perHour = Math.max(1, Number(scope.sqft_per_cleaner_hour) || 2200);
  const laborHours = sqft / perHour;

  const windowHours = Math.max(
    0.5,
    Number(input.windowHours) > 0
      ? Number(input.windowHours)
      : Number(settings.default_window_hours) || 4,
  );
  const minCrew = Math.max(1, Math.round(Number(settings.min_crew_size) || 1));
  const maxCrew = Math.max(minCrew, Math.round(Number(settings.max_crew_size) || 12));
  const coordination = Number(settings.crew_coordination_factor) || 0.75;

  let crewSize = minCrew;
  while (
    crewSize < maxCrew &&
    laborHours / crewThroughput(crewSize, coordination) > windowHours
  ) {
    crewSize += 1;
  }

  const projectedHours = laborHours / crewThroughput(crewSize, coordination);
  const windowTooShort = projectedHours > windowHours + 0.001;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const rationale = sqft <= 0
    ? "Enter square footage to size the crew."
    : `${sqft.toLocaleString()} sq ft at ${scope.label} depth is about ${round1(laborHours)} solo labour-hours. ` +
      `A crew of ${crewSize} covers it in roughly ${round1(projectedHours)}h against a ${round1(windowHours)}h window.` +
      (windowTooShort
        ? ` Even ${maxCrew} cleaners cannot finish in that window — lengthen it or split the scope.`
        : "");

  return {
    crewSize,
    laborHours: round1(laborHours),
    projectedHours: round1(projectedHours),
    windowHours: round1(windowHours),
    windowTooShort,
    rationale,
  };
}

/**
 * Hours between two "HH:MM" clock times, wrapping past midnight so an
 * overnight window (22:00 → 02:00) reads as four hours rather than minus
 * twenty.
 */
export function windowHoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const parse = (v: string | null | undefined): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v || "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
    return h + min / 60;
  };
  const a = parse(start);
  const b = parse(end);
  if (a == null || b == null) return null;
  const span = b > a ? b - a : b + 24 - a;
  return span > 0 ? Math.round(span * 100) / 100 : null;
}

// ─── Documentation zones ───────────────────────────────────────────────────

/**
 * Named documentation zones for a site — never invented at booking time.
 *
 * The walkthrough conductor (or an admin edit) names the sections. A site
 * below the zone threshold, or a large site that has not been mapped yet,
 * returns [] and keeps the existing single before/after pair. Generic
 * "Zone 1 / Zone 2" labels are not a map.
 */
export function photoZonesForSite(
  config: CommercialPricingConfig,
  _sqft: number,
  siteZones?: unknown,
): string[] {
  const max = Math.max(1, Math.round(Number(config.settings.max_photo_zones) || 8));
  if (!Array.isArray(siteZones)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of siteZones) {
    if (names.length >= max) break;
    let name = "";
    if (typeof entry === "string" || typeof entry === "number") {
      name = String(entry).replace(/\s+/g, " ").trim();
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      name = String(o.name ?? o.label ?? o.title ?? "").replace(/\s+/g, " ").trim();
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name.slice(0, 80));
  }
  return names;
}

/** Whether this square footage is large enough to require a named zone map. */
export function siteRequiresZones(
  config: CommercialPricingConfig,
  sqft: number,
): boolean {
  const n = Math.max(0, Math.round(Number(sqft) || 0));
  const independent = Number(config.settings.photo_zone_threshold_sqft);
  const walk = Number(config.settings.walkthrough_threshold_sqft);
  const threshold = Number.isFinite(independent) && independent > 0
    ? independent
    : (Number.isFinite(walk) && walk > 0 ? walk : 5000);
  return n > 0 && n >= threshold;
}

// ─── Formatting ────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return `$${(Math.max(0, Number(cents) || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatEstimateRange(quote: CommercialQuote): string {
  return `${formatCents(quote.estimateLowCents)} – ${formatCents(quote.estimateHighCents)}`;
}
