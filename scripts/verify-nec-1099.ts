// Form 1099-NEC (Rev. December 2026): Copy B and Copy C, tips split from job pay.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  NEC_ELIGIBILITY_THRESHOLD_CENTS,
  NEC_FORM_REVISION,
  assembleNecForm,
  assignNecAmounts,
  box1dCents,
  box3Cents,
  combinedCompensationCents,
  copyAIsPrintable,
  correctionOf,
  efileRecord,
  jobPayFromLedgers,
  payoutShareCents,
  meetsNecThreshold,
  parseTtocSetting,
  printableCopy,
  stateLinesForForm,
  tipsFromLedger,
  ttocForTips,
  type Nec1099Form,
} from "../supabase/functions/_shared/nec-1099.ts";
import { renderNec1099Pdf } from "../supabase/functions/_shared/nec-1099-render.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

const CLEANER = "085d3e27-c421-4b1d-9280-c2eafe31d983";
const OTHER = "11111111-1111-1111-1111-111111111111";

const pay = jobPayFromLedgers({
  cleanerId: CLEANER,
  year: 2026,
  payouts: [
    {
      cleanerId: OTHER,
      amountCents: 99999,
      status: "paid",
      paidAt: "2026-06-01",
      breakdown: [
        { cleanerId: CLEANER, amountCents: 150000 },
        { cleanerId: OTHER, amountCents: 40000 },
      ],
    },
    { cleanerId: CLEANER, amountCents: 80000, status: "pending", paidAt: "2026-07-01", breakdown: [] },
    { cleanerId: CLEANER, amountCents: 70000, status: "paid", paidAt: "2025-12-31", breakdown: [] },
    { cleanerId: CLEANER, amountCents: 5000, status: "paid", paidAt: "2027-01-02", serviceDate: "2026-12-20", breakdown: [] },
  ],
  extras: [
    {
      status: "paid",
      paidAt: "2026-08-01",
      surgeCents: 20000,
      jobValueCents: 0,
      overtimeCents: 10000,
      supplyCents: 5000,
      mileageCents: 4000,
    },
    { status: "pending", paidAt: "2026-08-02", surgeCents: 90000, overtimeCents: 0, supplyCents: 0, mileageCents: 0 },
  ],
});

assert(pay.jobPayCents === 180000, "job pay is the ledger share plus compensation extras, not the other cleaner");
assert(pay.overtimeTrackedCents === 10000, "overtime dollars are tracked on the ledger");
assert(pay.reimbursementCents === 9000, "supply and mileage stay off job pay");
assert(pay.jobPayCents !== 180000 + 30000, "tips are not inside the job-pay total");
assert(
  payoutShareCents(
    { cleanerId: CLEANER, amountCents: 500000, breakdown: [{ cleanerId: OTHER, amountCents: 100 }] },
    CLEANER,
  ) === 0,
  "a crew total is not paid to someone the breakdown omits",
);

const tips = tipsFromLedger(
  [
    { amountCents: 30000, status: "received", createdAt: "2026-09-01" },
    { amountCents: 1000, status: "paid_out", createdAt: "2025-05-01" },
    { amountCents: 2000, status: "void", createdAt: "2026-05-01" },
  ],
  2026,
);
assert(tips === 30000, "tips come from cleaner_tips for the calendar year");
assert(combinedCompensationCents(pay.jobPayCents, tips) === 210000, "threshold basis is job pay plus tips");
assert(meetsNecThreshold(pay.jobPayCents, tips) === true, "combined total meets $2,000");
assert(meetsNecThreshold(190000, 9999) === false, "one cent under the threshold stays out");
assert(meetsNecThreshold(0, NEC_ELIGIBILITY_THRESHOLD_CENTS) === true, "tips alone can meet the threshold");
assert(NEC_ELIGIBILITY_THRESHOLD_CENTS === 200000, "threshold is $2,000");

const payer = {
  name: "NovaraCleaning LLC",
  tin: "123456789",
  street: "500 H Street NE",
  city: "Washington",
  state: "DC",
  zip: "20002",
  phone: "202-555-0100",
};
const recipient = {
  name: "Jane Contractor",
  tin: "123456789",
  tinType: "ssn" as const,
  street: "100 Main Street",
  city: "Washington",
  state: "dc",
  zip: "20001",
};

const unconfirmed = assignNecAmounts({
  jobPayCents: pay.jobPayCents,
  tipCents: tips,
  ttoc: parseTtocSetting({ codes: [], confirmed: false }),
});
assert(unconfirmed.ok === false && unconfirmed.ok === false && "reason" in unconfirmed && unconfirmed.reason === "ttoc_unconfirmed", "tips without a confirmed occupation code do not file");

const guessed = ttocForTips(parseTtocSetting({ codes: [], confirmed: true }), tips);
assert(guessed.ok === false, "an empty confirmed setting does not invent a code");

const amounts = assignNecAmounts({
  jobPayCents: pay.jobPayCents,
  tipCents: tips,
  ttoc: { codes: ["184"], confirmed: true },
  qualifiedOvertimePremiumCents: null,
  excessGoldenParachuteCents: null,
  federalWithheldCents: 0,
  stateLines: [
    { withheldCents: 0, state: "", payerStateId: "", incomeCents: 0 },
    { withheldCents: 1500, state: "DC", payerStateId: "99-123", incomeCents: 210000 },
    { withheldCents: 0, state: "MD", payerStateId: "55", incomeCents: null },
    { withheldCents: 100, state: "VA", payerStateId: "77", incomeCents: 100 },
  ],
});
assert(amounts.ok === true, "confirmed code allows the form");
if (amounts.ok) {
  assert(amounts.amounts.box1aCents === 210000, "box 1a includes job pay and tips once");
  assert(amounts.amounts.box1bCents === 30000, "box 1b is the tip amount");
  assert(amounts.amounts.box1aCents - (amounts.amounts.box1bCents || 0) === pay.jobPayCents, "tips are not counted twice");
  assert(amounts.amounts.combinedCents === amounts.amounts.box1aCents, "the threshold total is box 1a, not box 1a plus box 1b");
  assert(amounts.amounts.box1cCodes?.join(",") === "184", "box 1c is the saved code");
  assert(amounts.amounts.box1dCents === null, "box 1d stays blank when no qualified premium is recorded");
  assert(amounts.amounts.box3Cents === null, "box 3 stays blank");
  assert(amounts.amounts.box4Cents === null, "a zero withholding amount is blank");
  assert(amounts.amounts.stateLines.length === 2, "at most two real state entries");
  assert(amounts.amounts.stateLines[0]?.state === "DC", "a zero placeholder state line is dropped");
  assert(amounts.amounts.stateLines[1]?.state === "MD", "a state id without dollars still reports");
}

assert(box1dCents(0) === null, "overtime zero is not printed");
assert(box1dCents(10000) === 10000, "only an explicit qualified premium can fill box 1d");
assert(box3Cents(0) === null, "golden parachute zero is not printed");
assert(stateLinesForForm(null).length === 0, "missing state info is blank");

const noTips = assignNecAmounts({
  jobPayCents: 250000,
  tipCents: 0,
  ttoc: { codes: [], confirmed: false },
});
assert(noTips.ok === true && noTips.ok && noTips.amounts.box1bCents === null && noTips.amounts.box1cCodes === null, "box 1c stays empty when there are no tips");

const formResult = assembleNecForm({
  taxYear: 2026,
  corrected: false,
  correctsFormId: null,
  accountNumber: CLEANER,
  payer,
  recipient,
  jobPayCents: pay.jobPayCents,
  tipCents: tips,
  ttoc: { codes: ["184"], confirmed: true },
  stateLines: [{ withheldCents: 1500, state: "DC", payerStateId: "99-123", incomeCents: 210000 }],
});
assert(formResult.ok === true, "original form assembles");
if (!formResult.ok) {
  console.error(formResult);
  process.exit(1);
}
const original: Nec1099Form = formResult.form;
const before = JSON.stringify(original);
const corrected = correctionOf("original-id", {
  ...original,
  box1aCents: original.box1aCents,
});
assert(JSON.stringify(original) === before, "building a correction does not change the original");
assert(corrected.corrected === true && corrected.correctsFormId === "original-id", "correction is linked");
assert(original.corrected === false && original.correctsFormId === null, "original stays unchecked and unlinked");

const low = assembleNecForm({
  taxYear: 2026,
  corrected: false,
  correctsFormId: null,
  accountNumber: CLEANER,
  payer,
  recipient,
  jobPayCents: 1000,
  tipCents: 0,
  ttoc: { codes: [], confirmed: false },
});
assert(low.ok === false && "reason" in low && low.reason === "below_threshold", "under the threshold does not generate");

const retyped = assembleNecForm({
  taxYear: 2026,
  corrected: false,
  correctsFormId: null,
  accountNumber: CLEANER,
  payer,
  recipient: { name: "", tin: "", tinType: "ssn", street: "", city: "", state: "", zip: "" },
  jobPayCents: 250000,
  tipCents: 0,
  ttoc: { codes: [], confirmed: false },
});
assert(retyped.ok === false && "reason" in retyped && retyped.reason === "w9_required", "a blank recipient is not invented");

const efile = efileRecord(original);
assert(efile.pdf === null, "Copy A carries no PDF");
assert(efile.box1aCents === original.box1aCents && efile.box1bCents === original.box1bCents, "e-file uses the same amounts");
assert(copyAIsPrintable() === false, "Copy A is not printable");
assert(printableCopy("A") === null && printableCopy("B") === "B" && printableCopy("C") === "C", "only B and C print");

const logic = readFileSync("supabase/functions/_shared/nec-1099.ts", "utf8");
const renderSrc = readFileSync("supabase/functions/_shared/nec-1099-render.ts", "utf8");
const edge = readFileSync("supabase/functions/nec-1099/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260922203000_nec_1099_copy_b_c.sql", "utf8");
assert(!/=\s*["']000["']/.test(logic) && !/\["000"\]/.test(logic), "occupation code 000 is not a default");
assert(!/5[Cc]0[Ff][Ff][Ee]|drawImage|NOVARA CLEANING/.test(renderSrc), "the form renderer has no brand lockup");
assert(!/Novara/.test(renderSrc), "the payer name is data, not baked into the layout");
assert(!edge.includes('.from("nec_1099_forms").update') && !edge.includes(".from('nec_1099_forms').update"), "filed rows are not updated");
assert(!edge.includes("copy_a"), "no Copy A PDF column is written");
assert(edge.includes("qualifiedOvertimePremiumCents: null"), "the loader does not guess box 1d");
assert(edge.includes("excessGoldenParachuteCents: null"), "the loader leaves box 3 empty");
assert(migration.includes("nec_1099_forms rows are immutable"), "corrections cannot overwrite the original");
assert(migration.includes("BEFORE UPDATE OR DELETE"), "update and delete are rejected");
assert(migration.includes("box_1a_cents = job_pay_cents + tip_cents"), "stored box 1a includes tips once");
assert(!migration.includes("copy_a"), "the table has no printable Copy A");
assert(migration.includes("'confirmed', false"), "the occupation code is unconfirmed until an admin saves one");

async function main() {
  let threw = false;
  try {
    await renderNec1099Pdf({ PDFDocument, StandardFonts, rgb }, original, "A");
  } catch (err) {
    threw = /not generated as a PDF/i.test(String(err));
  }
  assert(threw, "asking for Copy A throws instead of writing a PDF");

  const copyB = await renderNec1099Pdf({ PDFDocument, StandardFonts, rgb }, original, "B");
  const copyC = await renderNec1099Pdf({ PDFDocument, StandardFonts, rgb }, original, "C");
  const correctedPdf = await renderNec1099Pdf(
    { PDFDocument, StandardFonts, rgb },
    { ...corrected, correctsFormId: "original-id" },
    "B",
  );
  writeFileSync("/tmp/nec-1099-b.pdf", copyB);
  writeFileSync("/tmp/nec-1099-c.pdf", copyC);
  writeFileSync("/tmp/nec-1099-corrected.pdf", correctedPdf);

  const extract = (path: string) =>
    execFileSync("python3", ["-c", `from pypdf import PdfReader\nprint("\\n".join((p.extract_text() or "") for p in PdfReader(${JSON.stringify(path)}).pages))`], {
      encoding: "utf8",
    });
  const textB = extract("/tmp/nec-1099-b.pdf");
  const textC = extract("/tmp/nec-1099-c.pdf");
  const textX = extract("/tmp/nec-1099-corrected.pdf");
  const normalize = (text: string) => text.replaceAll("Copy B", "COPY").replaceAll("Copy C", "COPY").replaceAll("For Recipient", "AUDIENCE").replaceAll("For Payer", "AUDIENCE");
  assert(normalize(textB) === normalize(textC), "Copy B and Copy C carry the same figures");
  assert(textB.includes("Form 1099-NEC"), "the form is titled 1099-NEC");
  assert(textB.includes(NEC_FORM_REVISION), "the revision is December 2026");
  assert(textB.includes("Calendar year 2026"), "the calendar year is on the form");
  assert(textB.includes("Copy B") && textB.includes("For Recipient"), "Copy B is labeled for the recipient");
  assert(textC.includes("Copy C") && textC.includes("For Payer"), "Copy C is labeled for the payer");
  assert(textB.includes("1a Nonemployee compensation") && textB.includes("$2,100.00"), "box 1a shows the combined amount");
  assert(textB.includes("1b Cash tips") && textB.includes("$300.00"), "box 1b shows the tips");
  assert(textB.includes("1c Treasury Tipped Occupation Code(s)") && textB.includes("184"), "box 1c shows the configured code");
  assert(textB.includes("1d Overtime compensation"), "box 1d is labeled");
  assert(!textB.includes("$100.00") && !textB.includes("$0.00"), "overtime and empty boxes are not filled with a dollar amount");
  assert(textB.includes("3 Excess golden parachute payments"), "box 3 is labeled");
  assert(textB.includes("Payer's street address") && textB.includes("500 H Street NE"), "payer street is its own field");
  assert(textB.includes("Payer's city") && textB.includes("Payer's state") && textB.includes("Payer's ZIP code"), "payer city, state, and ZIP are separate");
  assert(textB.includes("Recipient's name") && textB.includes("Jane Contractor"), "recipient name comes from the W-9");
  assert(textB.includes("123-45-6789"), "recipient TIN is the validated number");
  assert(textB.includes("12-3456789"), "payer TIN is the EIN");
  assert(textB.includes(CLEANER), "account number is the contractor id");
  assert(textB.includes("DC") && textB.includes("99-123") && textB.includes("$15.00"), "a real state line is printed");
  assert(textB.includes("CORRECTED [ ]"), "an original filing leaves Corrected unchecked");
  assert(textX.includes("CORRECTED [X]"), "a corrected filing checks Corrected");
  assert(textB.includes("included in box 1a"), "the form tells the recipient that tips sit inside box 1a");
  assert(textB.includes("Copy A is filed electronically"), "Copy A is described as electronic, not printed");
  assert(!/5[Cc]0[Ff][Ff][Ee]/.test(textB), "the page has no brand color");

  if (failed) {
    console.error(`\n${failed} failed`);
    process.exit(1);
  }
  console.log("\n1099-NEC checks passed");
}

void main();
