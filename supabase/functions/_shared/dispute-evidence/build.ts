// Builds the fixed Stripe dispute evidence set from records that already exist.
// Missing values are the words "not recorded". Nothing here is guessed.
// Communication excerpts are copied verbatim. Transcripts are never written.

import {
  LINES_PER_PAGE,
  STRIPE_EVIDENCE_LIMITS,
  lineBudget,
  type DisputeEvidenceLimits,
} from "./limits.ts";
import { POLICY_CITATIONS, RECORDED_POLICY_CLAUSES, VERSION_NOT_RECORDED } from "./policies.ts";

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
}

export interface EvidencePhoto {
  label: string;
  /** When absent, the summary says the image was not recorded. */
  bytes?: Uint8Array | null;
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
  acknowledgments?: Array<{ label: string; accepted?: boolean | null }>;
  relationship?: "residential" | "str_host" | "property_manager" | "commercial" | string | null;
}

export interface ChargeLine {
  label: string;
  amountCents: number | null;
  paymentIntentId?: string | null;
  kind?: string | null;
}

export interface DisputeBuildInput {
  disputeId: string;
  reason: DisputeReason;
  evidenceDueAt?: string | null;
  now?: string | null;
  bookingRef?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  billingAddress?: string | null;
  serviceDescription?: string | null;
  serviceDate?: string | null;
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
  remedy?: {
    offered?: string | null;
    offeredAt?: string | null;
    customerResponse?: string | null;
  } | null;
  messages?: EvidenceMessage[];
  acceptance?: AcceptanceInput | null;
  charges?: ChargeLine[];
  disputedAmountCents?: number | null;
  /** Names and phones that must never appear (contractor, other customers). */
  redact?: { names?: string[]; phones?: string[] };
  limits?: Partial<DisputeEvidenceLimits>;
}

export interface PacketDoc {
  id: "completion" | "communication" | "acceptance" | "policy" | "receipt";
  filename: string;
  stripeField: string;
  title: string;
  lines: string[];
  pageCap: number;
  trimmed: boolean;
  warnings: string[];
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

export function reminderLevel(dueAt: string | null | undefined, nowIso: string): "none" | "reminder" | "urgent" {
  if (!dueAt) return "none";
  const ms = Date.parse(dueAt) - Date.parse(nowIso);
  if (!Number.isFinite(ms)) return "none";
  if (ms <= 24 * 60 * 60 * 1000) return "urgent";
  if (ms <= 48 * 60 * 60 * 1000) return "reminder";
  return "none";
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

function scoreMessage(m: EvidenceMessage, reason: string): number {
  const hay = `${m.body || ""} ${m.transcript || ""}`.toLowerCase();
  let score = 0;
  if (/\b(refund|cancel|chargeback|reschedul|not satisfied|incomplete|wasn't|was not|prefer)\b/.test(hay)) score += 5;
  if (/\b(booked|deposit|agreement|confirm|3pm|3 pm|arrived|complete|checklist)\b/.test(hay)) score += 3;
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
): { lines: string[]; omitted: number; warnings: string[] } {
  const warnings: string[] = [];
  const ranked = messages.map((m, index) => ({
    m,
    index,
    score: scoreMessage(m, reason),
    required: isUnfavorableRelevant(m, reason),
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
    if (row.score <= 0) continue;
    if (!take(row, false)) break;
  }
  chosen.sort((a, b) => a.index - b.index);
  const lines = ["Timeline: inquiry, booking, agreement, deposit, service, and any complaint are in the excerpts below."];
  for (const row of chosen) {
    lines.push("");
    lines.push(...messageExcerpt(row.m, redact));
  }
  const omitted = messages.length - chosen.length;
  lines.push("");
  lines.push(`${omitted} routine messages were omitted. The full history is available on request.`);
  return { lines, omitted, warnings };
}

function acceptanceLines(a: AcceptanceInput | null | undefined, redact?: DisputeBuildInput["redact"]): string[] {
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
  return [
    "This record is the proof of agreement. The full agreement is archived and is not attached.",
    `Relationship: ${relationship}`,
    `Signer: ${shown(src.signerName)}`,
    `Email: ${shown(src.email)}`,
    `Phone: ${shown(src.phone)}`,
    `Signed at: ${shown(src.signedAt)}`,
    `IP address: ${shown(src.ip)}`,
    `Device or browser: ${device}`,
    `Agreement: ${doc}`,
    `Amount authorized: ${shown(src.amountLabel)}`,
    `Deposit terms: ${shown(src.depositLabel)}`,
    `Balance terms: ${shown(src.balanceLabel)}`,
    "Acknowledgments:",
    ...acks,
  ];
}

function policyLines(field: string | null): string[] {
  const which = field === "cancellation_policy"
    ? "This file is attached to the cancellation policy field."
    : field === "refund_policy"
      ? "This file is attached to the refund policy field."
      : "This file explains both policies. Attach it to the field chosen for this dispute reason.";
  return [
    which,
    "How cancellation works: a cancellation needs notice. Same-day cancellation, no-show, and an access failure caused by the customer forfeit the service amount. Membership cancellation needs 14 days' written notice before the next bill.",
    "How refunds work: once the service is rendered, the payment is final outside the stated exceptions. The remedy for a quality concern is a complimentary re-clean, not a refund. A written report is due within 24 hours.",
    "Published locations of the policies, printed as citations only:",
    ...POLICY_CITATIONS,
    VERSION_NOT_RECORDED,
    "Clauses stored on the booking record:",
    ...RECORDED_POLICY_CLAUSES.flatMap((c) => [`- ${c.text}`, `  Source: ${c.cite}`]),
    "Acceptance of these terms is the timestamp and signature on the Acceptance Record.",
  ];
}

function summaryLines(input: DisputeBuildInput): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const photos = input.photos || [];
  const lines = [
    `Booking ${shown(input.bookingRef)}`,
    `Service: ${shown(input.serviceDescription)}`,
    `Service date: ${shown(input.serviceDate)}`,
    `Scheduled window: ${shown(input.scheduledWindow)}`,
    `Arrived: ${shown(input.arrivedAt)}`,
    `Started: ${shown(input.startedAt)}`,
    `Finished: ${shown(input.finishedAt)}`,
    `Geotag: ${shown(input.geotag)}`,
    `Checklist: ${
      input.checklistCompleted == null || input.checklistTotal == null
        ? NOT_RECORDED
        : `${input.checklistCompleted}/${input.checklistTotal}`
    }`,
    `Photographs on file: ${photos.length === 0 ? NOT_RECORDED : String(photos.length)}`,
    "Assigned cleaner: referred to by job only. Contractor name and phone are omitted.",
  ];
  if (!input.arrivedAt && !input.startedAt) warnings.push("Arrival and start times were not recorded.");
  if (photos.length === 0) warnings.push("No photographs were recorded. Flagged for admin review.");
  if (input.remedy?.offered) {
    lines.push(`Remedy offered: ${redactInternal(input.remedy.offered, input.redact)} at ${shown(input.remedy.offeredAt)}`);
    lines.push(`Customer response: ${shown(input.remedy.customerResponse ? redactInternal(input.remedy.customerResponse, input.redact) : null)}`);
  } else {
    lines.push(`Remedy offered: ${NOT_RECORDED}`);
  }
  for (const z of input.zoneLines || []) lines.push(redactInternal(z, input.redact));
  const cap = lineBudget(STRIPE_EVIDENCE_LIMITS.packetPages.service_documentation) - 4;
  let photoLines = photos.map((p, i) => `Photo ${i + 1}: ${redactInternal(p.label, input.redact)}${p.bytes ? "" : " - image bytes not recorded"}`);
  let trimmed = false;
  while (lines.length + photoLines.length > cap && photoLines.length > 1) {
    photoLines = photoLines.slice(0, -1);
    trimmed = true;
  }
  if (trimmed) {
    warnings.push(`Photographs were reduced to fit the completion summary page cap. ${photos.length - photoLines.length} not shown.`);
    photoLines.push(`${photos.length - photoLines.length} additional photographs were not included because of the page cap.`);
  }
  return { lines: [...lines, ...photoLines], warnings };
}

function receiptLines(input: DisputeBuildInput): string[] | null {
  const reason = input.reason.toLowerCase();
  const charges = input.charges || [];
  const needs = reason === "duplicate" || (input.disputedAmountCents != null && charges.length > 1);
  if (!needs) return null;
  if (!charges.length) {
    return [`Disputed amount cents: ${input.disputedAmountCents ?? NOT_RECORDED}`, `Charge breakdown: ${NOT_RECORDED}`];
  }
  return [
    reason === "duplicate" ? "These are separate charges. Each line is a different payment." : "Charge breakdown for the disputed payment.",
    ...charges.map((c) => {
      const amt = c.amountCents == null ? NOT_RECORDED : `$${(c.amountCents / 100).toFixed(2)}`;
      return `${c.label}: ${amt}  ${c.kind || ""}  ${c.paymentIntentId || NOT_RECORDED}`.trim();
    }),
  ];
}

function narrativeFor(input: DisputeBuildInput): string {
  const parts = [
    `The service sold was ${shown(input.serviceDescription)} on ${shown(input.serviceDate)} for ${shown(input.customerName)}.`,
    `The billing address on the booking is ${shown(input.billingAddress)}.`,
    `The purchase IP on the booking session is ${shown(input.purchaseIp)}.`,
    input.acceptance?.signedAt
      ? `The customer accepted the agreement at ${input.acceptance.signedAt}.`
      : `Agreement acceptance time is ${NOT_RECORDED}.`,
    input.remedy?.offered
      ? `A remedy was offered: ${redactInternal(input.remedy.offered, input.redact)}. The customer's recorded reply is ${shown(input.remedy.customerResponse)}.`
      : `A remedy offer is ${NOT_RECORDED}.`,
    "This note states the records. It does not infer why the cardholder filed the dispute.",
  ];
  return parts.join(" ");
}

function touchpointTimeline(input: DisputeBuildInput): string {
  const a = input.acceptance;
  return [
    `Agreement accepted: ${shown(a?.signedAt)}`,
    `Signature captured: ${shown(a?.signerName ? a.signedAt : null)}`,
    `Deposit payment: ${shown(input.charges?.find((c) => /deposit/i.test(c.label))?.paymentIntentId)}`,
    `Service date: ${shown(input.serviceDate)}`,
  ].join(" | ");
}

export function buildDisputeEvidence(input: DisputeBuildInput): DisputeEvidenceSet {
  const limits = { ...STRIPE_EVIDENCE_LIMITS, ...input.limits, packetPages: { ...STRIPE_EVIDENCE_LIMITS.packetPages, ...input.limits?.packetPages } };
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

  const summary = summaryLines(input);
  warnings.push(...summary.warnings);

  const comm = selectMessages(
    messages,
    input.reason,
    input.redact,
    lineBudget(limits.packetPages.customer_communication) - 6,
  );
  warnings.push(...comm.warnings);

  const packets: PacketDoc[] = [
    {
      id: "completion",
      filename: `service-documentation-${input.disputeId}.pdf`,
      stripeField: "service_documentation",
      title: "Completion summary",
      lines: summary.lines,
      pageCap: limits.packetPages.service_documentation,
      trimmed: summary.warnings.some((w) => w.includes("Photographs were reduced")),
      warnings: summary.warnings,
    },
    {
      id: "communication",
      filename: `customer-communication-${input.disputeId}.pdf`,
      stripeField: "customer_communication",
      title: "Customer communication",
      lines: comm.lines,
      pageCap: limits.packetPages.customer_communication,
      trimmed: comm.omitted > 0,
      warnings: comm.warnings,
    },
    {
      id: "acceptance",
      filename: `customer-signature-${input.disputeId}.pdf`,
      stripeField: "customer_signature",
      title: "Acceptance record",
      lines: acceptanceLines(input.acceptance, input.redact),
      pageCap: limits.packetPages.customer_signature,
      trimmed: false,
      warnings: [],
    },
  ];

  if (policyField) {
    packets.push({
      id: "policy",
      filename: `${policyField.replace(/_/g, "-")}-${input.disputeId}.pdf`,
      stripeField: policyField,
      title: "Refund and cancellation policy",
      lines: policyLines(policyField),
      pageCap: limits.packetPages.policy,
      trimmed: false,
      warnings: ["Full policy snapshot at booking was not recorded."],
    });
    warnings.push("Full policy snapshot at booking was not recorded.");
  }

  const receipt = receiptLines(input);
  if (receipt) {
    const field = input.reason.toLowerCase() === "duplicate" ? "duplicate_charge_documentation" : "receipt";
    packets.push({
      id: "receipt",
      filename: `${field.replace(/_/g, "-")}-${input.disputeId}.pdf`,
      stripeField: field,
      title: "Receipt and charge breakdown",
      lines: receipt,
      pageCap: limits.packetPages.receipt,
      trimmed: false,
      warnings: [],
    });
  }

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
      ? "The refund terms the customer accepted are in the policy file. The remedy for a quality concern is a complimentary re-clean."
      : "Refund terms are cited in the case record. See the policy file when one is attached.",
    cancellation_policy_disclosure: policyField === "cancellation_policy"
      ? "The cancellation terms the customer accepted are in the policy file."
      : "Cancellation terms require notice. Same-day cancellation forfeits the service amount.",
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
