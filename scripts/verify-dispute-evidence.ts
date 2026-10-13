import { inflateSync } from "zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  NOT_RECORDED,
  buildDisputeEvidence,
  packetContains,
  photoCaption,
  photoDisplaySize,
  photoSlotsForCap,
  policyFieldFor,
  reminderLevel,
  selectCompletionPhotos,
  type EvidenceMessage,
  type EvidencePhoto,
} from "../supabase/functions/_shared/dispute-evidence/build.ts";
import { STRIPE_EVIDENCE_LIMITS } from "../supabase/functions/_shared/dispute-evidence/limits.ts";
import { renderEvidenceSet, validateRendered } from "../supabase/functions/_shared/dispute-evidence/render.ts";
import { submitDisputeEvidence } from "../supabase/functions/_shared/dispute-evidence/submit.ts";
import {
  assembleFromPrepared,
  chargeReadiness,
  fingerprintPiece,
  otherEvidenceLines,
  preparePiece,
  readinessShare,
  type FrozenPiece,
} from "../supabase/functions/_shared/dispute-evidence/prep.ts";
import { reviewChecklist, validateLossReview, weeklyDisputeReport, withdrawalDraft } from "../supabase/functions/_shared/dispute-evidence/review.ts";

function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const parts: Buffer[] = [];
  const marker = Buffer.from("stream");
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(marker, cursor);
    if (start < 0) break;
    let dataStart = start + marker.length;
    if (raw[dataStart] === 0x0d) dataStart++;
    if (raw[dataStart] === 0x0a) dataStart++;
    const end = raw.indexOf("endstream", dataStart);
    if (end < 0) break;
    let slice = raw.subarray(dataStart, end);
    while (slice.length && (slice[slice.length - 1] === 0x0a || slice[slice.length - 1] === 0x0d || slice[slice.length - 1] === 0x20)) {
      slice = slice.subarray(0, slice.length - 1);
    }
    try {
      parts.push(inflateSync(slice));
    } catch {
      parts.push(slice);
    }
    cursor = end + "endstream".length;
  }
  const inflated = Buffer.concat(parts).toString("latin1");
  return inflated.replace(/<([0-9A-Fa-f\s]+)>/g, (raw, hex: string) => {
    const clean = hex.replace(/\s+/g, "");
    if (!clean || clean.length % 2) return raw;
    let out = "";
    for (let i = 0; i < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
    return out;
  });
}

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
  serviceAddress: "301 Warren Avenue, Baltimore, MD 21230",
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
assert(packetContains(set, "Delivery proof"), "completion summary opens with the delivery proof");
assert(packetContains(set, "Customer: Ben"), "delivery proof names the customer");
assert(packetContains(set, "Service address: 301 Warren Avenue, Baltimore, MD 21230"), "delivery proof names the service address");
assert(set.packets.every((packet) => packet.identity.customerName === "Ben" && packet.identity.serviceDate === "2026-09-10" && packet.identity.recordId === "NVC-0104" && packet.identity.chargeAmount === "$77.55"), "every packet carries the identification strip fields");
assert(set.narrative.includes("Completion Summary"), "the narrative names the proving packet");
assert(!set.narrative.toLowerCase().includes("fraud"), "the narrative does not accuse");

const fraud = buildDisputeEvidence({
  disputeId: "du_fraud",
  reason: "fraudulent",
  customerName: "Ben",
  serviceDate: "2026-09-10",
  bookingRef: "NVC-0104",
  disputedAmountCents: 7755,
  messages: [complaint],
  acceptance: { signerName: "Benjamin Ostrow", signedAt: "2026-09-05T18:51:38Z", ip: "203.0.113.8", userAgent: "Mozilla/5.0", paymentOption: "Pay in Full", relationship: "str_host" },
});
assert(fraud.packets[0].id === "acceptance", "a fraud dispute leads with the acceptance record");
assert(fraud.packets[1].id === "communication", "fraud evidence continues with the customer's own messages");
assert(fraud.narrative.includes("Acceptance Record"), "the fraud narrative names the acceptance record");
assert(!fraud.narrative.toLowerCase().includes("fraud"), "the fraud narrative stays factual");
assert(packetContains(fraud, "Payment option: Pay in Full"), "a host acceptance record shows the payment option");

const missing = buildDisputeEvidence({
  disputeId: "du_nr",
  reason: "product_not_received",
  customerName: "Ben",
  serviceDate: "2026-09-10",
  serviceAddress: "301 Warren Avenue, Baltimore, MD 21230",
  bookingRef: "NVC-0104",
  disputedAmountCents: 7755,
  messages: [],
});
assert(missing.packets[0].id === "completion", "a service-not-received dispute leads with the completion summary");
assert(missing.narrative.split(/(?<=\.)\s+/).slice(0, 2).join(" ").includes("Completion Summary"), "the first sentences name the completion summary");

const canceled = buildDisputeEvidence({
  disputeId: "du_cancel",
  reason: "subscription_canceled",
  customerName: "Ben",
  serviceDate: "2026-09-10",
  bookingRef: "NVC-0104",
  messages: [],
});
assert(canceled.packets[0].id === "policy", "a subscription-canceled dispute leads with the policy");
assert(canceled.policyField === "cancellation_policy", "a subscription-canceled dispute uses the cancellation policy field");

const credit = buildDisputeEvidence({
  disputeId: "du_credit",
  reason: "credit_not_processed",
  customerName: "Ben",
  charges: [{ label: "Refund", amountCents: 2000, kind: "refund", paymentIntentId: "re_1" }],
  messages: [],
});
assert(credit.packets[0].id === "policy", "a credit-not-processed dispute leads with the policy");
assert(credit.policyField === "refund_policy", "a credit-not-processed dispute uses the refund policy field");

const versioned = buildDisputeEvidence({
  disputeId: "du_version",
  reason: "product_unacceptable",
  customerName: "Ben",
  disputedAmountCents: 1000,
  charges: [{ label: "Charge", amountCents: 1000, paymentIntentId: "pi_1" }],
  policySnapshot: {
    acceptedVersionRecorded: true,
    effectiveOn: "2026-06-01",
    clauses: [{ text: "Completed service payments are final once the service is rendered.", cite: "Refund Policy 1.1" }],
  },
  messages: [],
});
const versionedPolicy = versioned.packets.find((packet) => packet.id === "policy");
assert(Boolean(versionedPolicy?.lines.some((line) => line.includes("2026-06-01"))), "a recorded policy version shows its effective date");
assert(!versionedPolicy?.lines.some((line) => line.includes("was not recorded")), "a recorded policy version is not described as missing");

const currentOnly = buildDisputeEvidence({
  disputeId: "du_current",
  reason: "subscription_canceled",
  customerName: "Ben",
  messages: [],
});
assert(packetContains(currentOnly, "was not recorded") || packetContains(currentOnly, "not recorded"), "a missing policy version is stated");
assert(packetContains(currentOnly, "novaracleaning.com/cancellation-policy"), "both policy addresses are printed as citations");

const photos: EvidencePhoto[] = [
  { label: "Kitchen before", phase: "before", room: "Kitchen", takenAt: "2026-09-10T14:02:00Z", jobId: "NVC-0104", priority: 3 },
  { label: "Kitchen after", phase: "after", room: "Kitchen", takenAt: "2026-09-10T16:40:00Z", jobId: "NVC-0104", priority: 3 },
  { label: "Bath before", phase: "before", room: "Bath", takenAt: "2026-09-10T14:05:00Z", jobId: "NVC-0104", priority: 1 },
  { label: "Bath after", phase: "after", room: "Bath", takenAt: "2026-09-10T16:44:00Z", jobId: "NVC-0104", priority: 1 },
];
assert(photoCaption(photos[0]).includes("before") && photoCaption(photos[0]).includes("Kitchen") && photoCaption(photos[0]).includes("NVC-0104"), "a photo caption names before or after, the room, and the job");
const tight = selectCompletionPhotos(photos, photoSlotsForCap(2));
assert(tight.kept.length === 2 && tight.omitted === 2, "a smaller page cap drops photos instead of shrinking them");
const capped = buildDisputeEvidence({
  disputeId: "du_photos",
  reason: "product_not_received",
  customerName: "Ben",
  bookingRef: "NVC-0104",
  serviceDate: "2026-09-10",
  photos,
  limits: { packetPages: { ...STRIPE_EVIDENCE_LIMITS.packetPages, service_documentation: 2 } },
  messages: [],
});
assert(packetContains(capped, "additional photographs are on file"), "the summary states how many photographs remain on file");
const readable = photoDisplaySize(1600, 1200, 516, 300, STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt, STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt);
assert(Boolean(readable && readable.h >= STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt && readable.w >= STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt), "a normal photo is displayed at or above the minimum size");
assert(photoDisplaySize(4000, 400, 516, 300, STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt, STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt) === null, "a photo that cannot meet the minimum size is dropped");

const scored = buildDisputeEvidence({
  disputeId: "du_score",
  reason: "general",
  customerName: "Ben",
  zoneLines: ["Kitchen. Novara Score 92. Cleaner pay rate $25/hr."],
  messages: [{ id: "secret", at: "2026-09-10T12:00:00Z", direction: "novara", channel: "sms", body: "Internal QC note about the cleaner", source: "internal", internal: true }],
  redact: { names: ["Kyonta Terry"], phones: ["4105551212"] },
});
assert(!JSON.stringify(scored).includes("Novara Score"), "Novara Score is omitted");
assert(!JSON.stringify(scored).includes("$25/hr"), "pay data is omitted");
assert(!JSON.stringify(scored).includes("Internal QC note"), "internal notes are omitted");

const loss = validateLossReview("photos_unreadable", "The after photos were too small to read.");
assert(loss.ok === true, "a lost dispute accepts a cause tag and a note");
assert(validateLossReview("nope", "note").ok === false, "an unknown loss cause is rejected");
const report = weeklyDisputeReport([
  { reason: "product_not_received", outcome: "lost", lossCause: "photos_unreadable", readyAtArrival: false },
  { reason: "product_not_received", outcome: "won", readyAtArrival: true },
]);
assert(report.byReason.product_not_received.lost === 1 && report.byReason.product_not_received.won === 1, "the weekly report groups outcomes by dispute reason");
assert(report.byCause.photos_unreadable === 1, "the weekly report groups losses by cause");
assert(report.shareReadyAtArrival === 0.5, "the weekly report includes how many disputes were ready when they arrived");
const draft = withdrawalDraft({ customerName: "Ben", serviceDocumented: true, relationshipIntact: true, serviceDate: "2026-09-10", serviceAddress: "301 Warren Avenue" });
assert(draft?.sentAutomatically === false && draft.draft.includes("withdraw"), "a withdrawal note is a draft and is not sent automatically");
assert(withdrawalDraft({ serviceDocumented: false, relationshipIntact: true }) === null, "no withdrawal draft when delivery is not documented");

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
assert(dup.packets[0]?.stripeField === "duplicate_charge_documentation", "duplicate reason leads with the charge breakdown");
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
const withHistory = buildDisputeEvidence({
  disputeId: "du_other",
  reason: "fraudulent",
  customerName: "Ben",
  bookingRef: "NVC-0104",
  serviceDate: "2026-09-10",
  otherItems: [{ priority: 2, source: "bookings", at: "2026-08-01", text: "Prior paid booking NVC-0090 for $140.00" }],
  messages: [],
});
assert(withHistory.packets.some((packet) => packet.id === "other" && packet.lines.some((line) => line.includes("NVC-0090"))), "prior paid bookings are filed in Other Evidence");
const emptyOther = buildDisputeEvidence({ disputeId: "du_none", reason: "general", customerName: "Ben", messages: [], otherItems: [] });
assert(!emptyOther.packets.some((packet) => packet.id === "other"), "no Other Evidence file when nothing relevant exists");

const preparedAcceptance = preparePiece([], {
  clientKey: "ben@example.com",
  bookingId: "booking-1",
  chargeKey: "pi_deposit",
  kind: "acceptance",
  seriesId: "agreement-1",
  eventId: "acceptance:live",
  lines: ["Signer: Ben", "IP address: 203.0.113.8"],
  now,
  backfill: false,
});
const assembled = assembleFromPrepared({
  pieces: preparedAcceptance.pieces,
  chargeKey: "pi_deposit",
  now,
  input: {
    disputeId: "du_live",
    reason: "fraudulent",
    customerName: "Ben",
    serviceDate: "2026-09-10",
    bookingRef: "NVC-0104",
    disputedAmountCents: 7755,
    messages: [complaint],
  },
});
assert(assembled.packets[0]?.id === "acceptance", "assembly keeps the fraud lead packet first");
assert(assembled.packets.some((packet) => packet.lines.includes("Signer: Ben")), "assembly uses the frozen acceptance record");
assert(assembled.packets.some((packet) => packet.lines.some((line) => line.includes("not satisfied"))), "assembly rebuilds the communication packet through the dispute");
assert(assembled.fingerprintMismatches.length === 0, "a matching fingerprint is verified");
const mismatched = assembleFromPrepared({
  pieces: preparedAcceptance.pieces.map((piece) => ({ ...piece, fingerprint: "tampered" })),
  chargeKey: "pi_deposit",
  now,
  input: {
    disputeId: "du_live",
    reason: "fraudulent",
    customerName: "Ben",
    messages: [],
  },
});
assert(mismatched.fingerprintMismatches.length > 0, "a changed file is flagged when its fingerprint does not match");

const checklist = reviewChecklist(set, { ok: true });
assert(checklist.items.some((item) => item.id === "pages_identified" && item.ok), "the review checklist confirms every packet is identified");
const blocked = reviewChecklist(set, { ok: false, errors: ["over"] });
assert(blocked.ok === false, "the review checklist blocks a set that is over budget");

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const photoSet = buildDisputeEvidence({
  disputeId: "du_img",
  reason: "product_not_received",
  customerName: "Ben",
  serviceDate: "2026-09-10",
  bookingRef: "NVC-0104",
  disputedAmountCents: 7755,
  serviceAddress: "301 Warren Avenue",
  photos: [{ label: "Kitchen after", phase: "after", room: "Kitchen", takenAt: "2026-09-10T16:40:00Z", jobId: "NVC-0104", bytes: png }],
  messages: [],
});
const photoPdf = await renderEvidenceSet(lib, photoSet.packets.filter((packet) => packet.id === "completion"));
const photoText = pdfText(photoPdf[0].bytes);
assert(photoText.includes("after") && photoText.includes("Kitchen") && photoText.includes("NVC-0104"), "the rendered photo caption names after, the room, and the job");
assert(photoText.split("Ben").length - 1 >= photoPdf[0].pages, "every completion page shows the customer name");

for (const packet of rendered) {
  const text = pdfText(packet.bytes);
  assert(text.includes("Ben"), `${packet.filename} shows the customer name`);
  assert(text.includes("2026-09-10"), `${packet.filename} shows the service date`);
  assert(text.includes("NVC-0104"), `${packet.filename} shows the job id`);
  assert(text.includes("$77.55"), `${packet.filename} shows the charge amount`);
  assert(text.split("Ben").length - 1 >= packet.pages, `${packet.filename} identifies every page`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall dispute-evidence assertions passed");
}

main();
