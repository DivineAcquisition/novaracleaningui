// Offline verification of the Property Manager relationship type (no network/DB).
//
//   • units price off the RESIDENTIAL engine, never the commercial formula
//   • the portfolio discount comes out of margin — cleaner pay is computed
//     off the full pre-discount value of every job, discounted or not
//   • only genuinely unusual units route to a human; typical ones auto-price
//   • three onboarding pages, fixed order, signature gates Pages 2 and 3
//   • invoiced is the default and needs no card; auto-pay needs one
//   • billing periods tile without gaps, and lines read unit-first
//
//   Run:  npm run property-manager:verify

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_AUTO_PRICE_BOUNDS,
  DEFAULT_VOLUME_DISCOUNTS,
  PM_SERVICE_TYPES,
  applyVolumeDiscount,
  bandForSqft,
  engineServiceType,
  formatRate,
  payBasisCents,
  resolveVolumeDiscount,
  reviewDecisionForUnit,
  standingFromList,
} from "../src/lib/property-manager/pricing";
import {
  billingReady,
  derivePmOnboardingProgress,
  registryReady,
  sessionIsStalled,
} from "../src/lib/property-manager/onboarding/progress";
import {
  AGREEMENT_CLAUSES,
  BINDING_ACKNOWLEDGMENTS,
  PM_BILLING_OPTIONS,
} from "../src/lib/property-manager/onboarding/agreement";
import {
  dueDateFor,
  lineDescription,
  periodFor,
} from "../src/lib/property-manager/billing";
import { jobValueForPay } from "../src/lib/pulse-check/jobs";

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

// ─── Pricing basis ─────────────────────────────────────────────────────────

console.log("Priced off the residential engine, not the commercial formula:");
check("move-out maps to the residential Move-In/Move-Out service", engineServiceType("move_out"), "moveInOut");
check("move-in maps to the same residential service", engineServiceType("move_in"), "moveInOut");
check("standard maps to the residential standard service", engineServiceType("standard"), "standard");
check("a 980 sqft apartment lands in a residential band", bandForSqft(980) !== null, true);
check("a 9,000 sqft property has no published band", bandForSqft(9000), null);
check("three service types, no scope tiers", PM_SERVICE_TYPES, ["move_out", "move_in", "standard"]);

// ─── Volume discount is a margin decision ──────────────────────────────────

console.log("\nPortfolio volume discount:");
const tiers = DEFAULT_VOLUME_DISCOUNTS;
check("1 unit sits at 0%", resolveVolumeDiscount(tiers, 1).percent, 0);
check("4 units still sit at 0%", resolveVolumeDiscount(tiers, 4).percent, 0);
check("5 units reach the first tier", resolveVolumeDiscount(tiers, 5).percent, 5);
check("12 units take the 10+ tier, not the 20+ one", resolveVolumeDiscount(tiers, 12).percent, 8);
check("120 units stay at the top tier", resolveVolumeDiscount(tiers, 120).percent, 15);
check("the next tier is reported so the portal can say so", resolveVolumeDiscount(tiers, 12).unitsToNextTier, 8);
check("disabling the config zeroes the discount without losing tiers", resolveVolumeDiscount({ ...tiers, enabled: false }, 50).percent, 0);
check("8% off $350.00 is $322.00", applyVolumeDiscount(350_00, 8), 322_00);
check("0% leaves the list price untouched", applyVolumeDiscount(350_00, 0), 350_00);
check(
  "the whole rate set discounts together",
  standingFromList({ move_out: 350_00, move_in: 350_00, standard: 200_00 }, 8),
  { move_out: 322_00, move_in: 322_00, standard: 184_00 },
);

console.log("\nCleaner pay comes off the FULL pre-discount value:");
const listCents = 350_00;
const whatTheyPay = applyVolumeDiscount(listCents, 12);
check("the manager is invoiced the discounted rate", whatTheyPay, 308_00);
check("pay is still calculated from the full $350.00", payBasisCents({ listPriceCents: listCents }), 350_00);
check("the discount never touches the pay basis", payBasisCents({ listPriceCents: listCents }) > whatTheyPay, true);
check(
  "an approved scope adjustment raises the pay basis",
  payBasisCents({ listPriceCents: listCents, scopeAdjustmentCents: 90_00 }),
  440_00,
);
check(
  "a goodwill reduction to the customer never pulls pay down",
  payBasisCents({ listPriceCents: listCents, scopeAdjustmentCents: -90_00 }),
  350_00,
);

// The SQL generated column and the TypeScript helper must agree, or the
// invoice and the payout disagree about the same job.
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260910222015_property_manager_portfolio.sql"),
  "utf8",
).replace(/\s+/g, " ");
check(
  "the stored pay_basis_cents column matches payBasisCents()",
  migration.includes("list_price_cents + GREATEST(scope_adjustment_cents, 0)"),
  true,
);

// The booking's pay basis is what every payout path actually reads, so the
// rule has to hold there and not only in the property-manager module.
console.log("\nThe payout path reads the pre-discount basis, not the charge:");
check(
  "an ordinary booking still pays off the customer charge",
  jobValueForPay({ final_charge_cents: 280_00 }),
  280_00,
);
check(
  "a discounted turnover pays off its stored pay basis",
  jobValueForPay({ final_charge_cents: 308_00, pay_basis_cents: 350_00 }),
  350_00,
);
check(
  "a scope-adjusted turnover pays off basis plus the approved delta",
  jobValueForPay({ final_charge_cents: 398_00, pay_basis_cents: 440_00 }),
  440_00,
);
check(
  "a re-clean still overrides everything — unpaid corrective work is prohibited",
  jobValueForPay({ is_reclean: true, reclean_assessed_value_cents: 200_00, pay_basis_cents: 350_00, final_charge_cents: 0 }),
  200_00,
);
check(
  "a zero basis falls through rather than paying nothing",
  jobValueForPay({ pay_basis_cents: 0, final_charge_cents: 280_00 }),
  280_00,
);

// The Deno edge functions run their own copy of this function. If the two
// drift, the portal and the payout disagree about the same job.
const denoPayBasis = readFileSync(
  join(process.cwd(), "supabase/functions/_shared/reclean.ts"),
  "utf8",
);
check(
  "the edge-function copy of jobValueForPay honours pay_basis_cents too",
  /const explicit = Math\.round\(Number\(booking\.pay_basis_cents\) \|\| 0\);\s*\n\s*if \(explicit > 0\) return explicit;/.test(
    denoPayBasis,
  ),
  true,
);

// ─── What routes to a human ────────────────────────────────────────────────

console.log("\nOnly genuinely unusual units route for review:");
const typical = { sqft: 980, bedrooms: 2, zoneServed: true };
check("a 2BR apartment auto-prices", reviewDecisionForUnit(typical).needsReview, false);
check("a 3BR townhouse auto-prices", reviewDecisionForUnit({ sqft: 1800, bedrooms: 3, zoneServed: true }).needsReview, false);
check(
  "a unit materially over the size bands routes",
  reviewDecisionForUnit({ sqft: 6200, bedrooms: 4, zoneServed: true }).reason,
  "outside_size_bands",
);
check(
  "a unit under the minimum size routes",
  reviewDecisionForUnit({ sqft: 120, bedrooms: 1, zoneServed: true }).reason,
  "outside_size_bands",
);
check("a unit with no size routes", reviewDecisionForUnit({ sqft: null }).reason, "missing_size");
check(
  "more bedrooms than the bands describe routes",
  reviewDecisionForUnit({ sqft: 2400, bedrooms: 9, zoneServed: true }).reason,
  "too_many_bedrooms",
);
check(
  "a manager-flagged unit routes even when it looks typical",
  reviewDecisionForUnit({ ...typical, flaggedNonStandard: true }).reason,
  "flagged_non_standard",
);
check(
  "an unserved address routes rather than guessing a zone",
  reviewDecisionForUnit({ ...typical, zoneServed: false }).reason,
  "zone_not_served",
);
check("the size band ceiling is 5,000 sqft", DEFAULT_AUTO_PRICE_BOUNDS.reviewMaxSqft, 5000);

// ─── Onboarding: three pages, fixed order ──────────────────────────────────

console.log("\nOnboarding step order and the signature gate:");
const units = ["u1", "u2"];
const unsigned = derivePmOnboardingProgress({
  signed: false,
  snapshotUnitIds: units,
  decisions: [
    { unitId: "u1", decision: "confirmed" },
    { unitId: "u2", decision: "confirmed" },
  ],
  billingMethod: "invoiced",
  billingConfirmed: true,
  paymentMethodOnFile: true,
  portalReady: true,
});
check("unsigned stays on legal even when every later fact exists", unsigned.current_step, "legal");
check("unsigned is not complete", unsigned.complete, false);
check("unsigned registry_ready is gated off", unsigned.registry_ready, false);
check("unsigned billing_ready is gated off", unsigned.billing_ready, false);

const signedOnly = derivePmOnboardingProgress({
  signed: true,
  snapshotUnitIds: units,
  decisions: [],
  billingMethod: null,
  billingConfirmed: false,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("signing opens the registry page", signedOnly.current_step, "registry");
check("the legal step reads done after signing", signedOnly.steps[0].done, true);
check("the registry step is not done until every unit is decided", signedOnly.steps[1].done, false);

console.log("\nA flag is a decision, not a blocker:");
check("an undecided unit holds the page", registryReady(units, [{ unitId: "u1", decision: "confirmed" }]), false);
check(
  "a flagged unit counts as decided",
  registryReady(units, [
    { unitId: "u1", decision: "confirmed" },
    { unitId: "u2", decision: "flagged" },
  ]),
  true,
);
check("an empty registry is never ready", registryReady([], []), false);
const withFlag = derivePmOnboardingProgress({
  signed: true,
  snapshotUnitIds: units,
  decisions: [
    { unitId: "u1", decision: "confirmed" },
    { unitId: "u2", decision: "flagged" },
  ],
  billingMethod: null,
  billingConfirmed: false,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("flagging one unit still advances to billing", withFlag.current_step, "billing");

console.log("\nBilling: invoiced is the default and needs no card:");
check("invoiced is ready on confirmation alone", billingReady({ billingMethod: "invoiced", billingConfirmed: true, paymentMethodOnFile: false }), true);
check("auto-pay needs a card actually on file", billingReady({ billingMethod: "auto_pay", billingConfirmed: true, paymentMethodOnFile: false }), false);
check("auto-pay is ready once the card lands", billingReady({ billingMethod: "auto_pay", billingConfirmed: true, paymentMethodOnFile: true }), true);
check("nothing is ready before the choice is confirmed", billingReady({ billingMethod: "invoiced", billingConfirmed: false, paymentMethodOnFile: true }), false);
check("Invoiced is the recommended option", PM_BILLING_OPTIONS.invoiced.recommended, true);
check("Auto-Pay is offered but not recommended", PM_BILLING_OPTIONS.auto_pay.recommended, false);

const billedNoPortal = derivePmOnboardingProgress({
  signed: true,
  snapshotUnitIds: units,
  decisions: units.map((unitId) => ({ unitId, decision: "confirmed" as const })),
  billingMethod: "invoiced",
  billingConfirmed: true,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("Page 3 is not done until the portal exists too", billedNoPortal.steps[2].done, false);
check("and the session is not complete", billedNoPortal.complete, false);

const finished = derivePmOnboardingProgress({
  signed: true,
  snapshotUnitIds: units,
  decisions: units.map((unitId) => ({ unitId, decision: "confirmed" as const })),
  billingMethod: "invoiced",
  billingConfirmed: true,
  paymentMethodOnFile: false,
  portalReady: true,
});
check("billing plus portal finishes the session", finished.current_step, "done");
check("a finished session is complete", finished.complete, true);
check("exactly three pages", finished.steps.length, 3);

console.log("\nStalled sessions:");
const hourAgo = new Date(Date.now() - 3600_000).toISOString();
const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
check("an unsent session is never stalled", sessionIsStalled({ status: "active", sentAt: null, complete: false, lastActivityAt: weekAgo, stalledAfterHours: 72 }), false);
check("a completed session is never stalled", sessionIsStalled({ status: "active", sentAt: weekAgo, complete: true, lastActivityAt: weekAgo, stalledAfterHours: 72 }), false);
check("recent activity is not stalled", sessionIsStalled({ status: "active", sentAt: weekAgo, complete: false, lastActivityAt: hourAgo, stalledAfterHours: 72 }), false);
check("a week of silence is stalled", sessionIsStalled({ status: "active", sentAt: weekAgo, complete: false, lastActivityAt: weekAgo, stalledAfterHours: 72 }), true);

// ─── The agreement ─────────────────────────────────────────────────────────

console.log("\nThe services agreement says what the system does:");
const clauseText = AGREEMENT_CLAUSES.map(([h, b]) => `${h} ${b}`).join(" ");
check("three binding acknowledgments", BINDING_ACKNOWLEDGMENTS.map((a) => a.key), [
  "non_circumvention",
  "chargebacks",
  "arbitration",
]);
check("the discount is stated as margin-funded", clauseText.includes("funded entirely from the Company's margin"), true);
check("it says the discount does not reduce personnel pay", clauseText.includes("does not reduce what the Company pays the personnel"), true);
check("billing is one consolidated invoice, itemized by unit", clauseText.includes("itemized by Unit"), true);
check("the needed-by date is a hard completion deadline", clauseText.includes("hard completion"), true);
check("a scope adjustment does not re-price the unit", clauseText.includes("standing rate is not changed by a scope adjustment"), true);
check("the manager confirms rather than negotiates a rate", clauseText.includes("does not set, negotiate, or edit a rate"), true);

// ─── Consolidated billing periods ──────────────────────────────────────────

console.log("\nBilling periods tile without gaps or overlaps:");
check("monthly runs the calendar month", periodFor("monthly", "2026-08-14"), {
  start: "2026-08-01",
  end: "2026-08-31",
  label: "August 2026",
});
check("February is handled by the calendar, not by arithmetic", periodFor("monthly", "2028-02-10").end, "2028-02-29");
const w1 = periodFor("weekly", "2026-08-05");
const w2 = periodFor("weekly", "2026-08-13");
check("a weekly period is seven days", w1.start === "2026-08-03" && w1.end === "2026-08-09", true);
check("the next weekly period starts the day after the last ends", w2.start, "2026-08-10");
check("asking twice inside one period gives the same period", periodFor("weekly", "2026-08-09").start, w1.start);
const b1 = periodFor("biweekly", "2026-08-05");
check("a biweekly period is fourteen days", b1, {
  start: "2026-08-03",
  end: "2026-08-16",
  label: "Aug 3 – Aug 16",
});
check("the next biweekly period starts the day after", periodFor("biweekly", "2026-08-20").start, "2026-08-17");
check("every period starts on a Monday, whatever day we ask on", [w1.start, b1.start].map((d) => new Date(`${d}T12:00:00Z`).getUTCDay()), [1, 1]);
check("net 15 is fifteen days after the period closes", dueDateFor("2026-08-31", "net_15"), "2026-09-15");
check("net 30 likewise", dueDateFor("2026-08-31", "net_30"), "2026-09-30");
check("on receipt is due the day the period closes", dueDateFor("2026-08-31", "on_receipt"), "2026-08-31");
check("an unknown term falls back to net 15", dueDateFor("2026-08-31", "whenever"), "2026-09-15");

console.log("\nInvoice lines read unit-first:");
const unitLine = { unitId: "u1", unitLabel: "Adams St 2B", address: "118 Adams St", turnovers: [], subtotalCents: 0 };
check(
  "a normal line names the unit before the service",
  lineDescription(unitLine, {
    turnoverId: "t1",
    serviceType: "move_out",
    serviceLabel: "Move-Out",
    servicedOn: "2026-08-14",
    amountCents: 322_00,
    scopeAdjustmentCents: 0,
  }),
  "Adams St 2B — Move-Out · Aug 14",
);
check(
  "a scope-adjusted line says so rather than silently costing more",
  lineDescription(unitLine, {
    turnoverId: "t2",
    serviceType: "move_out",
    serviceLabel: "Move-Out",
    servicedOn: "2026-08-20",
    amountCents: 412_00,
    scopeAdjustmentCents: 90_00,
  }).includes("includes approved scope adjustment"),
  true,
);
check("rates render without trailing cents when they are round", formatRate(322_00), "$322");
check("and with cents when they are not", formatRate(322_50), "$322.50");

console.log("\nAdmin ops can create a portfolio and register units:");
const adminRoute = readFileSync(
  join(process.cwd(), "src/app/api/partner-admin/property-manager/route.ts"),
  "utf8",
);
check("create_account is a first-class admin action", adminRoute.includes('action === "create_account"'), true);
check(
  "add_unit registers through the standing-rate engine",
  adminRoute.includes('action === "add_unit"') && adminRoute.includes("registerUnit"),
  true,
);
const hub = readFileSync(join(process.cwd(), "src/views/admin/CommercialHub.tsx"), "utf8");
check(
  "Commercial hub has a Portfolio workspace",
  hub.includes('"portfolio"') && hub.includes("PropertyManagerAdmin"),
  true,
);
const commsTemplate = readFileSync(
  join(process.cwd(), "supabase/migrations/20260910222310_property_manager_comms_template_and_grants.sql"),
  "utf8",
);
check(
  "onboarding link template is seeded in repo SQL",
  commsTemplate.includes("property_manager_onboarding_link"),
  true,
);

console.log(
  failures === 0
    ? "\nAll property-manager checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
