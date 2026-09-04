// Offline verification of the contractor pulse-check cycle (no network/DB).
//
//   • idle predicate (active + approved + available, ignoring declined/lost rows)
//   • eligibility reuses zone/capacity scoring, then hard-applies days + cutoffs
//   • form outcomes never write roster status or scores
//   • no-response after expiry, unless they claimed a job
//   • taken-job copy is a message, not an error
//   • schedule: cycle interval vs follow-up vs token TTL
//
//   Run:  npm run pulse:verify

import {
  assignmentCountsAsWork,
  isEligibleForPulseJob,
  passesHardCutoffs,
  passesPreferredDays,
  qualifiesForPulseCheck,
  toMinutes,
  zipInServiceZone,
} from "../src/lib/pulse-check/eligibility";
import {
  availabilityPatch,
  claimTakenMessage,
  normalizePulseDraft,
  outcomeFromAnswers,
  PULSE_FORBIDDEN_CLEANER_FIELDS,
  pulseDraftComplete,
  staleOutcome,
} from "../src/lib/pulse-check/answers";
import {
  cycleIsDue,
  parsePulseCheckSettings,
  pulseCheckLink,
} from "../src/lib/pulse-check/settings";
import { jobValueForPay, serviceTypeLabel, zoneLabel } from "../src/lib/pulse-check/jobs";
import { scoreCleanerForJob } from "../src/lib/dispatch-scoring";

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

console.log("Idle predicate:");
check(
  "active approved available with no recent work qualifies",
  qualifiesForPulseCheck({
    cleaner: { status: "active", approved: true, available_for_bookings: true },
    recentAssignmentStatuses: [],
  }),
  true,
);
check(
  "a confirmed assignment in the window disqualifies",
  qualifiesForPulseCheck({
    cleaner: { status: "active", approved: true, available_for_bookings: true },
    recentAssignmentStatuses: ["Confirmed"],
  }),
  false,
);
check(
  "declined / expired / broadcast_lost do not count as work",
  qualifiesForPulseCheck({
    cleaner: { status: "active", approved: true, available_for_bookings: true },
    recentAssignmentStatuses: ["Declined", "Expired", "Broadcast_Lost", "Withdrawn"],
  }),
  true,
);
check(
  "suspended contractors are skipped",
  qualifiesForPulseCheck({
    cleaner: { status: "suspended", approved: true, available_for_bookings: true },
    recentAssignmentStatuses: [],
  }),
  false,
);
check("offered still counts as an assignment", assignmentCountsAsWork("Offered"), true);
check("broadcast_lost does not", assignmentCountsAsWork("Broadcast_Lost"), false);

console.log("\nEligibility (reuse scoring + hard availability):");
const nearby = {
  home_lat: 39.0,
  home_lng: -77.0,
  max_travel_miles: 25,
  preferred_work_days: ["Mon", "Tue", "Wed"],
  constraints: { no_work_after: "3pm", no_work_before: "9am" },
  upcoming_jobs_count: 0,
};
check(
  "too far is ineligible",
  isEligibleForPulseJob(nearby, {
    lat: 39.5,
    lng: -77.0,
    weekday: "Mon",
    timeSlot: "9:00 AM - 3:00 PM",
  }).ok,
  false,
);
check(
  "preferred-day miss is a hard no on this page (not the 0.9 soft penalty)",
  isEligibleForPulseJob(nearby, {
    lat: 39.01,
    lng: -77.01,
    weekday: "Sat",
    timeSlot: "9:00 AM - 3:00 PM",
  }).reason,
  "outside_preferred_days",
);
check(
  "a 4–8pm window fails a 3pm cutoff",
  isEligibleForPulseJob(nearby, {
    lat: 39.01,
    lng: -77.01,
    weekday: "Mon",
    timeSlot: "16-20",
  }).reason,
  "outside_hard_cutoff",
);
check(
  "Mon 9–3 in-zone is eligible",
  isEligibleForPulseJob(nearby, {
    lat: 39.01,
    lng: -77.01,
    weekday: "Mon",
    timeSlot: "9:00 AM - 3:00 PM",
  }).ok,
  true,
);
check(
  "empty preferred days allow any weekday",
  passesPreferredDays([], "Sun"),
  true,
);
check("3pm cutoff is 15:00", toMinutes("3pm"), 15 * 60);
check(
  "job ending at 16:00 fails 3pm cutoff",
  passesHardCutoffs({ noWorkAfter: "3pm", window: { start: 12 * 60, end: 16 * 60 } }),
  false,
);
check(
  "zip fallback matches service_zip_codes",
  zipInServiceZone("20814", { service_zip_codes: ["20814", "20815"], home_zip: "00000" }),
  true,
);
check(
  "scoreCleanerForJob still treats preferred-day miss as available (soft)",
  scoreCleanerForJob(nearby, { lat: 39.01, lng: -77.01, weekday: "Sat" }).available,
  true,
);

console.log("\nForm outcomes:");
check(
  "still active + able closes as completed",
  outcomeFromAnswers(
    normalizePulseDraft({
      status: "still_active",
      ability: "able",
      preferredWorkDays: ["Mon"],
    }),
  ),
  "completed",
);
check(
  "step away flags review without treating it as a roster change",
  outcomeFromAnswers(normalizePulseDraft({ status: "step_away", ability: "able" })),
  "needs_review",
);
check(
  "not sure flags review",
  outcomeFromAnswers(normalizePulseDraft({ status: "not_sure", ability: "able" })),
  "needs_review",
);
check(
  "blocked ability flags review",
  outcomeFromAnswers(
    normalizePulseDraft({ status: "still_active", ability: "blocked", abilityNote: "surgery" }),
  ),
  "needs_review",
);
check(
  "blocked without a note is incomplete",
  pulseDraftComplete(normalizePulseDraft({ status: "still_active", ability: "blocked" })),
  false,
);
check(
  "availability patch never includes status / scores",
  PULSE_FORBIDDEN_CLEANER_FIELDS.some((k) => k in availabilityPatch(
    normalizePulseDraft({ preferredWorkDays: ["Mon"], noWorkAfter: "3pm" }),
    {},
  )),
  false,
);
check(
  "silence after expiry is no_response",
  staleOutcome({ submitted: false, claimedCount: 0 }),
  "no_response",
);
check(
  "a claimed job without a form submit is still a completed outcome",
  staleOutcome({ submitted: false, claimedCount: 1 }),
  "completed",
);

console.log("\nClaim / pay / location:");
check(
  "lost race is a clear message, not an error payload",
  claimTakenMessage("taken").includes("removed from your list"),
  true,
);
check(
  "pay basis prefers final_charge_cents",
  jobValueForPay({ final_charge_cents: 26500, total_estimate_cents: 20000 }),
  26500,
);
check(
  "reclean pay uses assessed value, never $0",
  jobValueForPay({ is_reclean: true, reclean_assessed_value_cents: 18000, final_charge_cents: 0 }),
  18000,
);
check("zone omits the street address", zoneLabel({ city: "Bethesda", state: "MD", zip: "20814" }).includes("Bethesda"), true);
check("zone omits street", zoneLabel({ city: "Bethesda", state: "MD", zip: "20814" }).includes("Street"), false);
check("move-in label", serviceTypeLabel("move_in_out"), "Move-in / move-out");

console.log("\nCycle schedule:");
check(
  "defaults are a 14-day cycle, 3-day follow-up, 14-day link",
  parsePulseCheckSettings({}),
  { enabled: true, interval_days: 14, followup_days: 3, token_ttl_days: 14 },
);
check(
  "follow-up is clamped inside the token window",
  parsePulseCheckSettings({ followup_days: 20, token_ttl_days: 7 }).followup_days,
  6,
);
check(
  "a cycle is due after the interval",
  cycleIsDue(new Date("2026-08-20T14:00:00Z"), 14, new Date("2026-09-04T14:00:00Z")),
  true,
);
check(
  "a cycle is not due the next day",
  cycleIsDue(new Date("2026-09-04T14:00:00Z"), 14, new Date("2026-09-05T14:00:00Z")),
  false,
);
check(
  "tokenized link is on the contractor host",
  pulseCheckLink("abc").startsWith("https://contractor.novaracleaning.com/cleaner/pulse/"),
  true,
);

if (failures) {
  console.error(`\n${failures} pulse-check check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contractor pulse-check checks passed.");
