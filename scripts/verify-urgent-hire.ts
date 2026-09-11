// ─── Offline verification of Urgent Hire behaviour (no network/DB) ───────────
//
// Locks the rules the feature is built around:
//   • pipeline eligibility (Screening-Passed+, not Active, never rejected)
//   • screening bar still requires photo ID + own vehicle
//   • radius is a 45–55 mile hard cap
//   • payout is job share + 70¢/mi, company take floored at 40%
//   • SMS always acknowledges they applied in the past
//   • supply checklist must be complete AND fresh before accept
//   • 45% is first-job-only copy + pay math
//   • remaining steps never include background check
//
//   Run:  npm run urgent-hire:verify

import { neededSupplyItems, scoreSupplyInventory } from "../src/lib/cleaner-supplies";
import {
  APPLIED_IN_PAST_ACK,
  buildUrgentHireSms,
  firstJobOnlySentence,
  formatUrgentHireMileagePayLine,
  isBlockedFromUrgentHire,
  isDeclineRecommendation,
  isDeclinedPipelineStage,
  isUrgentHirePipelineStage,
  isActiveRosterStatus,
  isWithinUrgentHireRadius,
  parseUrgentHireSettings,
  payoutsReady,
  remainingUrgentHireSteps,
  screeningQualifiersPass,
  supplyChecklistValid,
  unfilledStillNeedsCoverage,
  urgentHireErrorMessage,
  urgentHirePayCents,
  urgentHireTotalPayCents,
  URGENT_HIRE_COMPANY_PROFIT_FLOOR_PERCENT,
  URGENT_HIRE_DEFAULTS,
  URGENT_HIRE_ELIGIBLE_STAGES,
  URGENT_HIRE_EXCLUDED_STAGES,
  URGENT_HIRE_MILEAGE_RATE_CENTS,
  URGENT_HIRE_RADIUS_MAX,
  URGENT_HIRE_RADIUS_MIN,
} from "../src/lib/urgent-hire";
import { NEEDED_SUPPLY_IDS, SUPPLY_READY_PERCENT, URGENT_HIRE_DEFAULTS as DENO_URGENT_HIRE_DEFAULTS } from "../supabase/functions/_shared/urgent-hire.ts";

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

console.log("Pipeline eligibility:");
check("screening is eligible", isUrgentHirePipelineStage("screening"), true);
check("onboarding is eligible", isUrgentHirePipelineStage("onboarding"), true);
check("agreement_signed is eligible", isUrgentHirePipelineStage("agreement_signed"), true);
check("applicant (pre-screen) is not eligible", isUrgentHirePipelineStage("applicant"), false);
check("hold is not eligible", isUrgentHirePipelineStage("hold"), false);
check("active roster is not eligible", isUrgentHirePipelineStage("active"), false);
check("rejected is declined", isDeclinedPipelineStage("rejected"), true);
check("withdrawn is declined", isDeclinedPipelineStage("withdrawn"), true);
check("decline recommendation is a no", isDeclineRecommendation("decline"), true);
check("Decline casing is a no", isDeclineRecommendation("Decline"), true);
check("no hire is a no", isDeclineRecommendation("no_hire"), true);
check("advance recommendation is allowed", isDeclineRecommendation("advance"), false);
check(
  "rejected stage is blocked",
  isBlockedFromUrgentHire({ stage: "rejected", screeningRecommendation: "advance" }),
  true,
);
check(
  "uncleared rejection reason is blocked even in onboarding",
  isBlockedFromUrgentHire({ stage: "onboarding", rejectionReason: "Failed a hard qualifier" }),
  true,
);
check(
  "decline screening is blocked even in screening stage",
  isBlockedFromUrgentHire({ stage: "screening", screeningRecommendation: "decline" }),
  true,
);
check(
  "reinstated onboarding with advance is not blocked",
  isBlockedFromUrgentHire({
    stage: "onboarding",
    rejectionReason: null,
    screeningRecommendation: "advance",
  }),
  false,
);
check("active roster status is excluded", isActiveRosterStatus("Active"), true);
check("pending cleaner is not roster-active", isActiveRosterStatus("pending"), false);
check(
  "unfilled + still dispatching still needs coverage",
  unfilledStillNeedsCoverage({ broadcastStatus: "unfilled", jobStatus: "Dispatching" }),
  true,
);
check(
  "unfilled + confirmed another way is not a gap",
  unfilledStillNeedsCoverage({ broadcastStatus: "unfilled", jobStatus: "Confirmed" }),
  false,
);
check(
  "unfilled + completed is not a gap",
  unfilledStillNeedsCoverage({ broadcastStatus: "unfilled", jobStatus: "Completed" }),
  false,
);
check(
  "open broadcasts are not unfilled gaps",
  unfilledStillNeedsCoverage({ broadcastStatus: "open", jobStatus: "Broadcast" }),
  false,
);
check("eligible stages never include excluded ones",
  URGENT_HIRE_ELIGIBLE_STAGES.some((s) => (URGENT_HIRE_EXCLUDED_STAGES as readonly string[]).includes(s)),
  false,
);

console.log("\nError objects never stringify to [object Object]:");
check(
  "postgres-shaped object uses message",
  urgentHireErrorMessage({ message: "relation \"urgent_hire_broadcasts\" does not exist", code: "42P01" }),
  'relation "urgent_hire_broadcasts" does not exist (42P01)',
);
check("string passes through", urgentHireErrorMessage("Nobody in radius."), "Nobody in radius.");
check(
  "empty object falls back instead of [object Object]",
  urgentHireErrorMessage({}, "Urgent Hire failed."),
  "Urgent Hire failed.",
);
check(
  "literal [object Object] string falls back",
  urgentHireErrorMessage("[object Object]", "Urgent Hire failed."),
  "Urgent Hire failed.",
);

console.log("\nScreening bar (ID + vehicle; background check is not this bar):");
check(
  "pass photo ID + own car",
  screeningQualifiersPass({ qualifiers: { photo_id: "pass", own_car: "pass" } }),
  true,
);
check(
  "missing photo ID fails",
  screeningQualifiersPass({ qualifiers: { photo_id: "fail", own_car: "pass" } }),
  false,
);
check(
  "no car fails",
  screeningQualifiersPass({ qualifiers: { photo_id: "pass", own_car: "fail" } }),
  false,
);
check("pending ID is not a pass", screeningQualifiersPass({ qualifiers: { photo_id: "pending", own_car: "pass" } }), false);

console.log("\nSupply checklist gate:");
const inventory: Record<string, boolean> = {};
for (const item of neededSupplyItems()) inventory[item.id] = true;
const now = Date.parse("2026-09-08T12:00:00Z");
check(
  "complete + fresh is valid",
  supplyChecklistValid({
    inventory,
    submittedAt: "2026-09-01T12:00:00Z",
    freshnessDays: 30,
    nowMs: now,
  }).valid,
  true,
);
check(
  "complete but stale is not valid",
  supplyChecklistValid({
    inventory,
    submittedAt: "2026-07-01T12:00:00Z",
    freshnessDays: 30,
    nowMs: now,
  }).valid,
  false,
);
check(
  "missing inventory is not valid",
  supplyChecklistValid({ inventory: {}, submittedAt: "2026-09-01T12:00:00Z", freshnessDays: 30, nowMs: now }).valid,
  false,
);
check("Deno needed-supply ids match the catalog", [...NEEDED_SUPPLY_IDS].sort(), [...neededSupplyItems().map((i) => i.id)].sort());
check("Deno ready percent matches catalog", SUPPLY_READY_PERCENT, 70);
check("score ready at 70% of needed", scoreSupplyInventory(inventory).ready, true);

console.log("\nRemaining steps (no background check):");
check(
  "all gates clear → no remaining steps",
  remainingUrgentHireSteps({ checklistValid: true, agreementSigned: true, payoutsReady: true }),
  [],
);
check(
  "missing checklist is first",
  remainingUrgentHireSteps({ checklistValid: false, agreementSigned: true, payoutsReady: true }),
  ["supplies"],
);
check(
  "agreement + payout still required",
  remainingUrgentHireSteps({ checklistValid: true, agreementSigned: false, payoutsReady: false }),
  ["agreement", "payout"],
);
check(
  "payoutsReady accepts stripe account",
  payoutsReady({ stripe_account_id: "acct_123" }),
  true,
);

console.log("\nPremium rate + mileage payout:");
check("defaults", parseUrgentHireSettings({}), URGENT_HIRE_DEFAULTS);
check("Deno defaults match src", DENO_URGENT_HIRE_DEFAULTS, URGENT_HIRE_DEFAULTS);
check("saved 25mi radius clamps up to 45", parseUrgentHireSettings({ radius_miles: 25 }).radius_miles, URGENT_HIRE_RADIUS_MIN);
check("saved 80mi radius clamps down to 55", parseUrgentHireSettings({ radius_miles: 80 }).radius_miles, URGENT_HIRE_RADIUS_MAX);
check("45 miles is in range at max 45", isWithinUrgentHireRadius(45, 45), true);
check("45.1 miles is out at max 45", isWithinUrgentHireRadius(45.1, 45), false);
check("unknown miles are out", isWithinUrgentHireRadius(null, 45), false);
check("45% of $200 is $90", urgentHirePayCents(20000, 45), 9000);
check("mileage rate is 70¢", URGENT_HIRE_MILEAGE_RATE_CENTS, 70);
check("company floor is 40%", URGENT_HIRE_COMPANY_PROFIT_FLOOR_PERCENT, 40);
const payNear = urgentHireTotalPayCents({ jobValueCents: 20000, payPercent: 45, miles: 10 });
check("10 miles adds $7", payNear, {
  baseCents: 9000,
  mileageCents: 700,
  totalCents: 9700,
  companyPercent: 51.5,
  capped: false,
});
const payFar = urgentHireTotalPayCents({ jobValueCents: 20000, payPercent: 45, miles: 50 });
check("50 miles on $200 caps at 40% company", payFar, {
  baseCents: 9000,
  mileageCents: 3000,
  totalCents: 12000,
  companyPercent: 40,
  capped: true,
});
check(
  "first-job-only sentence",
  firstJobOnlySentence(true, 45),
  "This 45% job share applies to your first job only; standard tier rates apply after.",
);
const sms = buildUrgentHireSms({
  serviceType: "Standard clean",
  dateLabel: "Tue, Sep 8",
  timeWindow: "8:00 AM – 12:00 PM",
  zone: "Takoma Park 20912",
  payPercent: 45,
  payDollars: "90.00",
  firstJobOnly: true,
  offerUrl: "https://contractor.novaracleaning.com/cleaner/urgent-hire/abc",
  needsChecklist: true,
});
check("SMS names Urgent Hire", sms.includes("Urgent Hire"), true);
check("SMS states 45%", sms.includes("45%"), true);
check("SMS states first job only", sms.includes("first job only"), true);
check("SMS uses zone not a street", sms.includes("Takoma Park 20912") && !sms.includes("Lee Ave"), true);
check("SMS says finish remaining steps first", sms.includes("finishing remaining steps first"), true);
check("SMS always includes applied-in-past ack", sms.includes(APPLIED_IN_PAST_ACK), true);
check("no-mileage SMS has no includes-mileage line", sms.includes("Includes $"), false);

console.log("\nMileage included in payout:");
check(
  "mileage pay line",
  formatUrgentHireMileagePayLine(50, 3500),
  "Includes $35.00 mileage (50 miles).",
);
check("zero mileage pay line omitted", formatUrgentHireMileagePayLine(10, 0), null);
const smsMiles = buildUrgentHireSms({
  serviceType: "Standard clean",
  dateLabel: "Tue, Sep 8",
  timeWindow: "8:00 AM – 12:00 PM",
  zone: "Takoma Park 20912",
  payPercent: 45,
  payDollars: "125.00",
  firstJobOnly: true,
  offerUrl: "https://contractor.novaracleaning.com/cleaner/urgent-hire/abc",
  needsChecklist: true,
  miles: 50,
  mileageCents: 3500,
});
check("payout SMS shows total", smsMiles.includes("Your pay: $125.00"), true);
check("payout SMS includes mileage dollars", smsMiles.includes("Includes $35.00 mileage (50 miles)."), true);
check("payout SMS still includes ack", smsMiles.includes(APPLIED_IN_PAST_ACK), true);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Urgent Hire checks passed.");
