// Builds the fixed Stripe dispute evidence set from records that already exist.
// Missing values are the words "not recorded". Nothing here is guessed.
// Communication excerpts are copied verbatim. Transcripts are never written.
// The identification strip is data for the PDF builder. It is not typed per page.

import {
  LINES_PER_PAGE,
  STRIPE_EVIDENCE_LIMITS,
  lineBudget,
  type DisputeEvidenceLimits,
} from "./limits.ts";
import { POLICY_CITATIONS, RECORDED_POLICY_CLAUSES, VERSION_NOT_RECORDED, type PolicyClause } from "./policies.ts";

export const NOT_RECORDED = "not recorded";

const FORBIDDEN_NARRATIVE = [
  "clearly",
  "obviously",
  "must have",
  "trying to",
  "wanted to",
  "fraud",
  "lied",
  "scam",
  "novara score",
  "contractor pay",
];

export type DisputeReason =
  | "fraudulent"
  | "unrecognized"
  | "product_not_received"
  | "product_unacceptable"
  | "subscription_canceled"
  | "credit_not_processed"
  | "duplicate"
  | "general"
  | string;

export interface EvidenceMessage {
  id: string;
  at?: string | null;
  /** customer | novara */
  direction: "customer" | "novara";
  channel: "sms" | "email" | "call" | "link";
  body?: string | null;
  /** Present only when a real transcript was stored. */
  transcript?: string | null;
  durationSeconds?: number | null;
  callStatus?: string | null;
  source: string;
  /** Internal notes are excluded. They are not customer communication. */
  internal?: boolean | null;
}

export interface EvidencePhoto {
  label: string;
  phase?: "before" | "after" | string | null;
  room?: string | null;
  takenAt?: string | null;
  jobId?: string | null;
  priority?: number | null;
  /** When absent, the summary says the image was not recorded. */
  bytes?: Uint8Array | null;
  /** Fetched by the evidence function before the PDF is built. Not printed. */
  url?: string | null;
}

export interface AcceptanceInput {
  signerName?: string | null;
  email?: string | null;
  phone?: string | null;
  signedAt?: string | null;
  ip?: string | null;
  /** Raw stored user agent. A server runtime is not the customer's device. */
  userAgent?: string | null;
  agreementName?: string | null;
  agreementVersion?: string | null;
  documentId?: string | null;
  amountLabel?: string | null;
  depositLabel?: string | null;
  balanceLabel?: string | null;
  paymentOption?: string | null;
  /** True when a signature image was stored. The image itself is not required in the text. */
  signaturePresent?: boolean | null;
  acknowledgments?: Array<{ label: string; accepted?: boolean | null }>;
  relationship?: "residential" | "str_host" | "property_manager" | "commercial" | string | null;
  signatureBytes?: Uint8Array | null;
}

export interface ChargeLine {
  label: string;
  amountCents: number | null;
  paymentIntentId?: string | null;
  kind?: string | null;
}

export interface PolicySnapshotInput {
  effectiveOn?: string | null;
  /** True only when this snapshot is the version stored on the acceptance. */
  acceptedVersionRecorded: boolean;
  clauses?: PolicyClause[];
}

export interface VisitLine {
  id: string;
  date?: string | null;
  address?: string | null;
  summary?: string | null;
}

export interface PageIdentity {
  customerName: string;
  serviceDate: string;
  recordId: string;
  chargeAmount: string;
  packetName: string;
}

export interface DisputeBuildInput {
  disputeId: string;
  reason: DisputeReason;
  evidenceDueAt?: string | null;
  now?: string | null;
  bookingRef?: string | null;
  jobId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  billingAddress?: string | null;
  serviceAddress?: string | null;
  serviceDescription?: string | null;
  serviceDate?: string | null;
  chargeDate?: string | null;
  purchaseIp?: string | null;
  scheduledWindow?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  geotag?: string | null;
  checklistCompleted?: number | null;
  checklistTotal?: number | null;
  photos?: EvidencePhoto[];
  zoneLines?: string[];
  visits?: VisitLine[];
  remedy?: {
    offered?: string | null;
    offeredAt?: string | null;
    customerResponse?: string | null;
  } | null;
  messages?: EvidenceMessage[];
  /** Message ids the admin pinned. Unfavorable customer messages stay included either way. */
  pinnedMessageIds?: string[];
  acceptance?: AcceptanceInput | null;
  policySnapshot?: PolicySnapshotInput | null;
  charges?: ChargeLine[];
  disputedAmountCents?: number | null;
  /** Names and phones that must never appear (contractor, other customers). */
  redact?: { names?: string[]; phones?: string[] };
  /** Verified items for the optional Other Evidence file. */
  otherItems?: Array<{ priority: number; source: string; at: string; text: string; addedBy?: string | null }>;
  limits?: Partial<DisputeEvidenceLimits>;
}

export interface PacketDoc {
  id: "completion" | "communication" | "acceptance" | "policy" | "receipt" | "other";
  filename: string;
  stripeField: string;
  title: string;
  lines: string[];
  images?: Array<{ label: string; bytes: Uint8Array }>;
  signature?: { bytes: Uint8Array } | null;
  identity: PageIdentity;
  pageCap: number;
  trimmed: boolean;
  warnings: string[];
  photoMinHeight: number;
  photoMinWidth: number;
  photoMaxHeight: number;
}

export interface DisputeEvidenceSet {
  disputeId: string;
  reason: string;
  packets: PacketDoc[];
  textFields: Record<string, string>;
  narrative: string;
  warnings: string[];
  missing: string[];
  estimatedPages: number;
  estimatedBytes: number;
  policyField: string | null;
  reminder: "none" | "reminder" | "urgent";
  omittedMessages: number;
}

export function shown(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? v : NOT_RECORDED;
}

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function isServerRuntime(userAgent: string | null | undefined): boolean {
  return /^\s*deno\//i.test(userAgent || "");
}

export function redactInternal(text: string, redact?: { names?: string[]; phones?: string[] }): string {
  let out = text || "";
  for (const name of redact?.names || []) {
    const n = name.trim();
    if (n.length < 3) continue;
    out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "assigned cleaner");
  }
  for (const phone of redact?.phones || []) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) continue;
    const last = digits.slice(-10);
    out = out.replace(new RegExp(last.split("").join("\\D*"), "g"), "[phone removed]");
  }
  out = out.replace(/novara\s*score\b[^.\n]*/gi, "[internal score removed]");
  out = out.replace(/\$\d[\d,]*(?:\.\d{2})?\s*(?:\/|per)\s*h(?:ou)?r/gi, "[pay removed]");
  out = out.replace(/\bpay\s*rate\b[^.\n]*/gi, "[pay removed]");
  return out;
}

export function policyFieldFor(reason: string, messages: EvidenceMessage[] = []): string | null {
  const r = reason.toLowerCase();
  if (r === "product_unacceptable" || r === "credit_not_processed") return "refund_policy";
  if (r === "subscription_canceled") return "cancellation_policy";
  if (r === "general") {
    const hay = messages.map((m) => `${m.body || ""} ${m.transcript || ""}`).join(" ").toLowerCase();
    if (/\brefund|credit\b/.test(hay) && !/\bcancel/.test(hay)) return "refund_policy";
    if (/\bcancel/.test(hay)) return "cancellation_policy";
    return "refund_policy";
  }
  return null;
}

export function packetOrder(reason: string): PacketDoc["id"][] {
  const r = reason.toLowerCase();
  if (r === "fraudulent" || r === "unrecognized") {
    return ["acceptance", "communication", "completion", "policy", "receipt", "other"];
  }
  if (r === "subscription_canceled") {
    return ["policy", "communication", "acceptance", "completion", "receipt", "other"];
  }
  if (r === "credit_not_processed") {
    return ["policy", "receipt", "communication", "completion", "acceptance", "other"];
  }
  if (r === "duplicate") {
    return ["receipt", "communication", "completion", "acceptance", "other"];
  }
  return ["completion", "communication", "acceptance", "policy", "receipt", "other"];
}

export function reminderLevel(dueAt: string | null | undefined, nowIso: string): "none" | "reminder" | "urgent" {
  if (!dueAt) return "none";
  const ms = Date.parse(dueAt) - Date.parse(nowIso);
  if (!Number.isFinite(ms)) return "none";
  if (ms <= 24 * 60 * 60 * 1000) return "urgent";
  if (ms <= 48 * 60 * 60 * 1000) return "reminder";
  return "none";
}

export function identityFromInput(input: DisputeBuildInput, packetName: string): PageIdentity {
  return {
    customerName: shown(input.customerName),
    serviceDate: shown(input.serviceDate || input.chargeDate),
    recordId: shown(input.bookingRef || input.jobId),
    chargeAmount: formatMoney(input.disputedAmountCents),
    packetName,
  };
}

function wrapCount(text: string, width = 92): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1;
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (trial.length > width) {
      lines++;
      cur = w;
    } else cur = trial;
  }
  return lines;
}

function inferPhase(photo: EvidencePhoto): string {
  if (photo.phase?.trim()) return photo.phase.trim().toLowerCase();
  if (/^\s*before\b/i.test(photo.label || "")) return "before";
  if (/^\s*after\b/i.test(photo.label || "")) return "after";
  return NOT_RECORDED;
}

export function photoCaption(photo: EvidencePhoto, fallbackJobId?: string | null): string {
  const phase = inferPhase(photo);
  const room = shown(photo.room);
  const when = shown(photo.takenAt);
  const job = shown(photo.jobId || fallbackJobId);
  return `${phase} · ${room} · ${when} · ${job}`;
}

export function photoSlotsForCap(pageCap: number): number {
  return Math.max(0, pageCap - 1) * 2;
}

/** One before and one after per room first, then the next highest priority. */
export function selectCompletionPhotos(photos: EvidencePhoto[], slots: number): { kept: EvidencePhoto[]; omitted: number } {
  if (slots <= 0 || photos.length === 0) return { kept: [], omitted: photos.length };
  const ranked = photos.map((photo, index) => ({
    photo,
    index,
    priority: photo.priority ?? (photo.phase ? 2 : 1),
  })).sort((a, b) => b.priority - a.priority || a.index - b.index);
  const preferred: number[] = [];
  const rooms = new Map<string, { before?: number; after?: number }>();
  for (const row of ranked) {
    const room = (row.photo.room || "").trim().toLowerCase() || `photo-${row.index}`;
    const phase = inferPhase(row.photo);
    const slot = rooms.get(room) || {};
    if (phase === "before" && slot.before == null) slot.before = row.index;
    else if (phase === "after" && slot.after == null) slot.after = row.index;
    else continue;
    rooms.set(room, slot);
  }
  for (const slot of rooms.values()) {
    if (slot.before != null) preferred.push(slot.before);
    if (slot.after != null) preferred.push(slot.after);
  }
  const kept: EvidencePhoto[] = [];
  const used = new Set<number>();
  for (const index of preferred) {
    if (kept.length >= slots) break;
    kept.push(photos[index]);
    used.add(index);
  }
  for (const row of ranked) {
    if (kept.length >= slots) break;
    if (used.has(row.index)) continue;
    kept.push(row.photo);
    used.add(row.index);
  }
  return { kept, omitted: photos.length - kept.length };
}

/**
 * Displayed size for one photo. Returns null when the photo cannot meet the
 * minimum on both sides inside the slot. Callers drop it. They do not shrink it.
 */
export function photoDisplaySize(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number,
  minWidth: number,
  minHeight: number,
): { w: number; h: number } | null {
  if (imageWidth <= 0 || imageHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) return null;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  if (w + 0.5 < minWidth || h + 0.5 < minHeight) return null;
  return { w, h };
}

function scoreMessage(m: EvidenceMessage, reason: string): number {
  const hay = `${m.body || ""} ${m.transcript || ""}`.toLowerCase();
  let score = 0;
  if (/\b(refund|cancel|chargeback|reschedul|not satisfied|incomplete|wasn't|was not|prefer|price|book)\b/.test(hay)) score += 5;
  if (/\b(booked|deposit|agreement|confirm|arrived|complete|checklist|access|schedule)\b/.test(hay)) score += 3;
  if (m.channel === "call") score += m.transcript ? 4 : 2;
  if (m.direction === "customer" && reason === "product_unacceptable" && /\b(not|incomplete|dissatisf|dirty|missed)\b/.test(hay)) score += 6;
  if (m.direction === "customer" && (reason === "fraudulent" || reason === "unrecognized")) score += 2;
  return score;
}

function isUnfavorableRelevant(m: EvidenceMessage, reason: string): boolean {
  if (m.direction !== "customer") return false;
  const hay = `${m.body || ""} ${m.transcript || ""}`.toLowerCase();
  if (reason === "product_unacceptable" || reason === "general") {
    return /\b(not satisfied|incomplete|not followed|wasn't|was not|dirty|missed|refund|dissatisf)\b/.test(hay);
  }
  if (reason === "product_not_received") return /\b(never|didn't show|did not|no one|nobody)\b/.test(hay);
  if (reason === "subscription_canceled") return /\bcancel/.test(hay);
  if (reason === "credit_not_processed") return /\b(refund|credit)\b/.test(hay);
  return false;
}

export function messageExcerpt(m: EvidenceMessage, redact?: DisputeBuildInput["redact"]): string[] {
  const when = shown(m.at);
  const who = m.direction === "customer" ? "Customer" : "Novara";
  if (m.channel === "call") {
    if ((m.transcript || "").trim()) {
      const quoted = redactInternal(m.transcript!.trim(), redact);
      return [
        `${when}  ${who}  call  source ${m.source}`,
        "Automated transcript:",
        quoted,
      ];
    }
    const dur = m.durationSeconds != null ? `${m.durationSeconds} seconds` : NOT_RECORDED;
    return [
      `${when}  ${who}  call  status ${shown(m.callStatus)}  duration ${dur}  source ${m.source}`,
      "No transcript is stored for this call.",
    ];
  }
  const body = redactInternal((m.body || "").trim(), redact);
  return [
    `${when}  ${who}  ${m.channel}  source ${m.source}`,
    body || NOT_RECORDED,
  ];
}

function selectMessages(
  messages: EvidenceMessage[],
  reason: string,
  redact: DisputeBuildInput["redact"],
  maxLines: number,
  pinned: string[],
): { lines: string[]; omitted: number; warnings: string[] } {
  const warnings: string[] = [];
  const visible = messages.filter((message) => !message.internal);
  const ranked = visible.map((m, index) => ({
    m,
    index,
    score: scoreMessage(m, reason),
    required: isUnfavorableRelevant(m, reason) || pinned.includes(m.id),
  }));
  const required = ranked.filter((r) => r.required);
  const optional = ranked.filter((r) => !r.required).sort((a, b) => b.score - a.score || a.index - b.index);

  const chosen: typeof ranked = [];
  let linesUsed = 8;
  const take = (row: (typeof ranked)[number], force: boolean) => {
    const excerpt = messageExcerpt(row.m, redact);
    const cost = excerpt.reduce((n, line) => n + wrapCount(line), 0) + 1;
    if (!force && linesUsed + cost > maxLines) return false;
    if (force && linesUsed + cost > maxLines) {
      warnings.push(`A relevant customer message (${row.m.source}) was kept and other excerpts were shortened to fit.`);
    }
    chosen.push(row);
    linesUsed += cost;
    return true;
  };

  for (const row of required) take(row, true);
  for (const row of optional) {
    if (row.score <= 0 && !pinned.includes(row.m.id)) continue;
    if (!take(row, false)) break;
  }
  chosen.sort((a, b) => a.index - b.index);
  const lines = ["Timeline: inquiry, booking, agreement, deposit, service, and any complaint are in the excerpts below."];
  for (const row of chosen) {
    lines.push("");
    lines.push(...messageExcerpt(row.m, redact));
  }
  const omitted = visible.length - chosen.length;
  lines.push("");
  lines.push(`${omitted} routine messages were omitted. The full history is available on request.`);
  return { lines, omitted, warnings };
}

function disputeClauses(snapshot: PolicySnapshotInput | null | undefined): { clauses: PolicyClause[]; recorded: boolean } {
  if (snapshot?.acceptedVersionRecorded && snapshot.clauses && snapshot.clauses.length > 0) {
    return { clauses: snapshot.clauses, recorded: true };
  }
  return { clauses: RECORDED_POLICY_CLAUSES, recorded: false };
}

function acceptanceLines(a: AcceptanceInput | null | undefined, snapshot: PolicySnapshotInput | null | undefined, redact?: DisputeBuildInput["redact"]): string[] {
  const src = a || {};
  const device = !src.userAgent?.trim()
    ? NOT_RECORDED
    : isServerRuntime(src.userAgent)
      ? NOT_RECORDED
      : redactInternal(src.userAgent, redact);
  const acks = src.acknowledgments?.length
    ? src.acknowledgments.map((ack) => `${ack.label}: ${ack.accepted === true ? "accepted" : ack.accepted === false ? "not accepted" : NOT_RECORDED}`)
    : [NOT_RECORDED];
  const doc = src.agreementName
    ? `${src.agreementName}, version ${shown(src.agreementVersion)}, fingerprint ${shown(src.documentId)}`
    : NOT_RECORDED;
  const relationship = shown(src.relationship || "residential");
  const { clauses, recorded } = disputeClauses(snapshot);
  const relevant = clauses.filter((clause) => /refund|cancel|chargeback|payment|authoriz/i.test(`${clause.text} ${clause.cite}`)).slice(0, 4);
  const clauseLines = relevant.flatMap((clause) => [`- ${clause.text}`, `  Source: ${clause.cite}`]);
  return [
    "This record is the proof of agreement. The full agreement is archived and is not attached.",
    `Relationship: ${relationship}`,
    `Signer: ${shown(src.signerName)}`,
    src.signaturePresent
      ? "Signature: signature image is on file."
      : `Signature: ${shown(src.signerName ? `typed signature ${src.signerName}` : null)}. Signature image: ${NOT_RECORDED}.`,
    `Email: ${shown(src.email)}`,
    `Phone: ${shown(src.phone)}`,
    `Signed at: ${shown(src.signedAt)}`,
    `IP address: ${shown(src.ip)}`,
    `Device or browser: ${device}`,
    `Agreement: ${doc}`,
    `Amount authorized: ${shown(src.amountLabel)}`,
    `Deposit terms: ${shown(src.depositLabel)}`,
    `Balance terms: ${shown(src.balanceLabel)}`,
    `Payment option: ${shown(src.paymentOption)}`,
    "Acknowledgments:",
    ...acks,
    recorded
      ? "Clauses from the version recorded on this acceptance:"
      : "The clause text from the signed version was not recorded. The clauses below are the current published clauses. This is not a statement that the client saw this version.",
    ...clauseLines,
  ];
}

function policyLines(field: string | null, snapshot: PolicySnapshotInput | null | undefined): string[] {
  const which = field === "cancellation_policy"
    ? "This file is attached to the cancellation policy field."
    : field === "refund_policy"
      ? "This file is attached to the refund policy field."
      : "This file explains both policies. Attach it to the field chosen for this dispute reason.";
  const { clauses, recorded } = disputeClauses(snapshot);
  const cancel = clauses.filter((clause) => /cancel/i.test(clause.text));
  const refund = clauses.filter((clause) => /refund|re-clean|final|chargeback/i.test(clause.text));
  const versionLine = recorded
    ? `These clauses are the policy version effective ${shown(snapshot?.effectiveOn)}, the version recorded on the acceptance.`
    : VERSION_NOT_RECORDED;
  const quote = (rows: PolicyClause[]) => rows.slice(0, 3).flatMap((clause) => [clause.text, `Source: ${clause.cite}`]);
  return [
    which,
    versionLine,
    "How cancellation works:",
    ...(cancel.length ? quote(cancel) : [NOT_RECORDED]),
    "How refunds work:",
    ...(refund.length ? quote(refund) : [NOT_RECORDED]),
    "Published locations of the policies, printed as citations only:",
    ...POLICY_CITATIONS,
    "Acceptance of these terms is the timestamp and signature on the Acceptance Record.",
  ];
}

function addresses(input: DisputeBuildInput): string[] {
  const service = shown(input.serviceAddress);
  const billing = shown(input.billingAddress);
  const bothKnown = Boolean(input.serviceAddress?.trim() && input.billingAddress?.trim());
  const differ = bothKnown && input.serviceAddress!.trim().toLowerCase() !== input.billingAddress!.trim().toLowerCase();
  return [
    `Service address: ${service}`,
    differ
      ? `Billing address on file: ${billing}. The billing address differs from the service address.`
      : `Billing address on file: ${billing}.`,
  ];
}

function summaryLines(input: DisputeBuildInput, pageCap: number, limits: DisputeEvidenceLimits): {
  lines: string[];
  warnings: string[];
  images: Array<{ label: string; bytes: Uint8Array }>;
} {
  const warnings: string[] = [];
  const photos = input.photos || [];
  const lines = [
    "Delivery proof",
    `Customer: ${shown(input.customerName)}`,
    ...addresses(input),
    `Service date: ${shown(input.serviceDate)}`,
    `Job or visit: ${shown(input.bookingRef || input.jobId)}`,
    `Charge amount: ${formatMoney(input.disputedAmountCents)}`,
    `Service: ${shown(input.serviceDescription)}`,
    `Scheduled window: ${shown(input.scheduledWindow)}`,
    `Arrived: ${shown(input.arrivedAt)}`,
    `Started: ${shown(input.startedAt)}`,
    `Finished: ${shown(input.finishedAt)}`,
    `Checklist: ${
      input.checklistCompleted == null || input.checklistTotal == null
        ? NOT_RECORDED
        : `${input.checklistCompleted}/${input.checklistTotal}`
    }`,
    `Geotag: ${shown(input.geotag)}`,
    `Photographs on file: ${photos.length === 0 ? NOT_RECORDED : String(photos.length)}`,
    "Assigned cleaner: referred to by job only. Contractor name and phone are omitted.",
  ];
  const visits = input.visits || [];
  if (visits.length > 1) {
    lines.push("Visits covered by this charge:");
    for (const visit of visits) {
      lines.push(`- ${shown(visit.id)}  ${shown(visit.date)}  ${shown(visit.address)}  ${shown(visit.summary)}`);
    }
    lines.push("The table lists every visit on this charge. Detail below is what fits in this summary.");
  }
  if (!input.arrivedAt && !input.startedAt) warnings.push("Arrival and start times were not recorded.");
  if (photos.length === 0) warnings.push("No photographs were recorded. Flagged for admin review.");
  if (input.remedy?.offered) {
    lines.push(`Remedy offered: ${redactInternal(input.remedy.offered, input.redact)} at ${shown(input.remedy.offeredAt)}`);
    lines.push(`Customer response: ${shown(input.remedy.customerResponse ? redactInternal(input.remedy.customerResponse, input.redact) : null)}`);
  } else {
    lines.push(`Remedy offered: ${NOT_RECORDED}`);
  }
  for (const zone of input.zoneLines || []) lines.push(redactInternal(zone, input.redact));

  const selected = selectCompletionPhotos(photos, photoSlotsForCap(pageCap));
  if (selected.omitted > 0) {
    warnings.push(`Photographs were reduced to fit the completion summary page cap. ${selected.omitted} not shown.`);
    lines.push(`${selected.omitted} additional photographs are on file and were not included because of the page cap.`);
  }
  const images: Array<{ label: string; bytes: Uint8Array }> = [];
  for (const photo of selected.kept) {
    const caption = redactInternal(photoCaption(photo, input.bookingRef || input.jobId), input.redact);
    if (photo.bytes && photo.bytes.byteLength > 0) images.push({ label: caption, bytes: photo.bytes });
    else lines.push(`${caption}: image bytes not recorded`);
  }
  if (images.length === 0 && photos.length > 0 && selected.kept.length > 0 && selected.kept.every((photo) => !photo.bytes?.byteLength)) {
    warnings.push("Photograph records exist and the image bytes were not recorded.");
  }
  void limits;
  return { lines, warnings, images };
}

function chargeLine(charge: ChargeLine): string {
  return `${charge.label}: ${formatMoney(charge.amountCents)}  ${charge.kind || ""}  ${charge.paymentIntentId || NOT_RECORDED}`.replace(/\s+/g, " ").trim();
}

export function receiptPacketLines(input: DisputeBuildInput): string[] {
  const reason = input.reason.toLowerCase();
  const charges = input.charges || [];
  const matching = (pattern: RegExp) => charges.filter((charge) => pattern.test(`${charge.kind || ""} ${charge.label}`));
  const section = (title: string, rows: ChargeLine[]) => [
    title,
    ...(rows.length ? rows.map(chargeLine) : [NOT_RECORDED]),
  ];
  const header = reason === "duplicate"
    ? "These are separate charges. Each line is a different payment."
    : "Charge breakdown for the disputed payment.";
  if (!charges.length) {
    return [header, `Disputed amount: ${formatMoney(input.disputedAmountCents)}`, `Charge breakdown: ${NOT_RECORDED}`];
  }
  return [
    header,
    `Disputed amount: ${formatMoney(input.disputedAmountCents)}`,
    ...section("Base price:", matching(/\bbase\b/i)),
    ...section("Add-ons:", matching(/add-?on/i)),
    ...section("Same-day fee:", matching(/same-?day|sameday/i)),
    ...section("Discounts:", matching(/discount/i)),
    ...section("Deposit or balance:", matching(/deposit|balance/i)),
    "Charges:",
    ...charges.map(chargeLine),
  ];
}

function receiptLines(input: DisputeBuildInput): string[] | null {
  const reason = input.reason.toLowerCase();
  const charges = input.charges || [];
  const needs = reason === "duplicate"
    || reason === "credit_not_processed"
    || reason === "general"
    || (input.disputedAmountCents != null && charges.length > 1);
  if (!needs) return null;
  return receiptPacketLines(input);
}

function narrativeFor(input: DisputeBuildInput): string {
  const name = shown(input.customerName);
  const date = shown(input.serviceDate);
  const address = shown(input.serviceAddress || input.billingAddress);
  const reason = input.reason.toLowerCase();
  let opening: string;
  if (reason === "fraudulent" || reason === "unrecognized") {
    opening = `The cardholder ${name} accepted this service, as shown in the Acceptance Record, page 1. The Customer communication packet shows the cardholder's own messages about the booking.`;
  } else if (reason === "product_not_received") {
    opening = `The cardholder ${name} received the cleaning at ${address} on ${date}, as shown in the Completion Summary, page 1. The Acceptance Record shows the agreement for that service.`;
  } else if (reason === "product_unacceptable") {
    opening = `The cardholder ${name} received the cleaning at ${address} on ${date}, as shown in the Completion Summary, page 1. Any complaint and the remedy offered are in the Customer communication packet.`;
  } else if (reason === "subscription_canceled") {
    opening = `The cancellation terms the cardholder accepted are in the Refund and cancellation policy, page 1. The Customer communication packet shows when and how cancellation was requested.`;
  } else if (reason === "credit_not_processed") {
    opening = `The refund terms, and any refund already issued, are in the Refund and cancellation policy, page 1, and the Receipt and charge breakdown. The Customer communication packet shows the messages about the credit.`;
  } else if (reason === "duplicate") {
    opening = `The disputed payments are separate charges, as shown in the Receipt and charge breakdown, page 1. Each line states what that charge was for.`;
  } else {
    opening = `The records for ${name} on ${date} are in the Completion Summary, page 1, and the Acceptance Record. The Customer communication packet shows the messages about this service.`;
  }
  const timeline = [
    `Booking reference ${shown(input.bookingRef)}.`,
    `Agreement accepted: ${shown(input.acceptance?.signedAt)}.`,
    `Service date: ${date}.`,
    input.remedy?.offered
      ? `A remedy was offered: ${redactInternal(input.remedy.offered, input.redact)}. The customer's recorded reply is ${shown(input.remedy.customerResponse)}.`
      : `A remedy offer is ${NOT_RECORDED}.`,
    "This note states the records. It does not infer why the cardholder filed the dispute.",
  ];
  return [opening, ...timeline].join(" ");
}

function touchpointTimeline(input: DisputeBuildInput): string {
  const a = input.acceptance;
  return [
    `Agreement accepted: ${shown(a?.signedAt)}`,
    `Signature captured: ${shown(a?.signerName ? a.signedAt : null)}`,
    `Deposit payment: ${shown(input.charges?.find((c) => /deposit/i.test(`${c.kind || ""} ${c.label}`))?.paymentIntentId)}`,
    `Service date: ${shown(input.serviceDate)}`,
  ].join(" | ");
}

function fileTag(input: DisputeBuildInput): string {
  return String(input.bookingRef || input.disputeId || "case").replace(/[^\w.-]+/g, "-");
}

function packetBase(limits: DisputeEvidenceLimits): Pick<PacketDoc, "photoMinHeight" | "photoMinWidth" | "photoMaxHeight"> {
  return {
    photoMinHeight: limits.minPhotoHeightPt,
    photoMinWidth: limits.minPhotoWidthPt,
    photoMaxHeight: limits.photoMaxHeightPt,
  };
}

export function buildDisputeEvidence(input: DisputeBuildInput): DisputeEvidenceSet {
  const limits: DisputeEvidenceLimits = {
    ...STRIPE_EVIDENCE_LIMITS,
    ...input.limits,
    packetPages: { ...STRIPE_EVIDENCE_LIMITS.packetPages, ...input.limits?.packetPages },
  };
  const now = input.now || new Date().toISOString();
  const messages = [...(input.messages || [])].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const policyField = policyFieldFor(input.reason, messages);
  const warnings: string[] = [];
  const missing: string[] = [];

  const flag = (label: string, value: string | null | undefined) => {
    if (!value?.trim()) missing.push(label);
  };
  flag("customer name", input.customerName);
  flag("customer email", input.customerEmail);
  flag("billing address", input.billingAddress);
  flag("service date", input.serviceDate);
  flag("purchase IP", input.purchaseIp);
  flag("agreement signature time", input.acceptance?.signedAt);
  if (!input.acceptance?.ip?.trim()) missing.push("signature IP");
  if (!input.acceptance?.userAgent?.trim() || isServerRuntime(input.acceptance?.userAgent)) missing.push("customer device");

  const summary = summaryLines(input, limits.packetPages.service_documentation, limits);
  warnings.push(...summary.warnings);

  const comm = selectMessages(
    messages,
    input.reason,
    input.redact,
    lineBudget(limits.packetPages.customer_communication) - 6,
    input.pinnedMessageIds || [],
  );
  warnings.push(...comm.warnings);
  const base = packetBase(limits);

  const packets: PacketDoc[] = [
    {
      id: "completion",
      filename: `completion-summary-${fileTag(input)}.pdf`,
      stripeField: "service_documentation",
      title: "Completion summary",
      lines: summary.lines.map((line) => redactInternal(line, input.redact)),
      pageCap: limits.packetPages.service_documentation,
      trimmed: summary.warnings.some((w) => w.includes("Photographs were reduced")),
      warnings: summary.warnings,
      images: summary.images,
      identity: identityFromInput(input, "Completion Summary"),
      ...base,
    },
    {
      id: "communication",
      filename: `customer-communication-${fileTag(input)}.pdf`,
      stripeField: "customer_communication",
      title: "Customer communication",
      lines: comm.lines,
      pageCap: limits.packetPages.customer_communication,
      trimmed: comm.omitted > 0,
      warnings: comm.warnings,
      identity: identityFromInput(input, "Customer communication"),
      ...base,
    },
    {
      id: "acceptance",
      filename: `acceptance-record-${fileTag(input)}.pdf`,
      stripeField: "customer_signature",
      title: "Acceptance record",
      lines: acceptanceLines(input.acceptance, input.policySnapshot, input.redact).map((line) => redactInternal(line, input.redact)),
      signature: input.acceptance?.signatureBytes?.byteLength ? { bytes: input.acceptance.signatureBytes } : null,
      pageCap: limits.packetPages.customer_signature,
      trimmed: false,
      warnings: [],
      identity: identityFromInput(input, "Acceptance Record"),
      ...base,
    },
  ];

  if (policyField) {
    const lines = policyLines(policyField, input.policySnapshot);
    packets.push({
      id: "policy",
      filename: `${policyField.replace(/_/g, "-")}-${fileTag(input)}.pdf`,
      stripeField: policyField,
      title: "Refund and cancellation policy",
      lines,
      pageCap: limits.packetPages.policy,
      trimmed: false,
      warnings: input.policySnapshot?.acceptedVersionRecorded ? [] : ["The policy version in force at acceptance was not recorded."],
      identity: identityFromInput(input, "Refund and cancellation policy"),
      ...base,
    });
    if (!input.policySnapshot?.acceptedVersionRecorded) warnings.push("The policy version in force at acceptance was not recorded.");
  }

  const receipt = receiptLines(input);
  if (receipt) {
    const field = input.reason.toLowerCase() === "duplicate" ? "duplicate_charge_documentation" : "receipt";
    packets.push({
      id: "receipt",
      filename: `${field.replace(/_/g, "-")}-${fileTag(input)}.pdf`,
      stripeField: field,
      title: "Receipt and charge breakdown",
      lines: receipt,
      pageCap: limits.packetPages.receipt,
      trimmed: false,
      warnings: [],
      identity: identityFromInput(input, "Receipt and charge breakdown"),
      ...base,
    });
  }

  const otherItems = input.otherItems || [];
  if (otherItems.some((item) => item.text?.trim())) {
    const cap = lineBudget(limits.packetPages.uncategorized_file);
    const ranked = [...otherItems].filter((item) => item.text?.trim()).sort((a, b) => b.priority - a.priority);
    const lines = ["Index: items below are not repeated from the other packets."];
    let used = 2;
    let kept = 0;
    for (const item of ranked) {
      const added = item.addedBy?.trim() ? ` added by ${item.addedBy.trim()}` : "";
      const block = ["", `${item.at}  source ${item.source}${added}`, redactInternal(item.text, input.redact)];
      if (used + block.length > cap) continue;
      lines.push(...block);
      used += block.length;
      kept++;
    }
    const omitted = ranked.length - kept;
    if (omitted) lines.push("", `${omitted} lower-priority items were left out of Other Evidence because of the page cap.`);
    if (kept > 0) {
      packets.push({
        id: "other",
        filename: `uncategorized-file-${input.disputeId}.pdf`,
        stripeField: "uncategorized_file",
        title: "Other evidence",
        lines,
        pageCap: limits.packetPages.uncategorized_file,
        trimmed: omitted > 0,
        warnings: [],
        identity: identityFromInput(input, "Other evidence"),
        ...base,
      });
    }
  }

  const order = packetOrder(input.reason);
  packets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const narrative = redactInternal(narrativeFor(input), input.redact);
  for (const phrase of FORBIDDEN_NARRATIVE) {
    if (narrative.toLowerCase().includes(phrase)) {
      warnings.push(`Narrative contained forbidden phrasing and was rejected: ${phrase}`);
    }
  }

  const textFields: Record<string, string> = {
    customer_name: shown(input.customerName),
    customer_email_address: shown(input.customerEmail),
    billing_address: shown(input.billingAddress),
    product_description: shown(input.serviceDescription),
    service_date: shown(input.serviceDate),
    customer_purchase_ip: shown(input.purchaseIp),
    uncategorized_text: narrative,
    refund_policy_disclosure: policyField === "refund_policy"
      ? "The refund terms the customer accepted are in the policy file. See the Acceptance Record for the signature and timestamp."
      : "Refund terms are cited in the case record. See the policy file when one is attached.",
    cancellation_policy_disclosure: policyField === "cancellation_policy"
      ? "The cancellation terms the customer accepted are in the policy file."
      : "Cancellation terms are the clauses quoted in the policy file when one is attached.",
  };
  textFields.access_activity_log = touchpointTimeline(input);

  const fields = new Set<string>();
  for (const p of packets) {
    if (fields.has(p.stripeField)) warnings.push(`Duplicate file for evidence type ${p.stripeField}.`);
    fields.add(p.stripeField);
  }

  const estimatedPages = packets.reduce((n, p) => n + Math.max(1, Math.ceil(p.lines.reduce((c, line) => c + wrapCount(line), 0) / LINES_PER_PAGE)), 0);
  const estimatedBytes = packets.reduce((n, p) => n + p.lines.join("\n").length * 2 + 2000, 0);
  if (estimatedPages > limits.combinedPages) warnings.push(`Estimated pages ${estimatedPages} exceed ${limits.combinedPages}.`);
  const textLen = Object.values(textFields).join("").length;
  if (textLen > limits.textCharacters) warnings.push("Text fields exceed the character budget.");

  return {
    disputeId: input.disputeId,
    reason: input.reason,
    packets,
    textFields,
    narrative,
    warnings,
    missing,
    estimatedPages,
    estimatedBytes,
    policyField,
    reminder: reminderLevel(input.evidenceDueAt, now),
    omittedMessages: comm.omitted,
  };
}

export function packetContains(set: DisputeEvidenceSet, needle: string): boolean {
  return set.packets.some((p) => p.lines.some((line) => line.includes(needle)));
}

export function narrativeHasForbidden(narrative: string): string | null {
  const hay = narrative.toLowerCase();
  return FORBIDDEN_NARRATIVE.find((phrase) => hay.includes(phrase)) || null;
}
