// Factual summary: escalated cases only, logged facts only, disclaimer always.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  FACTUAL_SUMMARY_DISCLAIMER,
  NO_DESCRIPTION,
  assembleFactualSummary,
  boilerplateAssertsFault,
  evidenceIndexLine,
  factualSummaryAvailable,
  formatUsdCents,
  insuranceIsComplete,
  normalizeInsurance,
  preserveCaseEntries,
  type FactualSummaryInput,
} from "../supabase/functions/_shared/qc-factual-summary.ts";
import { renderFactualSummaryPdf } from "../supabase/functions/_shared/qc-factual-summary-render.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(factualSummaryAvailable({ status: "investigating" }) === false, "routine investigating case cannot generate");
assert(factualSummaryAvailable({ status: "open" }) === false, "open case cannot generate");
assert(factualSummaryAvailable({ status: "resolved" }) === false, "resolved case cannot generate");
assert(factualSummaryAvailable({ status: "escalated" }) === true, "escalated case can generate");
assert(
  factualSummaryAvailable({ status: "investigating", escalation: { indicated: true } }) === true,
  "a logged legal-threat flag is enough",
);
assert(formatUsdCents(180028) === "$1,800.28", "invoice cents format exactly");
assert(insuranceIsComplete({ status: "pending" }) === false, "pending insurance is not complete");
assert(insuranceIsComplete(null) === false, "missing insurance is not complete");
assert(insuranceIsComplete({ status: "notified" }) === false, "notified without a date is not complete");
assert(
  insuranceIsComplete({ status: "notified", notified_at: "2026-09-22T15:00:00Z" }) === true,
  "notified with a stored date is complete",
);
assert(
  normalizeInsurance({ status: "notified", notified_at: null }).status === "pending",
  "normalize refuses notified with no date",
);

const sentinel = "UNIQUE_RECORD_BODY_SHOULD_NOT_APPEAR_IN_INDEX";
const line = evidenceIndexLine({
  kind: "veterinary_record",
  filename: "kevin broom.pdf",
  source: "provided by client",
  received_at: "2026-09-22T14:53:04Z",
  objective_description: "Veterinary record as received.",
  content: sentinel,
});
assert(line.includes("Veterinary record as received."), "index uses the logged description");
assert(!line.includes(sentinel), "index does not read the attachment body");
assert(
  evidenceIndexLine({ kind: "invoice" }).includes(NO_DESCRIPTION),
  "missing description stays a gap",
);
assert(
  evidenceIndexLine({ kind: "invoice", received_at: null }).includes("received date not stored"),
  "missing received date is not invented",
);

const base: FactualSummaryInput = {
  issueNumber: 42,
  bookingRef: "NVC-0101",
  title: "Serious allegation",
  status: "escalated",
  issueType: "serious_allegation",
  createdAt: "2026-09-11T18:00:00Z",
  events: [
    { created_at: "2026-09-11T18:00:00Z", action: "created", note: "Case opened for evidence assembly.", actor_name: "Malik Sannie" },
    { created_at: "2026-09-12T15:00:00Z", action: "note", note: "Manager account saved.", actor_name: "Malik Sannie" },
  ],
  managerAccount: "Called the client and the contractor the same afternoon.",
  contractorStatement: null,
  clientWrittenCommunication: "Original report text stays as logged.",
  correspondence: [
    {
      id: "ack",
      direction: "outbound",
      method: "email",
      at: "2026-09-11T16:49:31Z",
      subject: "Re: Incident Report",
      body: "Thank you for writing this out.",
    },
    {
      id: "claims",
      direction: "inbound",
      method: "email",
      at: null,
      subject: "Re: Incident Report",
      body: "Would you like to go to small claims court?",
    },
  ],
  documents: [
    {
      id: "vet",
      kind: "veterinary_record",
      filename: "kevin broom.pdf",
      source: "provided by client",
      received_at: "2026-09-22T14:53:04Z",
      objective_description: "Veterinary record as received.",
      content: sentinel,
    },
  ],
  statements: [
    { submitted_at: "2026-09-12T12:00:00Z", sequence: 1, kind: "original", text: "I did not strike the animal." },
  ],
  contractorPosition: {
    stance: "denies",
    subject: "striking the animal",
    changed: false,
    source: "prior written statement on file",
    summary: "Unchanged. Denies striking the animal, per the written statement already on file.",
  },
  clientPosition: {
    stance: "maintains_original_account",
    amended: false,
    withdrawn: false,
    summary: "Maintains the incident occurred as reported.",
  },
  medicalRecordReview: {
    confirmed: [{ finding: "Creatine Kinase 750 U/L, reference range 64-440.", basis: "Laboratory report." }],
    ruled_out: [{ finding: "Associated rib fracture", basis: "Radiology report: no evidence of associated rib fractures." }],
    not_established: [{ finding: "Cause of the swelling", basis: "Differentials listed. No specific cause or source." }],
  },
  escalation: {
    indicated: true,
    forum: "small_claims",
    demand_amount_cents: 180028,
    demand_currency: "USD",
    communicated_at: "2026-09-22T15:41:43Z",
    method: "email",
    summary: "Client wrote that small claims court is the next step.",
  },
  insurance: { status: "pending", notified_at: null, method: null, carrier_response: null },
  generatedAt: "2026-09-22T18:00:00Z",
};

const summary = assembleFactualSummary(base);
const datedLabels = summary.timelineDated.map((item) => `${item.at} ${item.label}`);
assert(datedLabels[0].includes("2026-09-11T16:49:31"), "timeline sorts by stored timestamp");
assert(datedLabels.some((l) => l.includes("Case opened") || l.includes("created")), "original report event is present");
assert(datedLabels.some((l) => l.includes("kevin broom.pdf")), "document attach date is the stored received time");
assert(datedLabels.some((l) => l.includes("Contractor statement submitted")), "statement submission is on the timeline");
assert(
  summary.timelineUndated.some((item) => item.label.includes("Manager account") && item.gapNote === "Timestamp not stored."),
  "manager account without a timestamp is an explicit gap",
);
assert(
  summary.timelineUndated.some((item) => item.label.includes("small claims") || summary.correspondence.some((c) => (c.body || "").includes("small claims"))),
  "undated correspondence is kept",
);
assert(!JSON.stringify(summary.evidence).includes(sentinel), "assembled index omits attachment body");
assert(JSON.stringify(summary.correspondence).includes("Thank you for writing this out."), "correspondence body is the logged text");
assert(summary.positions.some((s) => s.heading === "Contractor position" && s.lines.some((l) => l.includes("denies"))), "contractor position is the structured field");
assert(summary.positions.some((s) => s.lines.some((l) => l.includes("$1,800.28"))), "demand is the stored cents value");
assert(summary.positions.some((s) => s.heading === "Insurance carrier notification" && s.lines.includes("Status: pending")), "insurance stays pending");
assert(!summary.positions.some((s) => s.lines.some((l) => /status:\s*complete/i.test(l))), "insurance is never marked complete by default");
assert(summary.disclaimer === FACTUAL_SUMMARY_DISCLAIMER, "disclaimer is the standing text");
assert(boilerplateAssertsFault(summary) === null, "boilerplate does not assert fault");

const withoutContractor = assembleFactualSummary({ ...base, contractorPosition: null });
assert(
  !withoutContractor.positions.some((s) => s.heading === "Contractor position"),
  "removing the structured field removes it from the document",
);
assert(
  !withoutContractor.positions.some((s) => s.lines.some((l) => /denies striking/i.test(l))),
  "no freeform denial appears when the field is absent",
);

const preserved = preserveCaseEntries(
  [{ id: "vet", description: "full original", content: "UNTOUCHED" }],
  [{ id: "vet", description: "shortened" }, { id: "invoice", description: "new" }],
);
assert((preserved[0] as { content?: string }).content === "UNTOUCHED", "existing document entry is not overwritten");
assert(preserved.length === 2 && (preserved[1] as { id?: string }).id === "invoice", "new document is appended");

const advocacy = assembleFactualSummary({
  ...base,
  events: [{ created_at: "2026-09-11T18:00:00Z", action: "note", note: "The client wrote clearly the contractor is at fault.", actor_name: "Malik Sannie" }],
});
assert(boilerplateAssertsFault(advocacy) === null, "a logged phrase is not treated as generated advocacy");
assert(advocacy.timelineDated.some((item) => item.label.includes("at fault")), "logged wording is copied, not rewritten");

async function main() {
  const pdf = await renderFactualSummaryPdf({ PDFDocument, StandardFonts, rgb }, summary);
  const { writeFileSync } = await import("fs");
  const { execFileSync } = await import("child_process");
  writeFileSync("/tmp/factual-summary-test.pdf", pdf);
  const extracted = execFileSync("python3", ["-c", `
from pypdf import PdfReader
r = PdfReader("/tmp/factual-summary-test.pdf")
print("\\n".join((p.extract_text() or "") for p in r.pages))
`], { encoding: "utf8" });
  assert(extracted.includes("not a legal filing"), "PDF contains the disclaimer");
  assert(extracted.includes("does not constitute legal advice"), "PDF contains the legal-advice sentence");
  assert(extracted.includes("Factual Summary and Evidence Index"), "PDF uses the formal title");
  assert(!extracted.includes("NOVARA CLEANING"), "PDF does not use the consumer brand lockup");
  assert(extracted.split("not a legal filing").length > 2, "disclaimer is repeated, not only once");
  assert(pdf.byteLength > 1000, "PDF bytes were produced");

  const { readFileSync } = await import("fs");
  const { createHash } = await import("crypto");
  const sql = readFileSync(
    "supabase/migrations/20260922170000_qc_factual_summary_and_nvc0101_update.sql",
    "utf8",
  );
  const between = (tag: string) => {
    const marker = `$${tag}$`;
    const start = sql.indexOf(marker);
    const end = start < 0 ? -1 : sql.indexOf(marker, start + marker.length);
    assert(start >= 0 && end > start, `migration contains ${tag}`);
    return start < 0 || end < 0 ? "" : sql.slice(start + marker.length, end);
  };
  const recordPdf = Buffer.from(between("recordpdf"), "base64");
  const invoicePdf = Buffer.from(between("invoicepdf"), "base64");
  assert(recordPdf.subarray(0, 5).toString() === "%PDF-", "veterinary record bytes are the original PDF");
  assert(invoicePdf.subarray(0, 5).toString() === "%PDF-", "invoice bytes are the original PDF");
  assert(recordPdf.byteLength === 649837, "veterinary record is the full file");
  assert(invoicePdf.byteLength === 27848, "invoice is the full file");
  assert(
    createHash("sha256").update(recordPdf).digest("hex") === "78593935a4bb5952eb4162ecd7e5a6180bd09dc4350aa3a0d53d1d11858f4c32",
    "veterinary record hash matches the client file",
  );
  assert(
    createHash("sha256").update(invoicePdf).digest("hex") === "f0bf46076f24f8f54e42da70f6f6fae1e8dadf531134dee55c08a13080a05672",
    "invoice hash matches the client file",
  );
  assert(sql.includes("status = 'escalated'"), "case status is set to escalated");
  assert(sql.includes("180028"), "demand is the invoice total in cents");
  assert(sql.includes("$1,800.28"), "demand text uses the exact invoice total");
  assert(sql.includes("provided by client"), "documents are sourced as provided by the client");
  assert(sql.includes("2026-09-22T15:41:43Z"), "small-claims email timestamp is stored");
  assert(sql.includes("2026-09-22T14:53:04Z"), "records email timestamp is stored");
  assert(between("claimsbody").includes("Would you like to go to small claims court?"), "small-claims sentence is the email");
  assert(between("claimsbody").includes("\u2019"), "small-claims apostrophe is the original character");
  assert(between("recordsbody").includes("$1000"), "records email keeps the separate $1,000 request");
  assert(!between("recordsbody").includes("On Fri"), "records email body stops before the quoted thread");
  assert(between("ackbody").includes("notified our insurance carrier"), "acknowledgment keeps the carrier sentence in the email body");
  assert(sql.includes("'status', 'pending'"), "insurance is seeded pending");
  assert(!sql.includes("insurance_notified_at ="), "migration does not mark insurance notified");
  assert(!sql.includes("manager_account ="), "migration does not overwrite the manager account");
  assert(!sql.includes("contractor_statement ="), "migration does not overwrite the contractor statement");
  assert(!sql.includes("client_written_communication ="), "migration does not overwrite the client communication");
  assert(!sql.toLowerCase().includes("verbally"), "escalation is not logged as a verbal statement");
  assert(!sql.toLowerCase().includes("organ damage"), "review does not use a blanket organ-damage conclusion");
  assert(sql.includes("qc_issue_documents rows are immutable"), "attached originals cannot be updated or deleted");
  assert(sql.includes("ON CONFLICT (id) DO NOTHING"), "re-running the seed does not replace stored files");
  assert(sql.includes("nvc0101_records_escalation_20260922"), "escalation event is idempotent");

  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nall factual-summary assertions passed");
}

void main();
