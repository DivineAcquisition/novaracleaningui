// ─── Offline verification of Urgent Hire behaviour (no network/DB) ───────────
//
// Locks the rules the feature is built around:
//   • pipeline eligibility (Screening-Passed+, not Active, never rejected)
//   • screening bar still requires photo ID + own vehicle
//   • radius is mileage copy, not an audience filter
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
  formatUrgentHireMileageLine,
  isBlockedFromUrgentHire,
  isDeclineRecommendation,
  isDeclinedPipelineStage,
  isUrgentHirePipelineStage,
  isActiveRosterStatus,
  parseUrgentHireSettings,
  payoutsReady,
  remainingUrgentHireSteps,
  screeningQualifiersPass,
  supplyChecklistValid,
  unfilledStillNeedsCoverage,
  urgentHireErrorMessage,
  urgentHirePayCents,
  URGENT_HIRE_DEFAULTS,
  URGENT_HIRE_ELIGIBLE_STAGES,
  URGENT_HIRE_EXCLUDED_STAGES,
} from "../src/lib/urgent-hire";
import { NEEDED_SUPPLY_IDS, SUPPLY_READY_PERCENT } from "../supabase/functions/_shared/urgent-hire.ts";

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

console.log("\nPremium rate + first-job-only:");
check("defaults", parseUrgentHireSettings({}), URGENT_HIRE_DEFAULTS);
check("45% of $200 is $90", urgentHirePayCents(20000, 45), 9000);
check(
  "first-job-only sentence",
  firstJobOnlySentence(true, 45),
  "This 45% rate applies to your first job only; standard tier rates apply after.",
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
check("in-radius SMS omits mileage", sms.includes("from the job."), false);

console.log("\nOut-of-radius mileage:");
check("in-radius mileage line is omitted", formatUrgentHireMileageLine(10, 25), null);
check("at-radius mileage line is omitted", formatUrgentHireMileageLine(25, 25), null);
check(
  "out-of-radius mileage line",
  formatUrgentHireMileageLine(42, 25),
  "About 42 miles from the job.",
);
check("unknown mileage is omitted", formatUrgentHireMileageLine(null, 25), null);
const smsFar = buildUrgentHireSms({
  serviceType: "Standard clean",
  dateLabel: "Tue, Sep 8",
  timeWindow: "8:00 AM – 12:00 PM",
  zone: "Takoma Park 20912",
  payPercent: 45,
  payDollars: "90.00",
  firstJobOnly: true,
  offerUrl: "https://contractor.novaracleaning.com/cleaner/urgent-hire/abc",
  needsChecklist: true,
  miles: 42,
  radiusMiles: 25,
});
check("out-of-radius SMS includes mileage", smsFar.includes("About 42 miles from the job."), true);
check("out-of-radius SMS still includes ack", smsFar.includes(APPLIED_IN_PAST_ACK), true);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll Urgent Hire checks passed.");
