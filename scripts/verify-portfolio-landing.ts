// Offline verification of the public PM landing page.
//
//   • /portfolio is public on try.novaracleaning.com — no login, no VSL gate
//   • the estimate uses the residential standing-rate engine, not a side table
//   • typical vs unusual is reviewDecisionForUnit, not a new unit-count cutoff
//   • Get Started mints the existing onboarding session with units carried forward
//   • unusual portfolios book a call instead of auto-onboarding
//   • the estimate is labeled non-final
//
//   Run:  npm run portfolio-landing:verify

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeQuote, type DynamicPricingConfig, type ZoneInfo } from "../src/lib/dynamic-pricing";
import {
  DEFAULT_AUTO_PRICE_BOUNDS,
  DEFAULT_VOLUME_DISCOUNTS,
  engineServiceType,
  resolveVolumeDiscount,
  reviewDecisionForUnit,
} from "../src/lib/property-manager/pricing";
import {
  ESTIMATE_DISCLAIMER,
  expandEstimateUnits,
  formatRange,
  portfolioCtaFor,
} from "../src/lib/property-manager/landing";
import { estimatePortfolioFromContext } from "../src/lib/property-manager/landing-estimate";
import { standingRatesAtZone, type PmPricingContext } from "../src/lib/property-manager/pricing-server";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const ROOT = process.cwd();
const snap = JSON.parse(
  readFileSync(join(ROOT, "docs/admin-workspace/_data/pricing-snapshot.json"), "utf8"),
) as {
  config_version: number;
  config: DynamicPricingConfig;
  zones: ZoneInfo[];
};

const ctx: PmPricingContext = {
  config: snap.config,
  configVersion: snap.config_version,
  zones: snap.zones,
  payRates: { soloFoundationPercent: 37, crewFoundationPercent: 40 },
  discounts: DEFAULT_VOLUME_DISCOUNTS,
  bounds: DEFAULT_AUTO_PRICE_BOUNDS,
  condition: "standard",
};

const zoneB = snap.zones.find((z) => z.code === "B") as ZoneInfo;

console.log("Typical vs unusual uses the registry's reviewDecisionForUnit:");
const typical8 = expandEstimateUnits({
  mode: "uniform",
  unitCount: 8,
  average: { sqft: 1200, bedrooms: 2, bathrooms: 1 },
});
check("8 standard 2BR units expand to 8 rows", typical8.length, 8);
check("each cloned unit keeps 1200 sqft", typical8.every((u) => u.sqft === 1200), true);
check("each cloned unit keeps 2 bedrooms", typical8.every((u) => u.bedrooms === 2), true);
check(
  "8 standard 2BR units are typical — Get Started",
  portfolioCtaFor(typical8).cta,
  "get_started",
);
check(
  "a 9,000 sqft house is unusual — Book a Call",
  portfolioCtaFor([{ label: "Estate", sqft: 9000, bedrooms: 6, bathrooms: 5 }]).cta,
  "book_call",
);
check(
  "6 bedrooms is unusual — Book a Call",
  portfolioCtaFor([{ label: "Big", sqft: 2800, bedrooms: 6, bathrooms: 4 }]).cta,
  "book_call",
);
check(
  "flagged atypical is unusual even when sizes are ordinary",
  portfolioCtaFor(typical8, { flaggedAtypical: true }).cta,
  "book_call",
);
check(
  "missing size is unusual",
  portfolioCtaFor([{ label: "Unknown", sqft: null, bedrooms: 2, bathrooms: 1 }]).cta,
  "book_call",
);
check(
  "the landing does not invent a unit-count cutoff: 50 typical 2BRs still Get Started",
  portfolioCtaFor(
    expandEstimateUnits({ mode: "uniform", unitCount: 50, average: { sqft: 1200, bedrooms: 2, bathrooms: 1 } }),
  ).cta,
  "get_started",
);
check(
  "reviewDecisionForUnit agrees that 1200/2BR is typical",
  reviewDecisionForUnit({ sqft: 1200, bedrooms: 2 }).needsReview,
  false,
);

console.log("\nEstimate uses the residential standing-rate engine:");
const engine = standingRatesAtZone(ctx, { sqft: 1200, unitCount: 8 }, zoneB);
check("engine prices a 1200 sqft unit", !!engine.ok && (engine.rates?.list.move_out || 0) > 0, true);

const quoteMoveOut = computeQuote(
  ctx.config,
  zoneB,
  {
    serviceType: engineServiceType("move_out"),
    homeSizeId: "1000_1500",
    focused: null,
    condition: "standard",
    addOns: [],
    sameDay: false,
    membershipPlan: "none",
  },
  { mode: "off", multiplier: 1, reasons: [] },
  ctx.payRates,
);
const quoteStandard = computeQuote(
  ctx.config,
  zoneB,
  {
    serviceType: engineServiceType("standard"),
    homeSizeId: "1000_1500",
    focused: null,
    condition: "standard",
    addOns: [],
    sameDay: false,
    membershipPlan: "none",
  },
  { mode: "off", multiplier: 1, reasons: [] },
  ctx.payRates,
);
check("Move-Out list matches computeQuote for that unit", engine.rates?.list.move_out, quoteMoveOut.totalCents);
check("Move-In list matches Move-Out (same residential service)", engine.rates?.list.move_in, quoteMoveOut.totalCents);
check("Standard list matches computeQuote", engine.rates?.list.standard, quoteStandard.totalCents);
check("8 units sit in the 5% portfolio tier", resolveVolumeDiscount(DEFAULT_VOLUME_DISCOUNTS, 8).percent, 5);
check(
  "standing Move-Out is the list with the 5% portfolio discount",
  engine.rates?.standing.move_out,
  Math.round((quoteMoveOut.totalCents || 0) * 0.95),
);

const estimated = estimatePortfolioFromContext(ctx, {
  mode: "uniform",
  unitCount: 8,
  average: { sqft: 1200, bedrooms: 2, bathrooms: 1 },
});
check("8 × 2BR estimate is Get Started", estimated.cta, "get_started");
check("8 × 2BR estimate is labeled an estimate", estimated.estimate, true);
check("disclaimer is the non-final standing-rate language", estimated.disclaimer.includes("not a final standing rate"), true);
check("volume tier is Portfolio 5+", estimated.discount.label, "Portfolio 5+");

const zoneA = snap.zones.find((z) => z.code === "A") as ZoneInfo;
const zoneC = snap.zones.find((z) => z.code === "C") as ZoneInfo;
const atA = standingRatesAtZone(ctx, { sqft: 1200, unitCount: 8 }, zoneA);
const atC = standingRatesAtZone(ctx, { sqft: 1200, unitCount: 8 }, zoneC);
const moveOutRange = estimated.ranges.find((r) => r.service === "move_out");
check(
  "no-ZIP range low edge is the cheapest served zone (engine, not a buffer)",
  moveOutRange?.minCents,
  Math.min(atA.rates?.standing.move_out || 0, engine.rates?.standing.move_out || 0, atC.rates?.standing.move_out || 0),
);
check(
  "no-ZIP range high edge is the dearest served zone",
  moveOutRange?.maxCents,
  Math.max(atA.rates?.standing.move_out || 0, engine.rates?.standing.move_out || 0, atC.rates?.standing.move_out || 0),
);
check(
  "a single-zone estimate collapses to that zone's standing rate",
  estimatePortfolioFromContext(
    ctx,
    { mode: "uniform", unitCount: 8, average: { sqft: 1200, bedrooms: 2, bathrooms: 1 } },
    { zoneByIndex: Array(8).fill(zoneB) },
  ).ranges.find((r) => r.service === "move_out")?.minCents,
  engine.rates?.standing.move_out,
);

const unusualEst = estimatePortfolioFromContext(ctx, {
  mode: "uniform",
  unitCount: 2,
  average: { sqft: 9000, bedrooms: 6, bathrooms: 5 },
});
check("unusual estimate routes to Book a Call", unusualEst.cta, "book_call");
check("a 9,000 sqft unit is outside_size_bands", unusualEst.reasons.some((r) => r.reason === "outside_size_bands"), true);

console.log("\nCopy and wiring:");
check("range formatting uses an en-dash for a spread", formatRange(30000, 40000).includes("–"), true);
check("disclaimer constant mentions onboarding registration", ESTIMATE_DISCLAIMER.includes("registered at onboarding"), true);

const files: Record<string, string> = {
  middleware: readFileSync(join(ROOT, "src/middleware.ts"), "utf8"),
  page: readFileSync(join(ROOT, "src/app/portfolio/page.tsx"), "utf8"),
  view: readFileSync(join(ROOT, "src/views/portfolio/PortfolioLanding.tsx"), "utf8"),
  vsl: readFileSync(join(ROOT, "src/components/portfolio/PortfolioVsl.tsx"), "utf8"),
  estimateApi: readFileSync(join(ROOT, "src/app/api/portfolio/estimate/route.ts"), "utf8"),
  startApi: readFileSync(join(ROOT, "src/app/api/portfolio/start/route.ts"), "utf8"),
  callApi: readFileSync(join(ROOT, "src/app/api/portfolio/call/route.ts"), "utf8"),
  landingServer: readFileSync(join(ROOT, "src/lib/property-manager/landing-server.ts"), "utf8"),
  pricingServer: readFileSync(join(ROOT, "src/lib/property-manager/pricing-server.ts"), "utf8"),
};

check("middleware owns /portfolio on try.*", files.middleware.includes('["/portfolio", "try"]'), true);
check("the page is public (no requireAdmin / no login gate)", !/requireAdmin|useAuth|Sign In required/.test(files.page + files.view), true);
check("VSL plays with no email gate", files.vsl.includes("no email gate") && files.vsl.includes("Playing immediately"), true);
check("estimate API uses the landing estimator", files.estimateApi.includes("estimateLandingPortfolio"), true);
check("estimator calls standingRatesAtZone", files.pricingServer.includes("export function standingRatesAtZone"), true);
check("computeStandingRates delegates to standingRatesAtZone", files.pricingServer.includes("return standingRatesAtZone("), true);
check("Get Started calls startPmOnboardingSession", files.landingServer.includes("startPmOnboardingSession"), true);
check("Get Started registers units through registerUnit", files.landingServer.includes("registerUnit"), true);
check("unusual path does not mint onboarding", files.callApi.includes("bookCallPortfolio") && !files.callApi.includes("startPmOnboardingSession"), true);
check("the page labels the number as an estimate", files.view.includes("not a final standing rate"), true);
check("Get Started carries units into onboarding", files.view.includes("Units carrying into the registry"), true);
check("footer restates Get Started and Book a Call", files.view.includes("Ready to stop re-quoting") && files.view.includes("Book a Call"), true);
check(
  "the public page does not import the admin client",
  !files.view.includes("landing-server") && !files.view.includes("getAdminSupabase") && !files.page.includes("getAdminSupabase"),
  true,
);

console.log(
  failures === 0
    ? "\nAll portfolio-landing checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
