import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  NOT_RECORDED,
  buildDisputeEvidence,
  packetContains,
  policyFieldFor,
  reminderLevel,
  type EvidenceMessage,
} from "../supabase/functions/_shared/dispute-evidence/build.ts";
import { STRIPE_EVIDENCE_LIMITS } from "../supabase/functions/_shared/dispute-evidence/limits.ts";
import { renderEvidenceSet, validateRendered } from "../supabase/functions/_shared/dispute-evidence/render.ts";
import { submitDisputeEvidence } from "../supabase/functions/_shared/dispute-evidence/submit.ts";
import {
  chargeReadiness,
  fingerprintPiece,
  otherEvidenceLines,
  preparePiece,
  readinessShare,
  type FrozenPiece,
} from "../supabase/functions/_shared/dispute-evidence/prep.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else console.log("ok  ", msg);
}

const lib = { PDFDocument, StandardFonts, rgb };

const complaint: EvidenceMessage = {
  id: "m1",
  at: "2026-09-10T21:03:51Z",
  direction: "customer",
  channel: "sms",
  body: "I am aware of the checklist. It was not followed and we are not satisfied.",
  source: "ghl:m1",
};
const offer: EvidenceMessage = {
  id: "m2",
  at: "2026-09-10T21:17:14Z",
  direction: "novara",
  channel: "sms",
  body: "We are going to schedule a re-clean for these specific areas.",
  source: "ghl:m2",
};
const refund: EvidenceMessage = {
  id: "m3",
  at: "2026-09-10T21:18:34Z",
  direction: "customer",
  channel: "sms",
  body: "We would prefer a refund",
  source: "ghl:m3",
};
const call: EvidenceMessage = {
  id: "c1",
  at: "2026-09-09T17:29:25Z",
  direction: "novara",
  channel: "call",
  durationSeconds: 392,
  callStatus: "completed",
  source: "ghl:c1",
};
const routine: EvidenceMessage = {
  id: "r1",
  at: "2026-09-05T18:52:18Z",
  direction: "novara",
  channel: "sms",
  body: "Hi Ben, your referral link is ready.",
  source: "ghl:r1",
};

const set = buildDisputeEvidence({
  disputeId: "du_test",
  reason: "product_unacceptable",
  evidenceDueAt: "2026-10-04T00:00:00Z",
  now: "2026-10-02T12:00:00Z",
  bookingRef: "NVC-0104",
  customerName: "Ben",
  customerEmail: "bostrow11@gmail.com",
  billingAddress: "301 Warren Avenue, Baltimore, MD 21230",
  serviceDescription: "Standard clean",
  serviceDate: "2026-09-10",
  purchaseIp: null,
  checklistCompleted: 32,
  checklistTotal: 32,
  photos: [{ label: "Before 1" }],
  remedy: { offered: "complimentary re-clean", offeredAt: "2026-09-10T21:17:14Z", customerResponse: "We would prefer a refund" },
  messages: [routine, call, complaint, offer, refund],
  acceptance: {
    signerName: "Benjamin Ostrow",
    email: "bostrow11@gmail.com",
    signedAt: "2026-09-05T18:51:38Z",
    ip: null,
    userAgent: "Deno/2.1.4",
    agreementName: "One-Time Service Agreement",
    agreementVersion: "2026-06",
    documentId: "870657e3",
    amountLabel: "$155.10",
    depositLabel: "$77.55 deposit",
    relationship: "residential",
    acknowledgments: [
      { label: "Terms of Service", accepted: true },
      { label: "Refund Policy", accepted: true },
    ],
  },
  charges: [
    { label: "Deposit", amountCents: 7755, paymentIntentId: "pi_deposit", kind: "deposit" },
    { label: "Balance", amountCents: 7755, paymentIntentId: "pi_balance", kind: "balance" },
  ],
  disputedAmountCents: 7755,
  redact: { names: ["Kyonta Terry"], phones: ["4105551212"] },
});

assert(set.packets.map((p) => p.id).join(",") === "completion,communication,acceptance,policy,receipt", "quality dispute builds the ordered set including a receipt when charges differ");
assert(set.policyField === "refund_policy", "product unacceptable routes the policy file to refund_policy");
assert(policyFieldFor("subscription_canceled") === "cancellation_policy", "canceled subscription routes to cancellation policy");
assert(policyFieldFor("credit_not_processed") === "refund_policy", "credit not processed routes to refund policy");
assert(policyFieldFor("duplicate") === null, "duplicate does not attach a policy file by default");
assert(set.reminder === "reminder", "inside 48 hours is a reminder");
assert(reminderLevel("2026-10-02T18:00:00Z", "2026-10-02T12:00:00Z") === "urgent", "inside 24 hours is urgent");
assert(set.missing.includes("purchase IP"), "missing IP is flagged");
assert(set.missing.includes("customer device"), "server runtime is not treated as the customer device");
assert(packetContains(set, NOT_RECORDED), "missing values are written as not recorded");
assert(packetContains(set, "I am aware of the checklist. It was not followed and we are not satisfied."), "unfavorable complaint is quoted verbatim");
assert(packetContains(set, "We would prefer a refund"), "customer refund reply is quoted verbatim");
assert(packetContains(set, "No transcript is stored for this call."), "call without a transcript is a log line");
assert(!packetContains(set, "Automated transcript"), "no transcript is invented");
assert(set.omittedMessages >= 1, "routine messages can be omitted");
assert(packetContains(set, "routine messages were omitted"), "omitted count is stated");
assert(packetContains(set, "novaracleaning.com/refund-policy"), "policy addresses are plain-text citations");
assert(packetContains(set, "not recorded"), "policy snapshot gap is stated");
assert(!JSON.stringify(set).includes("Kyonta"), "contractor name is absent");
assert(!set.narrative.toLowerCase().includes("clearly"), "narrative does not speculate");
assert(set.textFields.customer_name === "Ben", "text fields carry the customer name");
assert(set.packets.every((p) => p.stripeField), "every packet maps to a Stripe field");
assert(new Set(set.packets.map((p) => p.stripeField)).size === set.packets.length, "one file per evidence type");

async function main() {
const rendered = await renderEvidenceSet(lib, set.packets);
const text = Object.values(set.textFields).join("");
const check = validateRendered(rendered, text, STRIPE_EVIDENCE_LIMITS);
assert(check.ok, `rendered set fits the budget (${check.errors.join("; ")})`);
assert(check.pages <= 19, `pages ${check.pages} stay within 19`);
assert(check.bytes < 4_500_000, "size stays under 4.5 MB");
const signature = rendered.find((p) => p.stripeField === "customer_signature");
assert(signature && signature.pages <= 2, "acceptance record is one to two pages");
const comm = rendered.find((p) => p.stripeField === "customer_communication");
assert(comm && comm.pages <= 4, "communication packet stays within 4 pages");
assert(!rendered.some((p) => p.filename.includes("agreement-full")), "full agreement is not attached");

const uploads: string[] = [];
const client = {
  async uploadFile(filename: string) {
    uploads.push(filename);
    return { id: `file_${filename}` };
  },
  async updateDispute(_id: string, _body: Record<string, string>, submit: boolean) {
    return { id: "du_test", status: submit ? "under_review" : "needs_response" };
  },
};
const packets = rendered.map((p) => ({ stripeField: p.stripeField, filename: p.filename, bytes: p.bytes }));
const first = await submitDisputeEvidence(client, "du_test", packets, set.textFields, { status: "draft", fileIds: {} });
assert(first.alreadySubmitted === false, "first approval submits");
assert(Object.keys(first.state.fileIds).length === packets.length, "each evidence type records one Stripe file id");
const second = await submitDisputeEvidence(client, "du_test", packets, set.textFields, first.state);
assert(second.alreadySubmitted === true, "a second attempt does not submit again");
assert(uploads.length === packets.length, "files are not uploaded twice");

const dup = buildDisputeEvidence({
  disputeId: "du_dup",
  reason: "duplicate",
  customerName: "Ben",
  charges: [
    { label: "First clean", amountCents: 7755, paymentIntentId: "pi_a" },
    { label: "Second clean", amountCents: 7755, paymentIntentId: "pi_b" },
  ],
  messages: [],
});
assert(dup.packets.some((p) => p.stripeField === "duplicate_charge_documentation"), "duplicate reason leads with the charge breakdown");
assert(dup.policyField === null, "duplicate reason does not force a policy file");

const now = "2026-10-02T16:00:00Z";
const acceptanceLines = ["Signer: Ben", `IP address: ${NOT_RECORDED}`];
let folder: FrozenPiece[] = [];
const firstPrep = preparePiece(folder, {
  clientKey: "bostrow11@gmail.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-1",
  eventId: "acceptance:agreement-1",
  lines: acceptanceLines,
  now,
  backfill: false,
  gaps: ["signature has no IP recorded (older record)"],
});
folder = firstPrep.pieces;
assert(firstPrep.created?.version === 1, "completing a booking prepares an acceptance record");
assert(firstPrep.created?.gaps.some((gap) => gap.includes("no IP recorded")) === true, "the gap names the older signature");
assert(firstPrep.created?.fingerprint === fingerprintPiece("acceptance", acceptanceLines), "prepared piece carries a fingerprint");
const retry = preparePiece(folder, {
  clientKey: "bostrow11@gmail.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-1",
  eventId: "acceptance:agreement-1",
  lines: acceptanceLines,
  now,
  backfill: false,
});
assert(retry.duplicate === true && retry.created === null, "retrying a prep event does not create a duplicate");
const frozenEdit = preparePiece(folder, {
  clientKey: "bostrow11@gmail.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-1",
  eventId: "acceptance:agreement-1:edit",
  lines: ["Signer: Someone else"],
  now,
  backfill: false,
});
assert(Boolean(frozenEdit.rejected), "a frozen piece cannot be edited in place");
const corrected = preparePiece(folder, {
  clientKey: "bostrow11@gmail.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-1",
  eventId: "acceptance:agreement-1:photo",
  lines: [...acceptanceLines, "Late signature image added"],
  now,
  backfill: false,
  correctionReason: "late signature image",
});
folder = corrected.pieces;
assert(corrected.created?.version === 2, "a correction creates a new version");
assert(folder.filter((piece) => piece.kind === "acceptance").length === 2, "the old version is kept");
const resign = preparePiece(folder, {
  clientKey: "bostrow11@gmail.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-2-autopay",
  eventId: "acceptance:autopay",
  lines: ["Signer: Ben", "Payment option: Auto-Pay"],
  now,
  backfill: false,
});
folder = resign.pieces;
assert(resign.created?.version === 1, "switching payment authorization prepares a new acceptance record");
assert(folder.filter((piece) => piece.kind === "acceptance" && piece.seriesId === "agreement-1").length === 2, "the earlier acceptance record is kept");

for (const kind of ["policy", "receipt", "completion"] as const) {
  const prep = preparePiece(folder, {
    clientKey: "bostrow11@gmail.com",
    bookingId: "booking-1",
    chargeKey: "pi_deposit",
    kind,
    seriesId: kind,
    eventId: `${kind}:booking-1`,
    lines: kind === "completion" ? ["Photographs on file: 0"] : ["ok"],
    now,
    backfill: true,
    gaps: kind === "completion" ? ["completion photos missing"] : [],
  });
  folder = prep.pieces;
  assert(prep.created?.lines[0].startsWith("Prepared from existing records on 2026-10-02"), `${kind} backfill is labeled with the preparation date`);
}
const readiness = chargeReadiness(folder, "pi_deposit");
assert(readiness.status === "ready_with_gaps", "a missing photo and a signature without an IP is Ready with gaps");
assert(readiness.gaps.some((gap) => gap.includes("completion photos missing")), "the gap names the missing photos");
const share = readinessShare([readiness, { status: "ready" }]);
assert(share.shareReady === 0.5, "weekly readiness is the share of charges that are ready");
const none = otherEvidenceLines([], 20);
assert(none === null, "no Other Evidence file when nothing relevant exists");
const other = otherEvidenceLines([
  { priority: 2, source: "bookings", at: "2026-08-01", text: "Prior paid booking NVC-0090 for $140.00" },
], 20);
assert(other?.lines.some((line) => line.includes("NVC-0090")) === true, "prior paid bookings are listed with the amount");

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall dispute-evidence assertions passed");
}

main();
