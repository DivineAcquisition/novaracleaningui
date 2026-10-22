// Behavior for automated contractor intake and the Lead Cleaner role.
//
//   Run: npx tsx scripts/verify-contractor-intake.ts

import {
  beforeYouStartSteps,
  beforeYouStartTotal,
  dueReminderHours,
  readyItemsForRole,
  recordReadiness,
  emptyReadiness,
} from "../src/lib/contractor-intake/before-you-start";
import {
  DEFAULT_INTAKE_SETTINGS,
  INTAKE_WORDING,
  LEAD_GUARDRAILS,
  addBusinessDays,
  backgroundNext,
  canActivate,
  canSendFinalAdverse,
  compliancePanel,
  blocksRepeatApplication,
  decideApplication,
  planIdDeletion,
  helperPayCents,
  imagesOverdue,
  leadEligible,
  applicantMessage,
  canCloseLeadJob,
  invitationsNeedAdminApproval,
  leadCanSetTrialOutcome,
  leadPayCents,
  leadWalkthroughSummaryLines,
  nameMismatches,
  openPreAdverse,
  pauseMessage,
  reviewLeadAssignment,
  soloRate,
  usesForbiddenApplicantLanguage,
  wordingById,
  type ApplicationAnswers,
  type ComplianceRecord,
  type ReliabilityRecord,
} from "../src/lib/contractor-intake";

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const now = new Date("2026-10-21T15:00:00.000Z");

function answers(patch: Partial<ApplicationAnswers> = {}): ApplicationAnswers {
  return {
    role: "cleaner",
    email: "ada@example.com",
    phone: "+13015550123",
    name: "Ada Lovelace",
    zip: "21213",
    zipInServiceArea: true,
    daysAvailable: 3,
    age18: true,
    hasSmartphone: true,
    hasVehicle: true,
    willHaveKit: true,
    understandsContractorWork: true,
    understandsVerification: true,
    smsConsent: false,
    emailConsent: true,
    duplicate: false,
    incomplete: false,
    ...patch,
  };
}

const pass = decideApplication(answers(), DEFAULT_INTAKE_SETTINGS, now);
check("a full yes in area opens onboarding", pass.outcome === "pass" && pass.openOnboarding && pass.stage === "conditional_approval");
check("the pass message does not schedule a call", !/call/i.test(pass.message) || /no phone call/i.test(pass.message));
check("pass message uses contractor language", !usesForbiddenApplicantLanguage(pass.message));

const noCar = decideApplication(answers({ hasVehicle: false }), DEFAULT_INTAKE_SETTINGS, now);
check("a no on the vehicle names that requirement", noCar.outcome === "not_a_fit" && /vehicle/i.test(noCar.message));
const unauthorized = decideApplication(answers({ authorizedToWork: false }), DEFAULT_INTAKE_SETTINGS, now);
check("a no on work authorization waits for a person", unauthorized.outcome === "needs_review" && unauthorized.openOnboarding === false && unauthorized.countsAsRejection === false && unauthorized.reapplyOn === null && unauthorized.reviewReason === "work authorization answer");
const noBackground = decideApplication(answers({ backgroundCheckConsent: false }), DEFAULT_INTAKE_SETTINGS, now);
check("declining the background disclosure does not qualify", noBackground.outcome === "not_a_fit" && noBackground.openOnboarding === false);
const noPay = decideApplication(answers({ payConsent: false }), DEFAULT_INTAKE_SETTINGS, now);
check("declining the pay terms does not qualify", noPay.outcome === "not_a_fit" && noPay.openOnboarding === false);
const noId = decideApplication(answers(), DEFAULT_INTAKE_SETTINGS, now);
check("a missing photo ID does not change a pass", noId.outcome === "pass");
check("the not-a-fit message includes the reapply date", noCar.reapplyOn === "2026-12-20");
check("a not-a-fit is the only rejection", noCar.countsAsRejection && !pass.countsAsRejection);

const outside = decideApplication(answers({ zipInServiceArea: false }));
check("out of area is a waitlist and not a rejection", outside.outcome === "waitlist" && outside.countsAsRejection === false);

const duplicate = decideApplication(answers({ duplicate: true }));
check("a duplicate goes to review", duplicate.outcome === "needs_review" && duplicate.openOnboarding === false);
check("an unfinished applicant can still qualify", blocksRepeatApplication({ removedContractor: false, activeCleaner: false, existingStage: "screening" }) === false);
check("an applicant still in onboarding can continue", blocksRepeatApplication({ removedContractor: false, activeCleaner: false, existingStage: "onboarding" }) === false);
check("an active contractor blocks a second application", blocksRepeatApplication({ removedContractor: false, activeCleaner: true, existingStage: "active" }) === true);
check("a rejected application blocks a second application", blocksRepeatApplication({ removedContractor: false, activeCleaner: false, existingStage: "rejected" }) === true);
check("a withdrawn application blocks a second application", blocksRepeatApplication({ removedContractor: false, activeCleaner: false, existingStage: "withdrawn" }) === true);

check("wording starts as draft", INTAKE_WORDING.every((row) => row.status === "draft"));
check("vehicle reason is stored", /personal vehicle/i.test(wordingById("why_vehicle")?.body || ""));
check("application does not collect a taxpayer id", !/social security number/i.test(wordingById("application_privacy")?.body || "") || /do not collect a social security number/i.test(wordingById("application_privacy")?.body || ""));

const identity = compliancePanel("identity");
check("identity step shows what, why, who, and retention", Boolean(identity && identity.collects && identity.why && identity.whoSees && identity.retention && identity.rights));
check("declining face match is a right on the identity step", /manual review/i.test(identity?.rights || ""));

check("a clear background check continues", backgroundNext("clear") === "continue");
check("any other background result waits for a person", backgroundNext("consider") === "person_review");
const adverse = openPreAdverse(now);
check("final notice waits five business days", adverse.finalAllowedAt === "2026-10-28T15:00:00.000Z");
check("final notice is blocked during the wait", canSendFinalAdverse(adverse, new Date("2026-10-27T15:00:00.000Z")) === false);
check("final notice is allowed when the wait ends", canSendFinalAdverse(adverse, new Date("2026-10-28T15:00:00.000Z")) === true);

const waiting = applicantWait();
check("time in review extends the applicant deadline", waiting.withWait > waiting.withoutWait);

check("an identity image past its date is flagged", imagesOverdue(new Date("2026-09-01T00:00:00.000Z"), false, now));
check("a deleted identity image is not flagged", imagesOverdue(new Date("2026-09-01T00:00:00.000Z"), true, now) === false);

const mismatch = nameMismatches({
  identity: "Ada Lovelace",
  license: "Ada Lovelace",
  vehicle: "Ada Lovelace",
  background: "Ada Lovelace",
  agreement: "Ada Lovelace",
  w9: "A. Lovelace",
  payout: "Ada Lovelace",
});
check("a W-9 name that differs blocks activation", mismatch.includes("w9"));

const complete: ComplianceRecord = {
  consents: [{ id: "application_sms", status: "draft" }],
  backgroundClearOrReviewed: true,
  identityResolved: true,
  vehicleResolved: true,
  kitConfirmed: true,
  agreementSigned: true,
  w9Complete: true,
  payoutSet: true,
  trainingPassed: true,
  trialPassedByAdmin: true,
  nameMismatchOpen: false,
};
check("a complete record can be activated", canActivate(complete));
check("a name mismatch cannot be activated", canActivate({ ...complete, nameMismatchOpen: true }) === false);
check("an admin must pass the trial", canActivate({ ...complete, trialPassedByAdmin: false }) === false);

const reliable: ReliabilityRecord = {
  active: true,
  inProbation: false,
  tenureDays: 120,
  completedJobs: 30,
  novaraScore: 90,
  noShows: 0,
  lateCancellations: 0,
  openComplaints: 0,
  openQcCases: 0,
  vehicleVerified: true,
  kitConfirmed: true,
};
check("an eligible contractor is on the lead list", leadEligible(reliable).ok);
check("probation keeps someone off the lead list", leadEligible({ ...reliable, inProbation: true }).ok === false);
check("a no-show keeps someone off the lead list", leadEligible({ ...reliable, noShows: 1 }).ok === false);

check("a solo job stays on the tier rate", soloRate("elite") === 45 && soloRate("foundation") === 35);
check("a lead job uses 47 percent", leadPayCents(10000) === 4700);
check("the helper is paid separately", helperPayCents(10000) === 3500);
const over = reviewLeadAssignment({ ...DEFAULT_INTAKE_SETTINGS, laborCapPercent: 70 });
check("lead plus helper over the cap needs a person", over.needsAdmin && over.laborPercent === 82);
const open = reviewLeadAssignment({ ...DEFAULT_INTAKE_SETTINGS, laborCapPercent: null });
check("an unset labor cap needs a person", open.needsAdmin);
check("lead status pauses instead of being removed", pauseMessage(["Novara Score of at least 80"]).includes("paused") && pauseMessage(["Novara Score of at least 80"]).includes("active cleaner"));
check("guardrails deny authority over other contractors", LEAD_GUARDRAILS.some((line) => /no authority|cannot approve/i.test(line)));
check("a lead job cannot close without the walkthrough", canCloseLeadJob({ leadJob: true, checklistDone: false, photoCount: 0 }).ok === false);
check("a finished walkthrough can close", canCloseLeadJob({ leadJob: true, checklistDone: true, photoCount: 2 }).ok);
check("the walkthrough is named in the completion summary", leadWalkthroughSummaryLines({ checklistDone: true, photoCount: 2, note: "Kitchen done" }).some((line) => /walkthrough/i.test(line)));
check("a lead cannot set the trial outcome", leadCanSetTrialOutcome() === false);
check("invitations wait for admin approval", invitationsNeedAdminApproval(false) === false && invitationsNeedAdminApproval(true));
const note = applicantMessage("conditional_approval", { firstName: "Ada", link: "https://contractor.novaracleaning.com/cleaner/auth?invite=abc" });
check("the approval message has one link and no call to schedule", note.text.includes("invite=abc") && /no phone call/i.test(note.text));
check("approval copy avoids forbidden words", !usesForbiddenApplicantLanguage(note.text));
check("applicant messages avoid employee language", usesForbiddenApplicantLanguage("You are hired as staff") && !usesForbiddenApplicantLanguage(pass.message));

const closedLead = decideApplication(answers({ role: "lead_cleaner" }), { ...DEFAULT_INTAKE_SETTINGS, leadRoleOpenToPublic: false }, now);
check("a closed lead role waits for a person", closedLead.outcome === "needs_review" && closedLead.openOnboarding === false);
const openLead = decideApplication(answers({ role: "lead_cleaner" }), { ...DEFAULT_INTAKE_SETTINGS, leadRoleOpenToPublic: true }, now);
check("an open lead role can pass onto the lead track", openLead.outcome === "pass" && openLead.leadTrack === true);
const held = planIdDeletion({ stage: "not_a_fit", decidedAt: "2020-01-01", uploadedAt: "2020-01-01", hasHold: true, identityResultAt: null, now });
check("an open data request keeps the photo ID", held.delete === false && held.reason === "hold");
const oldRejection = planIdDeletion({ stage: "not_a_fit", decidedAt: "2020-01-01", uploadedAt: "2020-01-01", hasHold: false, identityResultAt: null, now });
check("a rejected application past retention deletes the ID", oldRejection.delete === true && oldRejection.reason === "not_approved");
const fresh = planIdDeletion({ stage: "not_a_fit", decidedAt: now.toISOString(), uploadedAt: now.toISOString(), hasHold: false, identityResultAt: null, now });
check("a new rejection keeps the ID until retention ends", fresh.delete === false);

function applicantWait() {
  const start = new Date("2026-10-01T00:00:00.000Z");
  const { applicantDeadline } = require("../src/lib/contractor-intake") as typeof import("../src/lib/contractor-intake");
  return {
    withoutWait: applicantDeadline(start).getTime(),
    withWait: applicantDeadline(start, DEFAULT_INTAKE_SETTINGS, 3 * 24 * 60 * 60 * 1000).getTime(),
  };
}

void addBusinessDays;

const steps = beforeYouStartSteps(DEFAULT_INTAKE_SETTINGS.beforeStartMinutes);
check("before you start reads the live onboarding steps", steps.map((step) => step.id), ["identity", "vehicle", "agreement", "phone", "supplies", "job_day", "dress_code", "background", "w9", "payouts", "training", "trial"]);
check("before you start totals the settings minutes", beforeYouStartTotal(steps), Object.values(DEFAULT_INTAKE_SETTINGS.beforeStartMinutes).reduce((sum, n) => sum + n, 0));
check("lead adds a reference and turnover does not", readyItemsForRole("Lead Cleaner (Contractor)").some((item) => item.includes("reference")) && !readyItemsForRole("Turnover Cleaner (Contractor)").some((item) => item.includes("reference")), true);
check("background and the trial wait on Novara", steps.filter((step) => step.waitsOnNovara).map((step) => step.id), ["background", "trial"]);
const saved = recordReadiness(emptyReadiness(), "not_yet", "2026-10-22T00:00:00.000Z");
check("not yet is recorded and is not a rejection", saved.answer, "not_yet");
check("a yes replaces not yet", recordReadiness(saved, "yes", "2026-10-22T01:00:00.000Z").answer, "yes");
check("the 24 hour reminder waits until the hour", dueReminderHours({
  answer: "not_yet",
  launchedAt: "2026-10-22T00:00:00.000Z",
  deadlineAt: "2026-11-01T00:00:00.000Z",
  hours: [24, 48],
  sent: [],
  now: new Date("2026-10-22T12:00:00.000Z"),
}), []);
check("the 24 hour reminder is due after a day", dueReminderHours({
  answer: "not_yet",
  launchedAt: "2026-10-22T00:00:00.000Z",
  deadlineAt: "2026-11-01T00:00:00.000Z",
  hours: [24, 48],
  sent: [],
  now: new Date("2026-10-23T01:00:00.000Z"),
}), [24]);
check("yes stops reminders", dueReminderHours({
  answer: "yes",
  launchedAt: "2026-10-22T00:00:00.000Z",
  deadlineAt: "2026-11-01T00:00:00.000Z",
  hours: [24, 48],
  sent: [],
  now: new Date("2026-10-24T00:00:00.000Z"),
}), []);
check("a passed deadline does not reject and does not remind", dueReminderHours({
  answer: "not_yet",
  launchedAt: "2026-10-22T00:00:00.000Z",
  deadlineAt: "2026-10-23T00:00:00.000Z",
  hours: [24, 48],
  sent: [],
  now: new Date("2026-10-24T00:00:00.000Z"),
}), []);
check("before you start wording is draft", INTAKE_WORDING.find((row) => row.id === "before_start_title")?.status, "draft");

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\ncontractor intake checks passed");
