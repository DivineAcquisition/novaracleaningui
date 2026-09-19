// ─── Part Two reference bands — the ONE STR rate table ─────────────────────
//
// PURE module (client-safe, no Supabase import) so the landing page, the
// claim API, the rate schedule, and `npm run str-claim:verify` cannot
// disagree about what a turnover costs.
//
// Agreement §5.2 — the Company sets rates. A visitor never types or
// negotiates a rate; this table produces it and the host confirms it on
// Page 2. Agreement §5.3 — an introductory rate, when one is running, is
// disclosed together with the standard rate that replaces it.
//
// The 5+ BR band is deliberately NOT a number. Part Two marks that band
// "quote", so it routes to Book a Call rather than Claim This Rate.

export type BandKey = "studio_1br" | "2br" | "3br" | "4br" | "5plus";

export interface RateBand {
  key: BandKey;
  label: string;
  /** Inclusive bedroom range. `maxBedrooms: null` = open-ended top band. */
  minBedrooms: number;
  maxBedrooms: number | null;
  /** Base per-turnover rate in dollars. `null` = custom quote, not self-serve. */
  baseRate: number | null;
  /** Part Two prices these as add-ons to the base band. */
  linenAdd: number;
  restockAdd: number;
}

/**
 * Part Two, "How Rates Are Determined" — the reference bands.
 *
 * These dollar figures are the schedule the flow quotes from. Changing a
 * number here changes the landing quote, the claimed rate, and the signed
 * Property & Rate Schedule together, which is the point.
 */
export const RATE_BANDS: RateBand[] = [
  { key: "studio_1br", label: "Studio / 1 BR", minBedrooms: 0, maxBedrooms: 1, baseRate: 125, linenAdd: 25, restockAdd: 15 },
  { key: "2br", label: "2 BR", minBedrooms: 2, maxBedrooms: 2, baseRate: 155, linenAdd: 30, restockAdd: 15 },
  { key: "3br", label: "3 BR", minBedrooms: 3, maxBedrooms: 3, baseRate: 185, linenAdd: 35, restockAdd: 20 },
  { key: "4br", label: "4 BR", minBedrooms: 4, maxBedrooms: 4, baseRate: 225, linenAdd: 45, restockAdd: 20 },
  { key: "5plus", label: "5+ BR", minBedrooms: 5, maxBedrooms: null, baseRate: null, linenAdd: 0, restockAdd: 0 },
];

/** Bathrooms past this count on a band are a sign the property is atypical. */
export const MAX_TYPICAL_BATHROOMS = 4;

/** More properties than this in one self-serve claim goes to a call instead. */
export const MAX_SELF_SERVE_PROPERTIES = 8;

/** Agreement §5.2 — shown wherever a rate is displayed before signature. */
export const COMPANY_SETS_RATES_NOTICE =
  "Rates are set by Novara from the Property & Rate Schedule reference bands — " +
  "bedroom count, bathroom count, and whether linen and restocking are included. " +
  "You review and confirm this schedule when you sign; you do not set or " +
  "negotiate the rate here.";

/** Agreement §5.4 — a rate can move if the property's details change. */
export const RATE_CHANGE_NOTICE =
  "If a property's size, bedrooms, bathrooms, or included extras turn out to " +
  "differ from what's entered here, the rate is re-set under Section 5 before " +
  "the property becomes bookable.";

export const FIVE_PLUS_MESSAGE =
  "Part Two lists 5+ BR as a custom quote rather than a fixed band, so this " +
  "property is priced by a person rather than instantly.";

export const TOO_MANY_PROPERTIES_MESSAGE =
  `More than ${MAX_SELF_SERVE_PROPERTIES} properties at once is reviewed by a person ` +
  "rather than started self-serve.";

export const ATYPICAL_BATHROOMS_MESSAGE =
  `More than ${MAX_TYPICAL_BATHROOMS} bathrooms sits outside the standard reference ` +
  "bands, so this property is quoted by a person.";

// ─── Introductory rate (§5.3) ──────────────────────────────────────────────

export interface IntroRate {
  /** Percent off the standard band rate, 1–50. */
  percentOff: number;
  /** How long the introductory rate applies before the standard rate resumes. */
  periodLabel: string;
}

/**
 * Set to an IntroRate to run an introductory offer. §5.3 makes the "standard
 * rate applies automatically after" disclosure a document requirement, so the
 * disclosure is generated from this value rather than written as page copy.
 */
export const ACTIVE_INTRO_RATE: IntroRate | null = null;

export function introDisclosure(intro: IntroRate | null = ACTIVE_INTRO_RATE): string | null {
  if (!intro) return null;
  return (
    `Introductory rate: ${intro.percentOff}% off the standard per-turnover rate for ` +
    `${intro.periodLabel}. The standard rate shown applies automatically after the ` +
    "introductory period ends — no further notice and no action needed from you " +
    "(Agreement Section 5.3)."
  );
}

// ─── Band lookup + quote ───────────────────────────────────────────────────

export function bandForBedrooms(bedrooms: number | null | undefined): RateBand | null {
  if (bedrooms == null || !Number.isFinite(Number(bedrooms))) return null;
  const n = Math.max(0, Math.floor(Number(bedrooms)));
  return (
    RATE_BANDS.find(
      (b) => n >= b.minBedrooms && (b.maxBedrooms == null || n <= b.maxBedrooms),
    ) || null
  );
}

export interface QuoteInput {
  bedrooms: number | null;
  bathrooms?: number | null;
  linen?: boolean;
  restock?: boolean;
}

export interface PropertyQuote {
  band: RateBand | null;
  bandLabel: string;
  /** Standard per-turnover rate in dollars. null when the band is a custom quote. */
  standardRate: number | null;
  /** What's charged during an introductory period, when one is running. */
  introRate: number | null;
  baseRate: number | null;
  linenAdd: number;
  restockAdd: number;
  /** True when this property can be quoted and claimed instantly. */
  quotable: boolean;
  /** Why it isn't quotable, when it isn't. */
  reason: "five_plus" | "atypical_bathrooms" | "missing_bedrooms" | null;
  message: string | null;
}

/**
 * The single rate calculation. Base band + linen + restock, exactly as
 * Part Two builds it. Returns `quotable: false` for anything Part Two
 * designates a quote — the caller routes those to Book a Call.
 */
export function quoteProperty(
  input: QuoteInput,
  intro: IntroRate | null = ACTIVE_INTRO_RATE,
): PropertyQuote {
  const band = bandForBedrooms(input.bedrooms);

  const shell = (
    reason: PropertyQuote["reason"],
    message: string | null,
  ): PropertyQuote => ({
    band,
    bandLabel: band?.label || "—",
    standardRate: null,
    introRate: null,
    baseRate: band?.baseRate ?? null,
    linenAdd: 0,
    restockAdd: 0,
    quotable: false,
    reason,
    message,
  });

  if (!band) {
    return shell("missing_bedrooms", "Enter a bedroom count to see a rate.");
  }
  if (band.baseRate == null) {
    return shell("five_plus", FIVE_PLUS_MESSAGE);
  }
  const baths = input.bathrooms == null ? null : Number(input.bathrooms);
  if (baths != null && Number.isFinite(baths) && baths > MAX_TYPICAL_BATHROOMS) {
    return shell("atypical_bathrooms", ATYPICAL_BATHROOMS_MESSAGE);
  }

  const linenAdd = input.linen ? band.linenAdd : 0;
  const restockAdd = input.restock ? band.restockAdd : 0;
  const standardRate = band.baseRate + linenAdd + restockAdd;
  const introRate = intro
    ? Math.round(standardRate * (1 - intro.percentOff / 100))
    : null;

  return {
    band,
    bandLabel: band.label,
    standardRate,
    introRate,
    baseRate: band.baseRate,
    linenAdd,
    restockAdd,
    quotable: true,
    reason: null,
    message: null,
  };
}

/** How the quote was built, for the "traces to Part Two" line on the page. */
export function quoteBreakdown(quote: PropertyQuote): string {
  if (!quote.quotable || quote.standardRate == null || quote.baseRate == null) return "—";
  const parts = [`${quote.bandLabel} base $${quote.baseRate}`];
  if (quote.linenAdd > 0) parts.push(`linen +$${quote.linenAdd}`);
  if (quote.restockAdd > 0) parts.push(`restock +$${quote.restockAdd}`);
  return `${parts.join(" · ")} = $${quote.standardRate} per turnover`;
}

export function formatRate(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "—";
  return `$${Number(amount).toFixed(0)}`;
}
