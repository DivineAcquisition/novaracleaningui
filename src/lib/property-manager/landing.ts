// ─── Property-manager public landing: estimate + CTA split ─────────────────
//
// PURE module (client-safe). The /portfolio page is an acquisition front
// door, not a second pricing or onboarding system. Copy, calculator shape,
// and the typical/unusual CTA live here so the page, the APIs, and
// `npm run portfolio-landing:verify` cannot disagree. Engine math lives in
// `landing-estimate.ts` so this file never imports the admin client.
//
// Final standing rates are confirmed at onboarding once units are actually
// registered. Everything shown here is labeled as an estimate.

import {
  DEFAULT_AUTO_PRICE_BOUNDS,
  formatRate,
  reviewDecisionForUnit,
  type AutoPriceBounds,
  type PmServiceType,
  type ResolvedDiscount,
  type ReviewDecision,
  type UnitReviewReason,
} from "./pricing";

export const PORTFOLIO_PATH = "/portfolio";
export const PORTFOLIO_ORIGIN = "https://try.novaracleaning.com";
export const PORTFOLIO_URL = `${PORTFOLIO_ORIGIN}${PORTFOLIO_PATH}`;

export const ESTIMATE_DISCLAIMER =
  "This is an estimate, not a final standing rate. Rates are set by Novara " +
  "from each unit's size, bedroom count, and service zone once the unit is " +
  "registered at onboarding. A unit materially outside our normal residential " +
  "size range, or one you flag as non-standard, is priced by a person before " +
  "it becomes bookable.";

export const VALUE_STACK = [
  {
    key: "standing",
    title: "Standing rates per unit",
    body: "Set once at registration from the same residential engine we use everywhere else. No quote cycle every time a tenant turns over.",
  },
  {
    key: "invoice",
    title: "One consolidated invoice",
    body: "One bill per period across the whole portfolio, itemized by unit — not a separate invoice per job.",
  },
  {
    key: "photos",
    title: "Before/after photo documentation",
    body: "Every turnover is photographed. Useful when you're deciding a tenant deposit, not reconstructing what the unit looked like.",
  },
  {
    key: "volume",
    title: "Portfolio pricing",
    body: "The more units on the registry, the better the rate. The discount is already in the standing number you book against.",
  },
  {
    key: "contact",
    title: "One point of contact",
    body: "One crew relationship and one portal. Not juggling individual cleaners across properties.",
  },
] as const;

export type PortfolioMode = "uniform" | "mixed";
export type PortfolioCta = "get_started" | "book_call";

export interface EstimateUnitInput {
  label?: string | null;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zipCode?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  flaggedNonStandard?: boolean;
}

export interface PortfolioEstimateInput {
  mode: PortfolioMode;
  /** Used in uniform mode. Mixed mode takes `units.length`. */
  unitCount?: number;
  average?: {
    sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
  };
  units?: EstimateUnitInput[];
  /** Optional ZIP applied to units that don't have their own. Tightens the range. */
  portfolioZip?: string | null;
  /** The manager told us the portfolio is atypical. Same flag the registry already honors. */
  flaggedAtypical?: boolean;
}

export interface ServiceRange {
  service: PmServiceType;
  minCents: number;
  maxCents: number;
}

export interface UnitEstimate {
  index: number;
  label: string;
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zipCode: string | null;
  review: ReviewDecision;
  range: Record<PmServiceType, { minCents: number; maxCents: number }>;
}

export interface PortfolioEstimateResult {
  ok: boolean;
  cta: PortfolioCta;
  estimate: boolean;
  disclaimer: string;
  unitCount: number;
  units: EstimateUnitInput[];
  discount: ResolvedDiscount;
  ranges: ServiceRange[];
  unitEstimates: UnitEstimate[];
  reasons: Array<{ reason: UnitReviewReason | "flagged_atypical"; message: string }>;
  message?: string;
}

const ATYPICAL_MESSAGE =
  "You flagged this portfolio as atypical, so a person reviews it rather than auto-starting onboarding.";

export const MAX_LANDING_UNITS = 80;

function clipZip(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bedsOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Turn the calculator into the list of units the engine will price.
 * Uniform clones the average across `unitCount`. Mixed keeps the rows as typed.
 */
export function expandEstimateUnits(input: PortfolioEstimateInput): EstimateUnitInput[] {
  const zip = clipZip(input.portfolioZip);
  if (input.mode === "mixed") {
    return (input.units || []).slice(0, MAX_LANDING_UNITS).map((u, i) => ({
      label: String(u.label || "").trim().slice(0, 80) || `Unit ${i + 1}`,
      sqft: numOrNull(u.sqft),
      bedrooms: bedsOrNull(u.bedrooms),
      bathrooms: bedsOrNull(u.bathrooms),
      zipCode: clipZip(u.zipCode) || zip,
      address: String(u.address || "").trim().slice(0, 300) || null,
      city: String(u.city || "").trim().slice(0, 120) || null,
      state: String(u.state || "").trim().slice(0, 40) || null,
      flaggedNonStandard: !!u.flaggedNonStandard || !!input.flaggedAtypical,
    }));
  }

  const count = Math.min(MAX_LANDING_UNITS, Math.max(0, Math.floor(Number(input.unitCount) || 0)));
  const avg: NonNullable<PortfolioEstimateInput["average"]> = input.average || {
    sqft: null,
    bedrooms: null,
    bathrooms: null,
  };
  const sqft = numOrNull(avg.sqft);
  const bedrooms = bedsOrNull(avg.bedrooms);
  const bathrooms = bedsOrNull(avg.bathrooms);
  const out: EstimateUnitInput[] = [];
  for (let i = 0; i < count; i++) {
    const typed: EstimateUnitInput = (input.units || [])[i] || {
      sqft: null,
      bedrooms: null,
      bathrooms: null,
    };
    out.push({
      label: String(typed.label || "").trim().slice(0, 80) || `Unit ${i + 1}`,
      sqft: numOrNull(typed.sqft) ?? sqft,
      bedrooms: bedsOrNull(typed.bedrooms) ?? bedrooms,
      bathrooms: bedsOrNull(typed.bathrooms) ?? bathrooms,
      zipCode: clipZip(typed.zipCode) || zip,
      address: String(typed.address || "").trim().slice(0, 300) || null,
      city: String(typed.city || "").trim().slice(0, 120) || null,
      state: String(typed.state || "").trim().slice(0, 40) || null,
      flaggedNonStandard: !!typed.flaggedNonStandard || !!input.flaggedAtypical,
    });
  }
  return out;
}

/**
 * Typical portfolios go straight into onboarding. Unusual ones book a call.
 * "Unusual" is the registry's definition — not a unit-count cutoff invented
 * for this page.
 */
export function portfolioCtaFor(
  units: EstimateUnitInput[],
  opts: {
    flaggedAtypical?: boolean;
    bounds?: AutoPriceBounds;
    zoneServedByIndex?: Array<boolean | undefined>;
  } = {},
): { cta: PortfolioCta; reviews: ReviewDecision[]; reasons: PortfolioEstimateResult["reasons"] } {
  const reasons: PortfolioEstimateResult["reasons"] = [];
  if (opts.flaggedAtypical) {
    reasons.push({ reason: "flagged_atypical", message: ATYPICAL_MESSAGE });
  }

  const reviews = units.map((unit, i) =>
    reviewDecisionForUnit({
      sqft: unit.sqft,
      bedrooms: unit.bedrooms,
      flaggedNonStandard: unit.flaggedNonStandard,
      zoneServed: opts.zoneServedByIndex?.[i],
      bounds: opts.bounds || DEFAULT_AUTO_PRICE_BOUNDS,
    }),
  );

  for (const review of reviews) {
    if (review.needsReview && review.reason) {
      if (!reasons.some((r) => r.reason === review.reason)) {
        reasons.push({ reason: review.reason, message: review.message || "This unit needs review." });
      }
    }
  }

  if (units.length === 0) {
    return { cta: "book_call", reviews, reasons };
  }

  const unusual = opts.flaggedAtypical || reviews.some((r) => r.needsReview);
  return { cta: unusual ? "book_call" : "get_started", reviews, reasons };
}

export function formatRange(minCents: number, maxCents: number): string {
  if (!(minCents > 0) && !(maxCents > 0)) return "—";
  if (minCents === maxCents || !(maxCents > minCents)) return formatRate(minCents || maxCents);
  return `${formatRate(minCents)}–${formatRate(maxCents)}`;
}

export function formatServiceRange(range: ServiceRange | undefined): string {
  if (!range) return "—";
  return formatRange(range.minCents, range.maxCents);
}
