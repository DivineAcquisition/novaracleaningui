// Payout methods: Stripe stays first, manual methods are paid in a pay run,
// and every must-hold behavior is checked here without touching a real contractor.

import {
  CONTRACTOR_OPS_FROM,
  NO_TAX_WITHHELD,
  OVERPAYMENT_SECTION,
  PAYMENT_SUMMARY_TITLE,
  RECOMMENDED_LABEL,
  activeAcknowledgment,
  agedEarnings,
  agingAlert,
  applyFailed,
  applyPaid,
  applySettingsChange,
  assemblePayRun,
  buildPaymentSummary,
  canSendExistingOptionsNotice,
  cleanerPatchForVerifiedManual,
  confirmationPreview,
  defaultPayoutSettings,
  detailChangeNotice,
  existingStripeOptionsNotice,
  finalPayDestination,
  forAiPrompt,
  isStalledAtPayoutStep,
  maskPayoutIdentifier,
  methodOneLine,
  methodsForChoice,
  monthlyTotalsByMethod,
  namesReasonablyMatch,
  paidNotice,
  paymentFailedNotice,
  paymentSummaryProblems,
  payoutMethodReport,
  payoutSafeRecord,
  redactPayoutIdentifiers,
  validateManualSubmission,
  type PayContractor,
  type PayEarning,
  type PayoutSettings,
} from "../src/lib/payout-methods";
import { issueVerificationCode, verificationCodeMatches } from "../src/lib/payout-verification";
import { jobPayFromLedgers, necInclusion } from "../src/lib/nec-1099";
import { isCleanerReadyForFirstJob, isCleanerSetupComplete, isPayoutSetupStarted } from "../src/lib/cleaner-supplies";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const settings = defaultPayoutSettings();
const ack = activeAcknowledgment(settings).text;
const cash = settings.methods.find((m) => m.code === "cash_app")!;
const zelle = settings.methods.find((m) => m.code === "zelle")!;
const chime = settings.methods.find((m) => m.code === "chime")!;

function contractor(partial: Partial<PayContractor> & Pick<PayContractor, "cleanerId" | "name">): PayContractor {
  return {
    methodCode: "cash_app",
    methodKind: "manual",
    methodStatus: "verified",
    identifier: "$ada",
    accountName: "Ada Lovelace",
    w9OnFile: true,
    w9LegalName: "Ada Lovelace",
    engagementStatus: "active",
    detailsChangedAt: null,
    confirmDetails: false,
    priorPaidIdentifiers: [],
    ...partial,
  };
}

function earning(partial: Partial<PayEarning> & Pick<PayEarning, "id" | "cleanerId" | "amountCents">): PayEarning {
  return {
    jobId: "J-1",
    jobDate: "2026-10-01",
    kind: "job",
    reason: null,
    section: null,
    status: "approved",
    qcCleared: true,
    approvedAt: "2026-10-02T00:00:00.000Z",
    ...partial,
  };
}

console.log("\nChooser");
const choice = methodsForChoice(settings);
check("stripe is first", choice[0]?.code, "stripe");
check("stripe carries the recommended label", choice[0]?.code === "stripe" && RECOMMENDED_LABEL.includes("Recommended"), true);
check("manual methods say they are paid weekly", methodOneLine(cash, settings).includes("Friday"), true);
check("a disabled method is hidden", methodsForChoice(applySettingsChange(settings, { methods: settings.methods.map((m) => m.code === "chime" ? { ...m, enabled: false } : m) }, "2026-10-15T00:00:00.000Z").settings).some((m) => m.code === "chime"), false);

console.log("\nManual signup");
const mismatch = validateManualSubmission({
  method: cash,
  identifier: "$ada",
  identifierAgain: "$ida",
  accountName: "Ada Lovelace",
  acknowledged: true,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("a mismatched cashtag is refused", mismatch.ok, false);
const noAck = validateManualSubmission({
  method: cash,
  identifier: "$ada",
  identifierAgain: "$Ada",
  accountName: "Ada Lovelace",
  acknowledged: false,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("the acknowledgment is required", noAck.ok, false);
const okCash = validateManualSubmission({
  method: cash,
  identifier: "$Ada",
  identifierAgain: "$ada",
  accountName: "Ada Lovelace",
  acknowledged: true,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("matching cashtags are accepted", okCash.ok && okCash.ok && okCash.identifier, "$ada");
const preview = confirmationPreview({ method: cash, identifier: "$Ada", accountName: "Ada Lovelace", settings });
check("confirmation shows the identifier and what to expect", preview.expect.includes("Friday") && preview.identifier, "$ada");
const zelleOk = validateManualSubmission({
  method: zelle,
  identifier: "ada@example.com",
  identifierAgain: "Ada@example.com",
  accountName: "Ada Lovelace",
  acknowledged: true,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("zelle accepts the enrolled email", zelleOk.ok, true);
const chimeOk = validateManualSubmission({
  method: chime,
  identifier: "$AdaChime",
  identifierAgain: "$adachime",
  accountName: "Ada Lovelace",
  acknowledged: true,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("chime accepts a $ChimeSign", chimeOk.ok && chimeOk.ok && chimeOk.identifier, "$adachime");
const badChime = validateManualSubmission({
  method: chime,
  identifier: "ada@chime.com",
  identifierAgain: "ada@chime.com",
  accountName: "Ada Lovelace",
  acknowledged: true,
  acknowledgmentText: ack,
  activeAcknowledgmentText: ack,
});
check("chime does not treat an email as a $ChimeSign", badChime.ok, false);

console.log("\nOnboarding without Stripe");
const manualDone = {
  ob_agreement_signed: true,
  phone_verified: true,
  supply_checklist_submitted_at: "2026-10-01T00:00:00.000Z",
  ob_dress_code_ack: true,
  ob_job_day_guides_ack: true,
  w9_status: "complete",
  ob_training_complete: true,
  payout_method_status: "verified",
  payout_method_code: "cash_app",
};
check("a verified manual method finishes the payout step", isPayoutSetupStarted(manualDone), true);
check("and the rest of setup can be complete without a Stripe account", isCleanerSetupComplete(manualDone), true);
check("and they can be offered a first job", isCleanerReadyForFirstJob(manualDone), true);
check("stripe columns are not cleared when a manual method is verified", Object.keys(cleanerPatchForVerifiedManual("cash_app")).includes("stripe_account_id"), false);
check("someone stalled on the payout step is counted", isStalledAtPayoutStep({
  ob_agreement_signed: true,
  phone_verified: true,
  supply_checklist_submitted_at: "2026-10-01",
  ob_dress_code_ack: true,
  ob_job_day_guides_ack: true,
  w9_status: "complete",
}), true);

console.log("\nVerification and change protection");
const issued = issueVerificationCode(new Date("2026-10-15T12:00:00.000Z"));
check("the code confirms", verificationCodeMatches({ ...issued, code: issued.code, now: new Date("2026-10-15T12:05:00.000Z") }), true);
check("a wrong code does not", verificationCodeMatches({ ...issued, code: "000000", now: new Date("2026-10-15T12:05:00.000Z") }), false);
check("an expired code does not", verificationCodeMatches({ ...issued, code: issued.code, now: new Date("2026-10-15T13:00:00.000Z") }), false);
const changeNotice = detailChangeNotice("Ada");
check("a change notice does not include the identifier", changeNotice.text.includes("$ada"), false);
check("notices come from NVC Operations", changeNotice.from, CONTRACTOR_OPS_FROM);
check("the one-time options note is not sent on its own", canSendExistingOptionsNotice(false, false).ok, false);
check("an admin can send it once", canSendExistingOptionsNotice(false, true).ok, true);
check("it is not sent a second time", canSendExistingOptionsNotice(true, true).ok, false);
const options = existingStripeOptionsNotice("Ada", "https://contractor.novaracleaning.com/cleaner/profile");
check("the options note names Cash App, Zelle, and Chime", ["Cash App", "Zelle", "Chime"].every((name) => options.text.includes(name)), true);

console.log("\nPay run");
const ada = contractor({ cleanerId: "ada", name: "Ada Lovelace" });
const grace = contractor({
  cleanerId: "grace",
  name: "Grace Hopper",
  methodCode: "zelle",
  identifier: "grace@example.com",
  w9OnFile: false,
  w9LegalName: null,
});
const linus = contractor({
  cleanerId: "linus",
  name: "Linus Torvalds",
  methodStatus: "pending",
  identifier: null,
});
const held = contractor({ cleanerId: "held", name: "Held Person", methodStatus: "on_hold" });
const stripePerson = contractor({
  cleanerId: "stripe",
  name: "Stripe Person",
  methodCode: "stripe",
  methodKind: "stripe",
  methodStatus: "verified",
  identifier: null,
});
const departed = contractor({
  cleanerId: "departed",
  name: "Dee Parted",
  engagementStatus: "terminated",
  identifier: "$dee",
  w9LegalName: "Dee Parted",
});
const recent = contractor({
  cleanerId: "recent",
  name: "Ren Cent",
  identifier: "$ren",
  w9LegalName: "Ren Cent",
  detailsChangedAt: "2026-10-14T18:00:00.000Z",
});
const earnings: PayEarning[] = [
  earning({ id: "manual:1", cleanerId: "ada", amountCents: 5000, jobId: "J-10" }),
  earning({ id: "adjust:1", cleanerId: "ada", amountCents: 500, kind: "adjustment", reason: "Duplicate job", section: OVERPAYMENT_SECTION, jobId: null }),
  earning({ id: "manual:2", cleanerId: "grace", amountCents: 4000 }),
  earning({ id: "manual:3", cleanerId: "linus", amountCents: 3000 }),
  earning({ id: "manual:4", cleanerId: "held", amountCents: 2000 }),
  earning({ id: "manual:5", cleanerId: "stripe", amountCents: 9000 }),
  earning({ id: "manual:6", cleanerId: "departed", amountCents: 2500, jobId: "J-20" }),
  earning({ id: "manual:7", cleanerId: "recent", amountCents: 1500, approvedAt: "2026-10-14T20:00:00.000Z" }),
  earning({ id: "manual:8", cleanerId: "ada", amountCents: 1000, status: "hold", jobId: "J-hold" }),
];
const built = assemblePayRun({
  payRunAt: "2026-10-15T15:00:00.000Z",
  holdHours: 48,
  contractors: [ada, grace, linus, held, stripePerson, departed, recent, contractor({
    cleanerId: "zora",
    name: "Zora Neale",
    methodCode: "zelle",
    identifier: "zora@example.com",
    w9LegalName: "Zora Neale",
  })],
  earnings: [...earnings, earning({ id: "manual:z", cleanerId: "zora", amountCents: 2200, jobId: "J-30" })],
  claimedEarningIds: [],
});
check("stripe earnings are not in the manual run", built.lines.some((line) => line.cleanerId === "stripe"), false);
check("lines are grouped by method", built.groups.map((group) => group.methodCode), ["cash_app", "zelle"]);
check("ada's line deducts the overpayment", built.lines.find((line) => line.cleanerId === "ada")?.amountDueCents, 4500);
check("the overpayment shows as a section 7.9 adjustment", built.lines.find((line) => line.cleanerId === "ada")?.earnings.some((row) => row.section === "7.9"), true);
check("first payment is flagged", built.lines.find((line) => line.cleanerId === "ada")?.firstPayment, true);
check("a recent change is held", built.lines.find((line) => line.cleanerId === "recent")?.recentChangeHold, true);
check("a terminated contractor's remaining earnings are in the run", built.lines.some((line) => line.cleanerId === "departed"), true);
const reasons = built.cannotPay.map((row) => `${row.cleanerId}:${row.reason}`).sort();
check("people who cannot be paid are listed with a reason", reasons, [
  "ada:earning_on_hold",
  "grace:missing_w9",
  "held:on_hold",
  "linus:unverified_details",
].sort());
const claimed = assemblePayRun({
  payRunAt: "2026-10-15T15:00:00.000Z",
  holdHours: 48,
  contractors: [ada],
  earnings: [earning({ id: "manual:1", cleanerId: "ada", amountCents: 5000 })],
  claimedEarningIds: ["manual:1"],
});
check("an earning already in a run is not listed again", claimed.lines.length, 0);

console.log("\nMarking paid, failed, and reopened");
const adaLine = built.lines.find((line) => line.cleanerId === "ada")!;
const blockedName = applyPaid(adaLine, {
  now: "2026-10-15T16:00:00.000Z",
  actorId: "admin",
  amountSentCents: 4500,
  recipientName: "Someone Else",
  mismatchNote: null,
  differenceReason: null,
  confirmationRef: null,
  holdReleased: false,
  w9OnFile: true,
  countsTowardOwn1099: false,
  existingLedgerId: null,
  alreadyPaid: false,
});
check("a first payment whose name misses the W-9 cannot be marked paid", blockedName.ok, false);
check("that line is flagged", blockedName.ok === false && blockedName.flags.includes("name_mismatch"), true);
const noted = applyPaid(adaLine, {
  now: "2026-10-15T16:00:00.000Z",
  actorId: "admin",
  amountSentCents: 4000,
  recipientName: "Someone Else",
  mismatchNote: "Paid the household account on purpose",
  differenceReason: null,
  confirmationRef: null,
  holdReleased: false,
  w9OnFile: true,
  countsTowardOwn1099: false,
  existingLedgerId: null,
  alreadyPaid: false,
});
check("a different amount without a reason is refused", noted.ok, false);
const paid = applyPaid(adaLine, {
  now: "2026-10-15T16:00:00.000Z",
  actorId: "admin",
  amountSentCents: 4000,
  recipientName: "Ada Lovelace",
  mismatchNote: null,
  differenceReason: "Bank limit, remainder next run",
  confirmationRef: "CA-100",
  holdReleased: false,
  w9OnFile: true,
  countsTowardOwn1099: true,
  existingLedgerId: null,
  alreadyPaid: false,
});
check("a matching name and a reason records one ledger row", paid.ok && paid.ok && paid.ledger.created, true);
check("the difference stays on the record", paid.ok && paid.ledger.differenceCents, -500);
const again = applyPaid(adaLine, {
  now: "2026-10-15T17:00:00.000Z",
  actorId: "admin",
  amountSentCents: 4000,
  recipientName: "Ada Lovelace",
  mismatchNote: null,
  differenceReason: "Bank limit, remainder next run",
  confirmationRef: "CA-100",
  holdReleased: false,
  w9OnFile: true,
  countsTowardOwn1099: true,
  existingLedgerId: paid.ok ? paid.ledger.id : null,
  alreadyPaid: true,
});
check("paying the same line again does not create a second record", again.ok && again.ledger.created === false && again.ledger.id, paid.ok ? paid.ledger.id : "");
const recentLine = built.lines.find((line) => line.cleanerId === "recent")!;
const heldPay = applyPaid(recentLine, {
  now: "2026-10-15T16:00:00.000Z",
  actorId: "admin",
  amountSentCents: 1500,
  recipientName: "Ren Cent",
  mismatchNote: null,
  differenceReason: null,
  confirmationRef: null,
  holdReleased: false,
  w9OnFile: true,
  countsTowardOwn1099: null,
  existingLedgerId: null,
  alreadyPaid: false,
});
check("earnings inside the change window stay held", heldPay.ok, false);
const noW9 = applyPaid(adaLine, {
  now: "2026-10-15T16:00:00.000Z",
  actorId: "admin",
  amountSentCents: 4500,
  recipientName: "Ada Lovelace",
  mismatchNote: null,
  differenceReason: null,
  confirmationRef: null,
  holdReleased: true,
  w9OnFile: false,
  countsTowardOwn1099: null,
  existingLedgerId: null,
  alreadyPaid: false,
});
check("no payout without a W-9", noW9.ok, false);
const failed = applyFailed(adaLine, { reason: "Wrong Cashtag" });
check("a failure returns the earnings to unpaid", failed.ok && failed.releasedEarningIds.includes("manual:1"), true);
const failNotice = paymentFailedNotice("Ada");
check("a failure asks them to confirm details", failNotice.text.toLowerCase().includes("confirm"), true);
check("and does not include the identifier", failNotice.text.includes("$ada"), false);

console.log("\nNotices and payment summary");
const summary = buildPaymentSummary({
  contractorName: "Ada Lovelace",
  methodName: "Cash App",
  paidOn: "2026-10-15",
  jobs: [{ jobId: "J-10", jobDate: "2026-10-01", grossCents: 5000 }],
  adjustments: [{ reason: "Duplicate job", amountCents: 500, section: OVERPAYMENT_SECTION }],
  netCents: 4000,
});
check("the summary is titled Payment Summary", summary.title, PAYMENT_SUMMARY_TITLE);
check("it states no taxes were withheld", summary.text.includes(NO_TAX_WITHHELD), true);
check("it uses contractor language", summary.problems, []);
check("employment wording is caught", paymentSummaryProblems("Pay stub for an employee").includes("employment_wording") || paymentSummaryProblems("Pay stub for an employee").includes("says_pay_stub"), true);
const paidMessage = paidNotice({
  firstName: "Ada",
  amountCents: 4000,
  methodName: "Cash App",
  paidOn: "2026-10-15",
  jobs: [{ jobId: "J-10", jobDate: "2026-10-01" }],
  summaryUrl: "https://contractor.novaracleaning.com/cleaner/payment-summary/line-1",
});
check("the paid notice names the amount, method, date, and job", ["$40.00", "Cash App", "2026-10-15", "J-10"].every((part) => paidMessage.text.includes(part)), true);
check("the paid notice leaves the identifier out", paidMessage.text.includes("$ada"), false);
check("the paid notice is from NVC Operations", paidMessage.from, CONTRACTOR_OPS_FROM);

console.log("\nMasking");
check("a cashtag is masked", maskPayoutIdentifier("$adachime").includes("$ada"), false);
check("logs drop the identifier", JSON.stringify(payoutSafeRecord({ identifier: "$adachime", amountCents: 4000 })).includes("$adachime"), false);
check("exports and prompts drop it too", forAiPrompt("Pay $adachime today", ["$adachime"]).includes("$adachime"), false);
check("dispute-style text drops a $ChimeSign", redactPayoutIdentifiers("Sent to $adachime").includes("$adachime"), false);
const dispute = readFileSync("supabase/functions/_shared/dispute-evidence/build.ts", "utf8");
check("dispute packets scrub payout identifiers", dispute.includes("[payout id removed]"), true);

console.log("\n1099 flags and departure");
const changed = applySettingsChange(settings, {
  methods: settings.methods.map((m) => m.code === "cash_app" ? { ...m, countsTowardOwn1099: false } : m.code === "zelle" ? { ...m, countsTowardOwn1099: true } : m),
}, "2026-10-16T00:00:00.000Z");
check("changing a setting does not rewrite ledger rows", changed.ledgerUpdates, []);
check("an unset flag is not guessed", necInclusion({ methodCode: "chime", countsTowardOwn1099: null }), "unresolved");
check("a legacy row with no method still counts", necInclusion({}), "legacy");
const nec = jobPayFromLedgers({
  cleanerId: "ada",
  year: 2026,
  payouts: [
    { cleanerId: "ada", amountCents: 1000, status: "paid", paidAt: "2026-05-01", methodCode: "cash_app", countsTowardOwn1099: false },
    { cleanerId: "ada", amountCents: 2000, status: "paid", paidAt: "2026-06-01", methodCode: "zelle", countsTowardOwn1099: true },
    { cleanerId: "ada", amountCents: 4000, status: "paid", paidAt: "2026-04-01" },
    { cleanerId: "ada", amountCents: 8000, amountSentCents: 7000, status: "paid", paidAt: "2026-07-01", methodCode: "chime", countsTowardOwn1099: null },
  ],
  extras: [],
});
check("the flag includes, excludes, and refuses to guess", { included: nec.jobPayCents, unresolved: nec.unresolvedCents }, { included: 6000, unresolved: 7000 });
check("the amount actually sent is what counts", nec.unresolvedCents, 7000);
check("a terminated manual contractor is paid on the next pay run", finalPayDestination(departed), "pay_run");
check("stripe final pay stays automatic", finalPayDestination(stripePerson), "stripe");
const old = agedEarnings([
  earning({ id: "old", cleanerId: "ada", amountCents: 100, approvedAt: "2026-09-01T00:00:00.000Z" }),
], 10, "2026-10-15T00:00:00.000Z");
check("earnings unpaid past the aging threshold raise an alert", agingAlert(old.length, 10)?.urgent, true);
check("names that don't match are not close enough", namesReasonablyMatch("Ada Lovelace", "Grace Hopper"), false);
check("the same person matches", namesReasonablyMatch("Ada Lovelace", "ADA LOVELACE"), true);

const report = payoutMethodReport([
  { name: "Ada", methodCode: "cash_app", methodStatus: "verified", stalledAtPayout: false },
  { name: "Grace", methodCode: null, methodStatus: null, stalledAtPayout: true },
]);
check("the report counts methods, missing methods, and stalls", report, {
  byMethod: [{ methodCode: "cash_app", count: 1 }],
  noCompleteMethod: ["Grace"],
  stalledAtPayout: 1,
});
check("monthly totals have no identifiers", monthlyTotalsByMethod([
  { methodCode: "cash_app", amountCents: 4000, paidAt: "2026-10-15" },
  { methodCode: "zelle", amountCents: 2000, paidAt: "2026-10-02" },
  { methodCode: "cash_app", amountCents: 100, paidAt: "2026-09-30" },
], "2026-10"), [
  { methodCode: "cash_app", amountCents: 4000, count: 1 },
  { methodCode: "zelle", amountCents: 2000, count: 1 },
]);

const portal = readFileSync("src/views/cleaner/OnboardingPortal.tsx", "utf8");
const step = readFileSync("src/components/cleaner/PayoutMethodStep.tsx", "utf8");
check("the portal step asks how they want to be paid", portal.includes("How would you like to get paid?"), true);
check("the chooser keeps the Stripe button", step.includes("Set up Stripe payouts"), true);
check("the chooser asks for the identifier twice", step.includes("Enter it again"), true);
check("the summary page is titled Payment Summary", readFileSync("src/app/cleaner/payment-summary/[id]/page.tsx", "utf8").includes("PAYMENT_SUMMARY_TITLE"), true);

if (failures) {
  console.error(`\n${failures} payout-method check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("\nAll payout-method checks passed.");
