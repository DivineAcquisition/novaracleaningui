// ─── Offline verification of the condensed phone screening (no network/DB) ────
//
// Exercises the pure pieces of the screening form so the behaviours that
// matter can be validated without Supabase or a live call:
//
//   • the form follows the VA playbook section for section: four hard
//     qualifiers, honest availability, one acknowledgment, how more work is
//     earned, the verbatim non-solicitation notice, and two scenarios —
//     nothing about licenses, insurance, vehicle capacity, smartphones or
//     work authorization
//   • age 18+ is a hard, non-configurable stop: Decline is the only outcome,
//     and no hand-edited "pending" can turn it into a Hold
//   • a No on car or travel radius blocks Advance and allows Decline
//   • a fixable ID gap routes to Hold and requires a follow-up date
//   • the acknowledgment is ONE capture, and a No blocks Advance
//   • the non-solicitation covenant is captured with a VERBATIM answer, and
//     both a No and a missing verbatim answer block Advance
//   • availability hard cutoffs reach the contractor record
//   • the screening-record PDF still builds, including for screenings taken
//     on the older, longer form
//
//   Run:  npm run screening:verify

import {
  ACKNOWLEDGMENT,
  ACKNOWLEDGMENT_KEY,
  ADVANCE_SCRIPT,
  AGE_GATE_KEY,
  DECLINE_SCRIPT,
  NON_SOLICITATION,
  NON_SOLICITATION_KEY,
  NON_SOLICITATION_MONTHS,
  NON_SOLICITATION_VERBATIM_KEY,
  SCREENING_SECTIONS,
  TRAVEL_GATE_KEY,
  TRAVEL_GATE_MILES,
  acknowledgmentState,
  deriveDownstreamFields,
  hardQualifierState,
  nonSolicitationState,
  sectionProgress,
  validateScreeningOutcome,
  type PhoneScreeningRow,
  type Recommendation,
  type ScreeningAnswers,
  type ScreeningConsents,
} from "../src/lib/phone-screening";
import { buildScreeningPdf } from "../src/lib/screening-pdf";

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

// ─── The question set ─────────────────────────────────────────────────────────

console.log("Question set:");

const qualifiers = SCREENING_SECTIONS.find((s) => s.id === "qualifiers");
const gates = (qualifiers?.questions || []).filter((q) => q.kind === "gate");

check(
  "hard qualifiers are exactly age, photo ID, own car, travel radius",
  gates.map((g) => g.key),
  [AGE_GATE_KEY, "photo_id", "own_car", TRAVEL_GATE_KEY],
);

check(
  "the ID gap is the only fixable qualifier",
  gates.filter((g) => g.fixable).map((g) => g.key),
  ["photo_id"],
);

check(
  "sections follow the playbook order",
  SCREENING_SECTIONS.map((s) => s.id),
  [
    "opening",
    "qualifiers",
    "availability",
    "acknowledgment",
    "earning",
    "non_solicitation",
    "scenarios",
  ],
);

check(
  "exactly one section captures an acknowledgment",
  SCREENING_SECTIONS.filter((s) => s.isAcknowledgment).length,
  1,
);

check(
  "exactly one section captures the non-solicitation covenant",
  SCREENING_SECTIONS.filter((s) => s.isNonSolicitation).length,
  1,
);

const everyWord = SCREENING_SECTIONS.flatMap((s) => [
  s.id,
  s.title,
  s.intro || "",
  ...s.questions.flatMap((q) => [q.key, q.label, q.script || "", q.guidance || ""]),
])
  .join(" ")
  .toLowerCase();

for (const removed of [
  "driver",
  "license",
  "insurance",
  "vacuum",
  "smartphone",
  "app to accept",
  "data plan",
  "authorized to work",
]) {
  check(`the form never mentions "${removed}"`, everyWord.includes(removed), false);
}

check(
  "availability captures both hard cutoffs, the notice needed and the punctuality commitment",
  (SCREENING_SECTIONS.find((s) => s.id === "availability")?.questions || []).map((q) => q.key),
  [
    "days",
    "hours",
    "weekends",
    "cutoff_after",
    "cutoff_before",
    "notice_needed",
    "punctuality_commitment",
    "punctuality_note",
  ],
);

check(
  "the earning section explains the Novara Score and the three tiers",
  ["novara score", "reliability", "quality", "base rate"].every((p) =>
    (SCREENING_SECTIONS.find((s) => s.id === "earning")?.intro || "").toLowerCase().includes(p),
  ),
  true,
);

check(
  "two scenario questions remain",
  (SCREENING_SECTIONS.find((s) => s.id === "scenarios")?.questions || [])
    .filter((q) => q.kind === "longtext")
    .map((q) => q.key),
  ["breakage_answer", "cash_offer_answer"],
);

// ─── Hard qualifiers ──────────────────────────────────────────────────────────

console.log("\nHard qualifiers:");

const passingQualifiers = {
  [AGE_GATE_KEY]: "pass",
  photo_id: "pass",
  own_car: "pass",
  [TRAVEL_GATE_KEY]: "pass",
};
const answersWith = (patch: Record<string, unknown>): ScreeningAnswers => ({
  qualifiers: { ...passingQualifiers, ...patch },
  availability: {
    days: ["Mon", "Wed"],
    hours: "8am–4pm",
    weekends: "no",
    notice_needed: "1 day",
    punctuality_commitment: "yes",
  },
  non_solicitation: {
    [NON_SOLICITATION_VERBATIM_KEY]: "Yes, I understand and I accept that.",
  },
});

const stamp = { at: "2026-07-31T15:00:00.000Z", by_name: "va@novara.test" };

/** Both spoken consents recorded as Yes — the only combination that advances. */
const yesAck: ScreeningConsents = {
  [ACKNOWLEDGMENT_KEY]: { value: "yes", ...stamp },
  [NON_SOLICITATION_KEY]: { value: "yes", ...stamp },
};
const noAck: ScreeningConsents = {
  [ACKNOWLEDGMENT_KEY]: { value: "no", ...stamp },
  [NON_SOLICITATION_KEY]: { value: "yes", ...stamp },
};
const noNonSolicit: ScreeningConsents = {
  [ACKNOWLEDGMENT_KEY]: { value: "yes", ...stamp },
  [NON_SOLICITATION_KEY]: { value: "no", ...stamp },
};

const outcome = (
  answers: ScreeningAnswers,
  consents: ScreeningConsents,
  recommendation: Recommendation,
  extra: { declineReason?: string; holdPending?: string; holdFollowUpDate?: string } = {},
) => validateScreeningOutcome({ answers, consents, recommendation, ...extra });

check("all four passing plus a Yes acknowledgment advances", outcome(answersWith({}), yesAck, "advance"), []);

const ageFail = answersWith({ [AGE_GATE_KEY]: "fail" });
check("a failed age gate is reported as the age stop", hardQualifierState(ageFail).ageStop, true);
check(
  "under 18 cannot advance",
  outcome(ageFail, yesAck, "advance").some((e) => e.includes("hard stop")),
  true,
);
check(
  "under 18 cannot be held",
  outcome(ageFail, yesAck, "hold", { holdPending: "Turns 18 soon", holdFollowUpDate: "2026-09-01" }).some(
    (e) => e.includes("hard stop"),
  ),
  true,
);
check("under 18 declines cleanly", outcome(ageFail, yesAck, "decline", { declineReason: "under_18" }), []);

// A draft row could carry a hand-edited value; the age gate has no fixable
// path, so "pending" must still read as a hard fail.
const agePending = answersWith({ [AGE_GATE_KEY]: "pending" });
check("a pending value on the age gate still hard-fails", hardQualifierState(agePending).ageStop, true);
check("a pending value on the age gate is never merely pending", hardQualifierState(agePending).pending, []);

for (const [key, reason] of [
  ["own_car", "no_vehicle"],
  [TRAVEL_GATE_KEY, "out_of_service_area"],
] as const) {
  const failed = answersWith({ [key]: "fail" });
  check(
    `a No on ${key} blocks Advance`,
    outcome(failed, yesAck, "advance").some((e) => e.includes("failed hard qualifier")),
    true,
  );
  check(`a No on ${key} declines cleanly`, outcome(failed, yesAck, "decline", { declineReason: reason }), []);
}

const idPending = answersWith({ photo_id: "pending" });
check("\"I can get an ID\" is pending, not failed", hardQualifierState(idPending).failed, []);
check(
  "\"I can get an ID\" blocks Advance",
  outcome(idPending, yesAck, "advance").some((e) => e.includes("pending")),
  true,
);
check(
  "a Hold without a follow-up date is rejected",
  outcome(idPending, yesAck, "hold", { holdPending: "Applying for a state ID" }),
  ["Hold requires a specific follow-up date."],
);
check(
  "a Hold with a follow-up date is accepted",
  outcome(idPending, yesAck, "hold", { holdPending: "Applying for a state ID", holdFollowUpDate: "2026-08-21" }),
  [],
);

// ─── Acknowledgment ───────────────────────────────────────────────────────────

console.log("\nAcknowledgment:");

check("the acknowledgment is a single capture", acknowledgmentState(yesAck).captured, true);
check(
  "an uncaptured acknowledgment blocks Advance",
  outcome(answersWith({}), {}, "advance").some((e) => e.includes("must be recorded")),
  true,
);
check(
  "an acknowledgment recorded as No blocks Advance",
  outcome(answersWith({}), noAck, "advance").some((e) => e.includes("recorded as No")),
  true,
);
check(
  "an acknowledgment recorded as No still declines cleanly",
  outcome(answersWith({}), noAck, "decline", { declineReason: "declined_consent" }),
  [],
);
check(
  "the acknowledgment section counts as one item of progress",
  sectionProgress(SCREENING_SECTIONS.find((s) => s.isAcknowledgment)!, {}, yesAck),
  { answered: 1, total: 1 },
);
check(
  "the spoken block covers 1099, pay, background check, agreement and process",
  ["1099", "taxes", "percentage", "weekly", "background check", "contractor agreement", "photos"].every((p) =>
    ACKNOWLEDGMENT.script.toLowerCase().includes(p),
  ),
  true,
);

// ─── Client non-solicitation covenant ─────────────────────────────────────────

console.log("\nClient non-solicitation covenant:");

check(
  "the verbatim block states the term, the scope, and every stated consequence",
  [
    `${NON_SOLICITATION_MONTHS} months`,
    "directly or indirectly",
    "solicit, accept, service, or perform",
    "whether the client approaches you or you approach them",
    "cash, by check, through another company",
    "terminated immediately for cause",
    "liquidated damages",
    "set off against",
    "injunctive relief",
    "attorneys' fees",
    "survive the end of our working relationship",
    "do you understand and accept this provision",
  ].every((p) => NON_SOLICITATION.script.toLowerCase().includes(p.toLowerCase())),
  true,
);

// The covenant is its own capture: recording the acknowledgment must never
// imply the covenant was read, and vice versa.
check(
  "recording the acknowledgment alone leaves the covenant uncaptured",
  nonSolicitationState({ [ACKNOWLEDGMENT_KEY]: { value: "yes", ...stamp } }).captured,
  false,
);
check(
  "recording the covenant alone leaves the acknowledgment uncaptured",
  acknowledgmentState({ [NON_SOLICITATION_KEY]: { value: "yes", ...stamp } }).captured,
  false,
);

check("a recorded covenant reads as captured", nonSolicitationState(yesAck).isYes, true);

check(
  "an uncaptured covenant blocks Advance",
  outcome(answersWith({}), { [ACKNOWLEDGMENT_KEY]: { value: "yes", ...stamp } }, "advance").some((e) =>
    e.includes("non-solicitation covenant must be read"),
  ),
  true,
);

check(
  "a covenant recorded as No blocks Advance",
  outcome(answersWith({}), noNonSolicit, "advance").some((e) => e.includes("was not accepted")),
  true,
);

check(
  "a refused covenant declines cleanly",
  outcome(answersWith({}), noNonSolicit, "decline", { declineReason: "refused_non_solicitation" }),
  [],
);

// The playbook requires their answer recorded verbatim, with the date and the
// screener — a bare Yes toggle is not the record.
const noVerbatim: ScreeningAnswers = { ...answersWith({}), non_solicitation: {} };
check(
  "a captured covenant without the verbatim answer blocks Advance",
  outcome(noVerbatim, yesAck, "advance").some((e) => e.includes("verbatim")),
  true,
);

check(
  "the covenant section counts the Yes/No and the verbatim answer",
  sectionProgress(
    SCREENING_SECTIONS.find((s) => s.isNonSolicitation)!,
    answersWith({}),
    yesAck,
  ),
  { answered: 2, total: 2 },
);

// ─── How the call ends ────────────────────────────────────────────────────────

console.log("\nHow the call ends:");

check(
  "the advance script names the agreement, W-9, background check and payment setup",
  ["agreement to sign", "w-9", "background check", "how you get paid"].every((p) =>
    ADVANCE_SCRIPT.toLowerCase().includes(p),
  ),
  true,
);

check(
  "the decline script no longer promises to keep them on file",
  DECLINE_SCRIPT.toLowerCase().includes("on file"),
  false,
);

// ─── Downstream fields (dispatch + risk layer) ────────────────────────────────

console.log("\nDownstream fields:");

const withCutoffs = deriveDownstreamFields({
  qualifiers: passingQualifiers,
  availability: {
    days: ["Wed", "Mon", "Sat"],
    hours: "8am–3pm",
    weekends: "yes",
    cutoff_after: "3pm",
    cutoff_before: "9am",
    notice_needed: "2 days",
  },
});

check("a stated hard cutoff reaches the contractor record", withCutoffs.noWorkAfter, "3pm");
check("a front-end cutoff reaches the contractor record", withCutoffs.noWorkBefore, "9am");
check(
  "cutoffs and notice land in the constraint notes the risk layer reads",
  withCutoffs.constraintNotes,
  "No work after 3pm · No work before 9am · Needs 2 days notice",
);
check("days are normalized to the order dispatch scoring reads", withCutoffs.preferredDays, ["Mon", "Wed", "Sat"]);
check("availability collapses to a one-liner", withCutoffs.availabilityText, "Mon/Wed/Sat · 8am–3pm · weekends ok");
check("passing the travel gate credits the travel radius", withCutoffs.travelRadiusMiles, TRAVEL_GATE_MILES);

check(
  "a screening from the older form still yields its typed travel radius",
  deriveDownstreamFields({ qualifiers: { travel_radius: "20 miles" } }).travelRadiusMiles,
  20,
);

// ─── Screening-record PDF ─────────────────────────────────────────────────────

const baseRow: PhoneScreeningRow = {
  id: "11111111-1111-1111-1111-111111111111",
  applicant_id: "22222222-2222-2222-2222-222222222222",
  status: "submitted",
  answers: {
    ...answersWith({}),
    scenarios: {
      breakage_answer: "Stop, photograph it, tell the client and call the office right away.",
      breakage_rating: 5,
      cash_offer_answer: "Tell them I can't, and give them the office number.",
      cash_offer_rating: 5,
    },
  },
  consents: yesAck,
  scorecard: { availability_fit: 4, scenario_judgment: 5 },
  recommendation: "advance",
  decline_reason: null,
  decline_notes: null,
  hold_pending: null,
  hold_follow_up_date: null,
  screener_id: "33333333-3333-3333-3333-333333333333",
  screener_name: "va@novara.test",
  started_at: "2026-07-31T14:55:00.000Z",
  submitted_at: "2026-07-31T15:02:00.000Z",
  pdf_path: null,
  pdf_status: "none",
  pdf_attempts: 0,
  pdf_last_error: null,
  created_at: "2026-07-31T14:55:00.000Z",
  updated_at: "2026-07-31T15:02:00.000Z",
};

const applicant = {
  full_name: "Dana Reyes",
  first_name: "Dana",
  last_name: "Reyes",
  email: "dana@example.test",
  phone: "555-0100",
  zip_code: "20850",
  state: "MD",
};

async function checkPdfs(): Promise<void> {
  console.log("\nScreening-record PDF:");

  const bytes = await buildScreeningPdf(baseRow, applicant);
  check("a condensed screening still generates a PDF", bytes.length > 1000, true);

  // A screening taken on the older form must still render in full — submitted
  // records are immutable, so nothing said on that call may silently vanish.
  const preCovenantAnswers: ScreeningAnswers = { ...baseRow.answers };
  delete preCovenantAnswers.non_solicitation;

  const preCovenantRow: PhoneScreeningRow = {
    ...baseRow,
    answers: preCovenantAnswers,
    consents: { [ACKNOWLEDGMENT_KEY]: { value: "yes", ...stamp } },
  };
  const preCovenantBytes = await buildScreeningPdf(preCovenantRow, applicant);
  check(
    "a screening taken before the covenant existed still generates a PDF",
    preCovenantBytes.length > 1000,
    true,
  );
  check(
    "the covenant section is omitted (not printed as a failure) when it was never captured",
    preCovenantBytes.length < bytes.length,
    true,
  );

  const legacyRow: PhoneScreeningRow = {
    ...preCovenantRow,
    answers: {
      ...preCovenantAnswers,
      qualifiers: { ...passingQualifiers, vehicle: "pass", phone_app: "pass", travel_radius: "20" },
      systems: { systems_ack: "yes" },
      legal: { legal_ack: "yes", _notes: "Asked about substitutes." },
    },
    consents: {
      contractor_1099: { value: "yes", ...stamp },
      liability_insurance: { value: "no", ...stamp },
    },
  };
  const legacyBytes = await buildScreeningPdf(legacyRow, applicant);
  check("an older screening still generates a PDF", legacyBytes.length > 1000, true);
  check(
    "the older record still renders everything it captured",
    legacyBytes.length > preCovenantBytes.length,
    true,
  );
}

void checkPdfs().then(() => {
  console.log(
    failures === 0
      ? "\nAll phone screening checks passed."
      : `\n${failures} check${failures === 1 ? "" : "s"} FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
});
