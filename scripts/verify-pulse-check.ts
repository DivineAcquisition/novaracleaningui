// Offline verification of the contractor pulse-check cycle (no network/DB).
//
//   • idle predicate (active + approved + available, ignoring declined/lost rows)
//   • eligibility reuses zone/capacity scoring, then hard-applies days + cutoffs
//   • stay / 1–2 week pause / leave + 1-month map onto roster actions
//   • availability patches still never include roster or score fields
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
  EMPTY_PULSE_DRAFT,
  normalizePulseDraft,
  outcomeFromAnswers,
  PULSE_FORBIDDEN_CLEANER_FIELDS,
  pulseDraftComplete,
  rosterActionFromDraft,
  staleOutcome,
} from "../src/lib/pulse-check/answers";
import { formatAvgWeeklyPay } from "../src/lib/pulse-check/earnings";
import {
  inactiveUntilFromDraft,
  isReapplyBlocked,
  PULSE_REAPPLY_DAYS,
  reapplyEligibleAt,
} from "../src/lib/pulse-check/roster";
import {
  cycleIsDue,
  latestIntervalStartedAt,
  parsePulseCheckSettings,
  pulseCheckLink,
  pulseSendBlockedReason,
} from "../src/lib/pulse-check/settings";
import { pulseSmsMessage } from "../src/lib/pulse-check/send";
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
const stayAble = normalizePulseDraft({
  status: "still_active",
  ability: "able",
  preferredWorkDays: ["Mon"],
});
check("still active + able is complete", pulseDraftComplete(stayAble), true);
check("still active + able closes as completed", outcomeFromAnswers(stayAble), "completed");
check("still active + able does not change roster", rosterActionFromDraft(stayAble), "none");
check(
  "step away without a duration is incomplete",
  pulseDraftComplete(normalizePulseDraft({ status: "step_away" })),
  false,
);
check(
  "step away without a duration is not a roster write",
  rosterActionFromDraft(normalizePulseDraft({ status: "step_away" })),
  "none",
);
const weekAway = normalizePulseDraft({ status: "step_away", timeAway: "1_week" });
check("1 week away is complete", pulseDraftComplete(weekAway), true);
check("1 week away sets inactive", rosterActionFromDraft(weekAway), "inactive");
check("1 week away closes as completed", outcomeFromAnswers(weekAway), "completed");
check(
  "2 weeks away sets inactive",
  rosterActionFromDraft(normalizePulseDraft({ status: "step_away", timeAway: "2_weeks" })),
  "inactive",
);
check(
  "1 month away without ack is incomplete",
  pulseDraftComplete(normalizePulseDraft({ status: "step_away", timeAway: "1_month" })),
  false,
);
const monthAway = normalizePulseDraft({
  status: "step_away",
  timeAway: "1_month",
  acknowledged: true,
});
check("1 month away with ack is complete", pulseDraftComplete(monthAway), true);
check("1 month away terminates", rosterActionFromDraft(monthAway), "terminate");
check(
  "leave without ack is incomplete",
  pulseDraftComplete(normalizePulseDraft({ status: "leave" })),
  false,
);
const leave = normalizePulseDraft({ status: "leave", acknowledged: true });
check("leave with ack is complete", pulseDraftComplete(leave), true);
check("leave terminates", rosterActionFromDraft(leave), "terminate");
check("leave closes as completed", outcomeFromAnswers(leave), "completed");
check(
  "legacy not_sure is incomplete and flags review",
  [
    pulseDraftComplete(normalizePulseDraft({ status: "not_sure", ability: "able" })),
    outcomeFromAnswers(normalizePulseDraft({ status: "not_sure", ability: "able" })),
    rosterActionFromDraft(normalizePulseDraft({ status: "not_sure", ability: "able" })),
  ],
  [false, "needs_review", "none"],
);
check(
  "blocked ability flags review without a roster write",
  [
    outcomeFromAnswers(
      normalizePulseDraft({ status: "still_active", ability: "blocked", abilityNote: "surgery" }),
    ),
    rosterActionFromDraft(
      normalizePulseDraft({ status: "still_active", ability: "blocked", abilityNote: "surgery" }),
    ),
  ],
  ["needs_review", "none"],
);
check(
  "blocked without a note is incomplete",
  pulseDraftComplete(normalizePulseDraft({ status: "still_active", ability: "blocked" })),
  false,
);
const availPatch = availabilityPatch(
  normalizePulseDraft({ preferredWorkDays: ["Mon"], noWorkAfter: "3pm" }),
  {},
);
check(
  "availability patch never includes status / scores / roster stamps",
  PULSE_FORBIDDEN_CLEANER_FIELDS.some((k) => k in availPatch),
  false,
);
check("availability patch only writes days + constraints", Object.keys(availPatch).sort(), [
  "constraints",
  "preferred_work_days",
]);

console.log("\nRoster stamps:");
const freeze = new Date("2026-09-04T14:00:00.000Z");
check(
  "1 week pause stamps inactive_until +7 days",
  inactiveUntilFromDraft(weekAway, freeze),
  "2026-09-11T14:00:00.000Z",
);
check(
  "2 weeks pause stamps inactive_until +14 days",
  inactiveUntilFromDraft(normalizePulseDraft({ status: "step_away", timeAway: "2_weeks" }), freeze),
  "2026-09-18T14:00:00.000Z",
);
check("1 month away does not stamp inactive_until", inactiveUntilFromDraft(monthAway, freeze), null);
check("stay does not stamp inactive_until", inactiveUntilFromDraft(stayAble, freeze), null);
check("reapply lockout is 90 days", PULSE_REAPPLY_DAYS, 90);
check("reapplyEligibleAt is +90 days", reapplyEligibleAt(freeze), "2026-12-03T14:00:00.000Z");
check(
  "future reapply_eligible_at blocks hiring",
  isReapplyBlocked({ status: "terminated", reapply_eligible_at: "2026-12-03T14:00:00.000Z" }, freeze),
  { blocked: true, until: "2026-12-03T14:00:00.000Z" },
);
check(
  "terminated_at fallback blocks for 90 days when stamp is missing",
  isReapplyBlocked(
    { status: "terminated", terminated_at: "2026-09-01T14:00:00.000Z", reapply_eligible_at: null },
    freeze,
  ).blocked,
  true,
);
check(
  "active contractors are not reapply-blocked",
  isReapplyBlocked({ status: "active", reapply_eligible_at: null }, freeze),
  { blocked: false, until: null },
);
check(
  "lockout lifts after the eligible date",
  isReapplyBlocked({ status: "terminated", reapply_eligible_at: "2026-08-01T00:00:00.000Z" }, freeze),
  { blocked: false, until: null },
);
check(
  "earnings copy includes a weekly dollar amount",
  formatAvgWeeklyPay(12500).includes("$125"),
  true,
);
check(
  "earnings copy has a fallback when we have no paid weeks",
  formatAvgWeeklyPay(null).includes("paid per job"),
  true,
);
check("empty draft is not a roster write", rosterActionFromDraft(EMPTY_PULSE_DRAFT), "none");
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
check(
  "a one-off admin send does not move the 14-day clock",
  cycleIsDue(
    latestIntervalStartedAt([
      { started_at: "2026-09-04T14:00:00Z", counts_toward_interval: true, source: "cron" },
      { started_at: "2026-09-05T18:00:00Z", counts_toward_interval: false, source: "admin-one" },
    ]),
    14,
    new Date("2026-09-05T20:00:00Z"),
  ),
  false,
);
check(
  "without any interval cycle, a manual send still leaves the schedule due",
  cycleIsDue(
    latestIntervalStartedAt([
      { started_at: "2026-09-04T14:00:00Z", counts_toward_interval: false, source: "admin-one" },
    ]),
    14,
    new Date("2026-09-04T15:00:00Z"),
  ),
  true,
);
check(
  "source=admin-one is ignored even if the boolean is missing",
  latestIntervalStartedAt([
    { started_at: "2026-09-01T14:00:00Z", source: "cron" },
    { started_at: "2026-09-04T14:00:00Z", source: "admin-one" },
  ]),
  "2026-09-01T14:00:00Z",
);
check(
  "terminated contractors are blocked from a manual send",
  pulseSendBlockedReason("terminated"),
  "Cannot send a pulse check to a terminated contractor.",
);
check("active contractors are not blocked", pulseSendBlockedReason("active"), null);
check(
  "SMS copy includes STOP",
  pulseSmsMessage("Maya", "https://contractor.novaracleaning.com/cleaner/pulse/abc", "initial").includes("STOP"),
  true,
);

if (failures) {
  console.error(`\n${failures} pulse-check check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contractor pulse-check checks passed.");
