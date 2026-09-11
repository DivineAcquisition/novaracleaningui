// Policy tests for the tokenized contractor statement form.
// No network. Statement non-response must never look like a penalty.
import {
  DEFAULT_QC_STATEMENT_SETTINGS,
  EMPTY_QC_STATEMENT_DRAFT,
  QC_STATEMENT_OVERDUE_FORBIDDEN,
  deriveIssueStatementStatus,
  factualReportSummary,
  formatDueBy,
  generalLocation,
  normalizeQcStatementDraft,
  parseQcStatementSettings,
  qcStatementDraftComplete,
  qcStatementLink,
  reminderAt,
  statementKindForIssue,
  statementMessageImpliesConclusion,
  statementMessageLeaksAllegation,
  statementRequiredByDefault,
  statementSmsMessage,
  statementSweepAction,
} from "../supabase/functions/_shared/qc-statement.ts";
import { saveThenGeneratePdf } from "../src/lib/qc-statement-pdf.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(statementRequiredByDefault("serious_allegation", "critical") === true,
  "incident/allegation defaults to statement required");
assert(statementRequiredByDefault("damage", "medium") === true,
  "property damage defaults to statement required");
assert(statementRequiredByDefault("conduct", "low") === true,
  "conduct complaint defaults to statement required");
assert(statementRequiredByDefault("complaint", "critical") === true,
  "highest severity defaults to statement required even on a complaint");
assert(statementRequiredByDefault("complaint", "medium") === false,
  "routine quality complaint does not default to required");
assert(statementRequiredByDefault("quality_flag", "high") === false,
  "high (not critical) quality flag does not default to required");

const settings = parseQcStatementSettings({
  due_hours: 48,
  reminder_hours_before: 24,
  required_issue_types: ["serious_allegation"],
  required_severities: ["critical"],
});
assert(settings.due_hours === 48 && settings.reminder_hours_before === 24, "admin-configurable due/reminder defaults");
assert(parseQcStatementSettings({ reminder_hours_before: 72, due_hours: 48 }).reminder_hours_before < 48,
  "reminder is clamped to before the due date");

const sms = statementSmsMessage({
  firstName: "Ivy",
  generalLocation: "Waldorf, MD",
  serviceDate: "September 9, 2026",
  dueBy: "Thu, Sep 11, 2026, 1:00 PM EDT",
  link: qcStatementLink("abc"),
});
assert(sms.includes("Ivy") && sms.includes("Waldorf, MD") && sms.includes("September 9, 2026"),
  "request names the contractor, general location, and date");
assert(sms.toLowerCase().includes("before we review") && sms.toLowerCase().includes("your side in writing"),
  "request is an opportunity to respond, not a verdict");
assert(!statementMessageImpliesConclusion(sms), "request SMS never implies a conclusion");
const report = "the client reported that Kevin the dog was injured by kicking during this visit";
assert(!statementMessageLeaksAllegation(sms, report), "SMS does not state the allegation substance");
assert(sms.includes("https://contractor.novaracleaning.com/cleaner/statement/abc"), "SMS carries the tokenized link");

const reminder = statementSmsMessage({
  firstName: "Ivy",
  generalLocation: "Waldorf, MD",
  serviceDate: "September 9, 2026",
  dueBy: "Thu, Sep 11, 2026, 1:00 PM EDT",
  link: "https://contractor.novaracleaning.com/cleaner/statement/abc",
  reminder: true,
});
assert(reminder.toLowerCase().includes("reminder") && !statementMessageImpliesConclusion(reminder),
  "reminder stays neutral");

assert(generalLocation("Waldorf", "MD") === "Waldorf, MD", "general location is city/state, not a street");
assert(factualReportSummary({ description: "A pet was injured." }).includes("the following occurred"),
  "form page states the report factually");

const incomplete = normalizeQcStatementDraft({});
assert(qcStatementDraftComplete(incomplete) === false, "empty draft is incomplete");
const complete = normalizeQcStatementDraft({
  account: "I arrived and cleaned as scheduled.",
  arrived: "12:10",
  started: "12:20",
  left: "15:40",
  reportResponse: "I did not injure any pet. I never saw a dog.",
  othersPresent: "The client was home.",
  attestationName: "Ivy Smith",
  attested: true,
});
assert(qcStatementDraftComplete(complete) === true, "complete draft requires account, timeline, response, presence, attestation");
assert(statementKindForIssue(0) === "original" && statementKindForIssue(1) === "supplemental",
  "a second form on the same case is supplemental");

assert(deriveIssueStatementStatus({ submissionCount: 1, openRequested: true, notProvided: true }) === "submitted",
  "a submitted statement wins over not-provided / open request");
assert(deriveIssueStatementStatus({ submissionCount: 0, openRequested: false, notProvided: true }) === "not_provided",
  "overdue with no submission is not_provided");
assert(deriveIssueStatementStatus({ required: true, submissionCount: 0, openRequested: true, notProvided: false }) === "requested",
  "open request is requested");

const due = new Date("2026-09-12T17:00:00Z");
const nowBefore = new Date("2026-09-11T17:30:00Z");
assert(statementSweepAction({
  status: "requested", dueAt: due, reminderHoursBefore: 24, now: nowBefore,
}) === "remind", "reminder fires 24h before due");
assert(statementSweepAction({
  status: "requested", dueAt: due, reminderHoursBefore: 24,
  now: new Date("2026-09-11T16:00:00Z"),
}) === "none", "reminder does not fire more than 24h before due");
assert(statementSweepAction({
  status: "requested", dueAt: due, reminderSentAt: nowBefore.toISOString(), reminderHoursBefore: 24,
  now: new Date("2026-09-11T18:00:00Z"),
}) === "none", "no second reminder");
assert(statementSweepAction({
  status: "requested", dueAt: due, reminderHoursBefore: 24, now: new Date("2026-09-12T18:00:00Z"),
}) === "mark_not_provided", "due date passed with no submission flags not provided");
assert(statementSweepAction({
  status: "requested", submittedAt: due.toISOString(), dueAt: due, reminderHoursBefore: 24,
  now: new Date("2026-09-13T00:00:00Z"),
}) === "none", "submitted requests are not flagged");

assert(QC_STATEMENT_OVERDUE_FORBIDDEN.tables.includes("cleaners"), "overdue must not write cleaners");
assert(QC_STATEMENT_OVERDUE_FORBIDDEN.tables.includes("accountability_actions"), "overdue must not write accountability");
assert(QC_STATEMENT_OVERDUE_FORBIDDEN.issueColumns.includes("status"), "overdue must not change qc_issues.status");
assert(QC_STATEMENT_OVERDUE_FORBIDDEN.scoreFields.length === 3, "overdue must not write score fields");

void DEFAULT_QC_STATEMENT_SETTINGS;
void EMPTY_QC_STATEMENT_DRAFT;
void formatDueBy;
void reminderAt;

async function main() {
  const pdfOk = await saveThenGeneratePdf({
    save: async () => ({ id: "stmt-1", account: complete.account }),
    generate: async () => undefined,
    onPdfFailure: async () => {
      throw new Error("onPdfFailure should not run");
    },
  });
  assert(pdfOk.pdfOk && pdfOk.saved.id === "stmt-1", "successful PDF still keeps the saved statement");

  let flagged = false;
  const pdfFail = await saveThenGeneratePdf({
    save: async () => ({ id: "stmt-2", account: complete.account, uploads: ["photo.jpg"] }),
    generate: async () => {
      throw new Error("simulated PDF generation failure");
    },
    onPdfFailure: async (saved) => {
      flagged = saved.id === "stmt-2";
    },
  });
  assert(pdfFail.pdfOk === false && pdfFail.saved.id === "stmt-2" && pdfFail.saved.uploads?.[0] === "photo.jpg" && flagged,
    "PDF failure leaves the statement and uploads intact and flags retry");

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    const exit = (globalThis as { Deno?: { exit: (n: number) => void }; process?: { exit: (n: number) => void } });
    (exit.Deno?.exit || exit.process?.exit || (() => undefined))(1);
  } else {
    console.log("\nall qc-statement assertions passed");
  }
}

void main();
