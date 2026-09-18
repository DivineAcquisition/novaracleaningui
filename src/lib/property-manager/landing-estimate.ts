// ─── Portfolio landing estimate (engine) ───────────────────────────────────
//
// Server/verify only. Lives apart from `landing.ts` so the public page can
// import copy, CTA rules, and formatters without pulling the standing-rate
// helper (or anything that imports the admin Supabase client) into the
// browser bundle. The numbers still come from `standingRatesAtZone` — the
// same residential engine the registry uses.

import { PM_SERVICE_TYPES, resolveVolumeDiscount, type PmServiceType } from "./pricing";
import {
  ESTIMATE_DISCLAIMER,
  expandEstimateUnits,
  portfolioCtaFor,
  type PortfolioEstimateInput,
  type PortfolioEstimateResult,
  type UnitEstimate,
} from "./landing";
import {
  servedPricingZones,
  standingRatesAtZone,
  type PmPricingContext,
  type StandingRateResult,
} from "./pricing-server";
import type { ZoneInfo } from "@/lib/dynamic-pricing";

export function emptyRange(): Record<PmServiceType, { minCents: number; maxCents: number }> {
  return {
    move_out: { minCents: 0, maxCents: 0 },
    move_in: { minCents: 0, maxCents: 0 },
    standard: { minCents: 0, maxCents: 0 },
  };
}

function pushCents(
  range: { minCents: number; maxCents: number },
  cents: number,
): { minCents: number; maxCents: number } {
  if (!(cents > 0)) return range;
  if (range.minCents <= 0) return { minCents: cents, maxCents: cents };
  return { minCents: Math.min(range.minCents, cents), maxCents: Math.max(range.maxCents, cents) };
}

/**
 * Run the residential standing-rate engine across a portfolio and produce
 * an estimated range. When a unit has a resolved zone, that zone is the
 * only one priced. When it doesn't (no ZIP yet), every served zone is
 * priced so the range is the engine's zone spread — not a made-up buffer.
 */
export function estimatePortfolioFromContext(
  ctx: PmPricingContext,
  input: PortfolioEstimateInput,
  opts: {
    zoneByIndex?: Array<ZoneInfo | null | undefined>;
    zoneServedByIndex?: Array<boolean | undefined>;
  } = {},
): PortfolioEstimateResult {
  const units = expandEstimateUnits(input);
  const unitCount = units.length;
  const discount = resolveVolumeDiscount(ctx.discounts, unitCount);
  const split = portfolioCtaFor(units, {
    flaggedAtypical: input.flaggedAtypical,
    bounds: ctx.bounds,
    zoneServedByIndex: opts.zoneServedByIndex,
  });

  const served = servedPricingZones(ctx.zones);
  const portfolioRange = emptyRange();
  const unitEstimates: UnitEstimate[] = [];
  let pricedAny = false;
  let engineFailed = false;

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const review = split.reviews[i];
    const perUnit = emptyRange();
    unitEstimates.push({
      index: i,
      label: unit.label || `Unit ${i + 1}`,
      sqft: unit.sqft,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      zipCode: unit.zipCode || null,
      review,
      range: perUnit,
    });
    if (review.needsReview) continue;

    const resolved = opts.zoneByIndex?.[i] || null;
    const zones: ZoneInfo[] = resolved ? [resolved] : served;
    if (zones.length === 0) {
      engineFailed = true;
      continue;
    }

    for (const zone of zones) {
      const priced: StandingRateResult = standingRatesAtZone(
        ctx,
        { sqft: unit.sqft, unitCount, zipCode: unit.zipCode, zoneDefaulted: !resolved },
        zone,
      );
      if (!priced.ok || !priced.rates) {
        engineFailed = true;
        continue;
      }
      pricedAny = true;
      for (const service of PM_SERVICE_TYPES) {
        const cents = priced.rates.standing[service];
        perUnit[service] = pushCents(perUnit[service], cents);
        portfolioRange[service] = pushCents(portfolioRange[service], cents);
      }
    }
  }

  if (unitCount === 0) {
    return {
      ok: false,
      cta: "book_call",
      estimate: true,
      disclaimer: ESTIMATE_DISCLAIMER,
      unitCount: 0,
      units,
      discount,
      ranges: [],
      unitEstimates: [],
      reasons: split.reasons,
      message: "Add at least one unit to see an estimate.",
    };
  }

  if (split.cta === "get_started" && !pricedAny) {
    return {
      ok: false,
      cta: "book_call",
      estimate: true,
      disclaimer: ESTIMATE_DISCLAIMER,
      unitCount,
      units,
      discount,
      ranges: [],
      unitEstimates,
      reasons: [
        ...split.reasons,
        {
          reason: "pricing_unavailable",
          message: "We couldn't reach the pricing tables for this estimate. Book a call and we'll price it.",
        },
      ],
      message: "We couldn't produce an estimate from the live pricing engine.",
    };
  }

  return {
    ok: true,
    cta: split.cta,
    estimate: true,
    disclaimer: ESTIMATE_DISCLAIMER,
    unitCount,
    units,
    discount,
    ranges: PM_SERVICE_TYPES.map((service) => ({
      service,
      minCents: portfolioRange[service].minCents,
      maxCents: portfolioRange[service].maxCents,
    })),
    unitEstimates,
    reasons: split.reasons,
    message: engineFailed && split.cta === "get_started"
      ? "Some units could not be priced; the range covers the ones that could."
      : undefined,
  };
}
