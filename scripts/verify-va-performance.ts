// ─── Offline verification of the VA performance logic (no network/DB) ─────────
//
// Exercises the pure pieces so the behaviours that matter can be validated
// without touching Apploye, GHL, Airtable or Supabase:
//
//   • Tier 1 metrics can never arrive from the client
//   • an unverified signal produces NO flag (we don't compare against nothing)
//   • ceiling corroboration only fires when the report EXCEEDS the signal
//   • severity bands use the greater of pct-of-verified and the absolute
//   • a repeat inside the rolling window escalates to High
//   • rollups exclude unverified days instead of summing them as zero
//   • revenue per hour is null rather than a fake number when hours are unknown
//   • EOD compliance skips weekends and pre-start dates
//   • day windows land on the business timezone, including across DST
//
//   Run:  npm run va:verify

import { __test__pickDayTotal as pickDayTotal } from "../src/lib/apploye/client";
import {
  sanitizeSelfReported,
  sanitizeTaskNotes,
  tier2Fields,
  validateSubmission,
  visibleMetrics,
} from "../src/lib/va-performance/catalog";
import { evaluateDiscrepancies } from "../src/lib/va-performance/discrepancy";
import { complianceFor, revenuePerHour, rollUp } from "../src/lib/va-performance/reporting";
import { DEFAULT_THRESHOLDS } from "../src/lib/va-performance/settings";
import { dayWindow } from "../src/lib/va-performance/time";
import type { MetricValues } from "../src/lib/va-performance/metrics";
import type { StoredVerifiedDay } from "../src/lib/va-performance/verify";

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

const T = DEFAULT_THRESHOLDS;

// ─── Catalog: the client can only send what the catalog allows ───────────────

console.log("Catalog / payload sanitation:");

const tasks = ["outbound_calling", "commercial_outreach"];

check(
  "Tier 1 metric keys are discarded from a self-reported payload",
  sanitizeSelfReported(tasks, {
    calls_placed: 999, // Tier 1 — system-fed, must never come from the client
    hours_tracked: 12, // Tier 1
    quotes_from_calls: 4, // Tier 2 — allowed
  }),
  { quotes_from_calls: 4 },
);

check(
  "a Tier 2 key from an UNSELECTED task is discarded",
  sanitizeSelfReported(["outbound_calling"], { reactivation_attempts: 20, quotes_from_calls: 3 }),
  { quotes_from_calls: 3 },
);

check("negative numbers are rejected", sanitizeSelfReported(tasks, { quotes_from_calls: -5 }), {});

check(
  "a choice field only accepts values from its own vocabulary",
  sanitizeTaskNotes(tasks, { commercial_method: ["Call", "Telepathy"] }),
  { commercial_method: ["Call"] },
);

check(
  "hours is always visible, even with no tasks selected",
  visibleMetrics([]),
  ["hours_tracked"],
);

check(
  '"Other" cannot be submitted without a description',
  validateSubmission({ tasksSelected: ["other"], selfReported: {}, taskNotes: {} }).length,
  1,
);

check(
  '"Other" passes once described',
  validateSubmission({
    tasksSelected: ["other"],
    selfReported: {},
    taskNotes: { other_description: "Cleaned up the zone spreadsheet." },
  }).length,
  0,
);

check("no tasks selected is rejected", validateSubmission({ tasksSelected: [], selfReported: {}, taskNotes: {} }).length, 1);

// ─── Apploye per-day attribution ─────────────────────────────────────────────
//
// /timesheets returns ONE row per user for the WHOLE requested range, with
// `duration` totalled across every date in `dates` (verified against the live
// API: 167972s spanning 9 dates in a single row). Attributing that to one day
// would invent hours nobody worked, so anything but an exact single-day match
// must resolve to unverified.

console.log("\nApploye per-day attribution:");

check(
  "an exact single-day row is attributed (28829s -> 8.01h)",
  pickDayTotal({ user_id: "m1", duration: 28829, dates: ["2026-07-26"] }, "2026-07-26"),
  { memberId: "m1", date: "2026-07-26", hours: 8.01 },
);

check(
  "a multi-date row is REFUSED — its duration is a range total, not a day's",
  pickDayTotal(
    { user_id: "m1", duration: 167972, dates: ["2026-05-30", "2026-05-31", "2026-06-01"] },
    "2026-05-30",
  ),
  null,
);

check(
  "a row for a different day is refused",
  pickDayTotal({ user_id: "m1", duration: 3600, dates: ["2026-07-25"] }, "2026-07-26"),
  null,
);

check(
  "an empty dates array is refused",
  pickDayTotal({ user_id: "m1", duration: 3600, dates: [] }, "2026-07-26"),
  null,
);

check(
  "a bare string date (the shape the docs claim) still works",
  pickDayTotal({ user_id: "m1", duration: 1800, dates: "2026-07-26" }, "2026-07-26"),
  { memberId: "m1", date: "2026-07-26", hours: 0.5 },
);

check(
  "a row with no user id is refused",
  pickDayTotal({ duration: 3600, dates: ["2026-07-26"] }, "2026-07-26"),
  null,
);

// ─── Discrepancies ───────────────────────────────────────────────────────────

console.log("\nDiscrepancy detection:");

const evaluate = (
  selfReported: Record<string, number>,
  verified: MetricValues,
  repeatCounts: Record<string, number> = {},
  taskIds = tasks,
) => evaluateDiscrepancies({ tasksSelected: taskIds, selfReported, verified, repeatCounts, thresholds: T });

check(
  "an UNVERIFIED signal raises nothing — we never compare against nothing",
  evaluate({ quotes_from_calls: 50 }, { quotes_sent: null }),
  [],
);

check(
  "a matching number raises nothing",
  evaluate({ quotes_from_calls: 10 }, { quotes_sent: 10 }),
  [],
);

check(
  "a small variance stays under the base threshold (10 vs 12: abs 2 < 10)",
  evaluate({ quotes_from_calls: 12 }, { quotes_sent: 10 }),
  [],
);

// verified 10 → base threshold = max(20% of 10, 10) = 10. Variance 15 > 10 → flag.
// medium = max(4, 25) = 25 → not exceeded. So Low.
const low = evaluate({ quotes_from_calls: 25 }, { quotes_sent: 10 });
check("a material variance flags Low", low.map((f) => [f.metricKey, f.severity]), [
  ["quotes_from_calls", "low"],
]);
check("variance and % are reported", [low[0].variance, low[0].variancePct], [15, 150]);

// verified 100 → base max(20,10)=20, medium max(40,25)=40, high max(75,50)=75.
check(
  "variance of 50 on 100 is Medium",
  evaluate({ quotes_from_calls: 150 }, { quotes_sent: 100 }).map((f) => f.severity),
  ["medium"],
);
check(
  "variance of 100 on 100 is High",
  evaluate({ quotes_from_calls: 200 }, { quotes_sent: 100 }).map((f) => f.severity),
  ["high"],
);

check(
  "a DIRECT comparison flags an under-report too",
  evaluate({ quotes_from_calls: 0 }, { quotes_sent: 100 }).map((f) => f.severity),
  ["high"],
);

// businesses_contacted is a CEILING against calls + sms + commercial accounts.
check(
  "a CEILING signal ignores being under it — that's normal",
  evaluate({ businesses_contacted: 5 }, { calls_placed: 40, sms_sent: 10, commercial_accounts_touched: 0 }),
  [],
);
check(
  "a CEILING signal flags only when the report EXCEEDS observed activity",
  evaluate(
    { businesses_contacted: 200 },
    { calls_placed: 40, sms_sent: 10, commercial_accounts_touched: 0 },
  ).map((f) => [f.verified, f.severity]),
  [[50, "high"]],
);

check(
  "a ceiling with every metric unverified raises nothing",
  evaluate(
    { businesses_contacted: 200 },
    { calls_placed: null, sms_sent: null, commercial_accounts_touched: null },
  ),
  [],
);

check(
  "a ceiling sums only the metrics that ARE verified",
  evaluate({ businesses_contacted: 200 }, { calls_placed: 40, sms_sent: null, commercial_accounts_touched: null })
    .map((f) => f.verified),
  [40],
);

check(
  "a repeat inside the window escalates an otherwise-Low variance to High",
  evaluate({ quotes_from_calls: 25 }, { quotes_sent: 10 }, { quotes_from_calls: 2 }).map((f) => f.severity),
  ["high"],
);

check(
  "a Tier 2 field with no corroboration can never be flagged",
  evaluate({ jobs_dispatched: 9999 }, { bookings_created: 1 }, {}, ["dispatch"]),
  [],
);

check(
  "a blank Tier 2 answer is not a zero and raises nothing",
  evaluate({}, { quotes_sent: 100 }),
  [],
);

check(
  "every Tier 2 field on a task is evaluated",
  tier2Fields(["reactivation"]).map((f) => f.key),
  ["reactivation_attempts", "reactivation_rebooked"],
);

// ─── Rollups ─────────────────────────────────────────────────────────────────

console.log("\nRollups:");

const day = (workDate: string, values: MetricValues): StoredVerifiedDay => ({
  vaId: "va-1",
  workDate,
  values,
  provenance: {},
  sourceStatus: {},
  lastSyncedAt: "2026-07-27T12:00:00.000Z",
});

const week = [
  day("2026-07-20", { hours_tracked: 8, calls_placed: 30, revenue_booked_cents: 50_000 }),
  day("2026-07-21", { hours_tracked: 7.5, calls_placed: null, revenue_booked_cents: 25_000 }),
  day("2026-07-22", { hours_tracked: null, calls_placed: 20, revenue_booked_cents: null }),
];

const rolled = rollUp(week);
check("hours sum only the verified days", rolled.hours_tracked?.total, 15.5);
check("unverified days are counted, not summed", rolled.hours_tracked?.unverifiedDays, 1);
check("calls sum only the verified days", rolled.calls_placed?.total, 50);
check(
  "a metric with no verified day at all rolls up to null, never 0",
  rolled.sms_sent?.total,
  null,
);
check("median response is averaged, not summed", rollUp([
  day("2026-07-20", { median_response_seconds: 100 }),
  day("2026-07-21", { median_response_seconds: 200 }),
]).median_response_seconds?.total, 150);

console.log("\nRevenue per VA hour:");
check(
  "booked revenue ÷ verified hours",
  revenuePerHour(rolled).perHourCents,
  Math.round(75_000 / 15.5),
);
check(
  "collected revenue wins over booked when present",
  revenuePerHour(
    rollUp([day("2026-07-20", { hours_tracked: 10, revenue_booked_cents: 100_000, revenue_collected_cents: 60_000 })]),
  ).perHourCents,
  6_000,
);
check(
  "no verified hours → null, not a divide-by-zero or a fake number",
  revenuePerHour(rollUp([day("2026-07-20", { hours_tracked: null, revenue_booked_cents: 100_000 })])).perHourCents,
  null,
);
check("a partial window is labelled as such", revenuePerHour(rolled).partial, true);

// ─── EOD compliance ──────────────────────────────────────────────────────────

console.log("\nEOD compliance:");

const va = {
  id: "va-1",
  email: "va@novaracleaning.com",
  firstName: "Test",
  lastName: "VA",
  name: "Test VA",
  phone: null,
  status: "approved",
  performanceStatus: "active",
  payType: "hourly",
  rateCents: null,
  startDate: null,
  functionsAssigned: [],
  vaRole: null,
  apployeMemberId: null,
  ghlUserId: null,
  workspaceUserId: null,
  perfAirtableRecordId: null,
};

const submission = (workDate: string, late: boolean) => ({
  id: workDate,
  vaId: "va-1",
  workDate,
  status: "submitted" as const,
  tasksSelected: [],
  selfReported: {},
  taskNotes: {},
  blockers: null,
  priorities: null,
  wins: null,
  escalations: null,
  submittedAt: `${workDate}T22:00:00.000Z`,
  submittedLate: late,
  lockedAt: null,
  reviewedAt: null,
  reviewNote: null,
  updatedAt: `${workDate}T22:00:00.000Z`,
});

// 2026-07-20 Mon … 2026-07-26 Sun → 5 expected weekdays (Sat 25 / Sun 26 excluded).
const compliance = complianceFor(
  va,
  [submission("2026-07-20", false), submission("2026-07-21", true), submission("2026-07-24", false)],
  "2026-07-20",
  "2026-07-26",
  "2026-07-26",
);
check("weekends are not expected days", compliance.expectedDays, 5);
check("submitted days", compliance.submittedDays, 3);
check("late days are counted separately", compliance.lateDays, 1);
check("missed days are listed", compliance.missedDates, ["2026-07-22", "2026-07-23"]);
check("compliance %", compliance.compliancePct, 60);

check(
  "days before the VA started are never expected",
  complianceFor({ ...va, startDate: "2026-07-23" }, [], "2026-07-20", "2026-07-24", "2026-07-24")
    .expectedDays,
  2,
);

check(
  "future days in the window are not yet expected",
  complianceFor(va, [], "2026-07-20", "2026-07-31", "2026-07-22").expectedDays,
  3,
);

// ─── Timezone day windows ────────────────────────────────────────────────────

console.log("\nBusiness-timezone day windows:");

const summer = dayWindow("2026-07-21", "America/New_York");
check("EDT day starts at 04:00 UTC", summer.startIso, "2026-07-21T04:00:00.000Z");
check("EDT day ends at 04:00 UTC the next day", summer.endIso, "2026-07-22T04:00:00.000Z");

const winter = dayWindow("2026-01-21", "America/New_York");
check("EST day starts at 05:00 UTC", winter.startIso, "2026-01-21T05:00:00.000Z");

// 2026-03-08 is the US spring-forward date: the day is 23 hours long.
const dst = dayWindow("2026-03-08", "America/New_York");
check(
  "the spring-forward day is 23 hours long",
  (dst.end.getTime() - dst.start.getTime()) / 3600000,
  23,
);

console.log(
  failures === 0
    ? "\nAll VA performance checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
