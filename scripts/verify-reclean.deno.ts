// Policy tests for Spotless Guarantee re-clean handling.
//
// Runs under Deno from the repo root:
//   npm run reclean:verify
import {
  assessedRecleanValueCents,
  countsTowardQualityScore,
  countsTowardReliability,
  customerChargeCents,
  intakeCreatesRecleanRequest,
  isInsideGuaranteeWindow,
  jobValueForPay,
  mergeRecleanSettings,
  namedAreasFromText,
  qualityHitApplies,
  recleanRequestColumns,
  recleanSourceForIntake,
} from "../supabase/functions/_shared/reclean.ts";
import { FOCUSED_SAME_DAY_DEFAULTS } from "../supabase/functions/_shared/focused-same-day.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}
function assertThrows(fn: () => unknown, msg: string) {
  try {
    fn();
    failed++;
    console.error("FAIL:", msg, "(did not throw)");
  } catch {
    console.log("ok  ", msg);
  }
}

// Pay basis: reclean uses assessed value, never the $0 customer charge.
assert(jobValueForPay({
  is_reclean: true,
  reclean_assessed_value_cents: 13000,
  final_charge_cents: 0,
  total_estimate_cents: 0,
}) === 13000, "jobValueForPay uses assessed value on a re-clean");

assertThrows(
  () => jobValueForPay({ is_reclean: true, reclean_assessed_value_cents: 0, final_charge_cents: 0 }),
  "jobValueForPay throws on unpaid re-clean (assessed 0)",
);
assertThrows(
  () => jobValueForPay({ is_reclean: true, reclean_assessed_value_cents: null, final_charge_cents: 25000 }),
  "jobValueForPay throws even if original-style charge columns are populated",
);

assert(jobValueForPay({
  is_reclean: false,
  final_charge_cents: 25000,
  total_estimate_cents: 20000,
}) === 25000, "normal jobs still use final_charge_cents");

assert(customerChargeCents({ is_reclean: true, reclean_assessed_value_cents: 13000, final_charge_cents: 0 }) === 0,
  "customer is never charged for a re-clean");
assert(customerChargeCents({ is_reclean: false, final_charge_cents: 25000 }) === 25000,
  "customer charge on a normal job is unchanged");

// Targeted re-clean is priced like Focused Clean (kitchen $65 default).
const kitchen = assessedRecleanValueCents({
  scope: "targeted",
  areas: ["kitchen"],
  originalChargeCents: 28000,
  focusedSettings: FOCUSED_SAME_DAY_DEFAULTS,
});
assert(kitchen === 6500, `targeted kitchen prices at focused rate (got ${kitchen})`);

const full = assessedRecleanValueCents({
  scope: "full",
  areas: [],
  originalChargeCents: 28000,
});
assert(full === 28000, "full re-service uses original job value");

assert(assessedRecleanValueCents({
  scope: "targeted",
  areas: [],
  originalChargeCents: 28000,
}) === 0, "targeted with no areas is 0 (caller must refuse — unpaid work is prohibited)");

// Classification → Score
assert(qualityHitApplies("quality_miss") === true, "quality_miss applies a Score hit");
assert(qualityHitApplies("scope_confusion") === false, "scope_confusion applies no Score hit");
assert(qualityHitApplies("not_supported") === false, "not_supported applies no Score hit");
assert(qualityHitApplies("pending") === false, "pending classification applies no Score hit");
assert(qualityHitApplies(null) === false, "null classification applies no Score hit");

assert(countsTowardQualityScore({ issue_type: "complaint", reclean_status: "none" }) === true,
  "ordinary complaint still counts toward quality");
assert(countsTowardQualityScore({ issue_type: "reclean", reclean_status: "requested", reclean_classification: "pending" }) === false,
  "pending re-clean request does not hit Score");
assert(countsTowardQualityScore({ issue_type: "complaint", reclean_status: "approved", reclean_classification: "scope_confusion" }) === false,
  "scope-confusion re-clean does not hit Score");
assert(countsTowardQualityScore({ issue_type: "complaint", reclean_status: "approved", reclean_classification: "quality_miss" }) === true,
  "quality-miss re-clean does hit Score");
assert(countsTowardQualityScore({ issue_type: "addon" }) === false, "addon rows are documentation, not failures");
assert(countsTowardQualityScore({ issue_type: "site_finding" }) === false, "site findings are documentation, not failures");

assert(countsTowardReliability({ reliability_neutral: true }) === false,
  "declining a re-clean offer is not a reliability event");
assert(countsTowardReliability({ reliability_neutral: false }) === true,
  "ordinary offers still count toward reliability");

// Intake paths
assert(intakeCreatesRecleanRequest({ issueType: "reclean", reportedVia: "va" }) === true, "explicit reclean type requests");
assert(intakeCreatesRecleanRequest({ issueType: "complaint", reportedVia: "va" }) === true, "VA-logged complaint requests");
assert(intakeCreatesRecleanRequest({ issueType: "quality_flag", reportedVia: "va" }) === true, "internal QC flag requests");
assert(intakeCreatesRecleanRequest({ issueType: "complaint", reportedVia: "customer" }) === true, "review-gating 1–3★ requests");
assert(intakeCreatesRecleanRequest({ issueType: "damage", reportedVia: "va" }) === false, "damage does not auto-request");
assert(intakeCreatesRecleanRequest({ issueType: "damage", reportedVia: "va", requestReclean: true }) === true, "explicit requestReclean overrides");
assert(intakeCreatesRecleanRequest({ issueType: "complaint", reportedVia: "va", requestReclean: false }) === false, "explicit false suppresses");

assert(recleanSourceForIntake({ issueType: "complaint", reportedVia: "customer" }) === "review_gating", "feedback source");
assert(recleanSourceForIntake({ issueType: "quality_flag", reportedVia: "va" }) === "internal_qc", "internal QC source");
assert(recleanSourceForIntake({ issueType: "complaint", reportedVia: "va" }) === "va_complaint", "VA complaint source");

// Guarantee window
const now = new Date("2026-08-21T18:00:00Z");
assert(isInsideGuaranteeWindow({
  completedAt: "2026-08-21T12:00:00Z",
  windowHours: 48,
  now,
}) === true, "inside 48h of completion");
assert(isInsideGuaranteeWindow({
  completedAt: "2026-08-18T12:00:00Z",
  windowHours: 48,
  now,
}) === false, "outside 48h of completion still creates a case (window false)");

const cols = recleanRequestColumns({
  completedAt: "2026-08-21T12:00:00Z",
  serviceDate: "2026-08-21",
  windowHours: 48,
  now,
});
assert(cols.reclean_status === "requested", "intake stamps reclean_status=requested");
assert(cols.reclean_classification === "pending", "intake classification starts pending");
assert(cols.reclean_inside_window === true, "window flag stamped on the QC case");

const settings = mergeRecleanSettings({ guarantee_window_hours: 24 });
assert(settings.guarantee_window_hours === 24, "admin can tighten the window");
assert(mergeRecleanSettings({}).guarantee_window_hours === 48, "default window is 48 hours");

assert(namedAreasFromText("the kitchen and bathroom were missed").includes("kitchen"), "named areas from complaint text");
assert(namedAreasFromText("the kitchen and bathroom were missed").includes("bathroom"), "bathroom extracted");

const jessie = namedAreasFromText(
  "Kitchen work did not include fan blades\nAreas of kitchen floor not mopped or cleaned\nLiving room floor not cleaned",
);
assert(jessie.includes("kitchen") && jessie.includes("living"),
  `NVC-0065 complaint names kitchen+living for targeted pay (got ${jessie.join(",")})`);
assert(assessedRecleanValueCents({
  scope: "targeted",
  areas: jessie,
  originalChargeCents: 52300,
  focusedSettings: FOCUSED_SAME_DAY_DEFAULTS,
}) === 13000, "NVC-0065 kitchen+living assesses at $130");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  // deno-lint-ignore no-explicit-any
  const exit = (globalThis as any).Deno?.exit || ((code: number) => { (globalThis as any).process?.exit(code); });
  exit(1);
}
console.log("\nAll re-clean policy assertions passed.");
