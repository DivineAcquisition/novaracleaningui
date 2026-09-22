// Factual summary and evidence index for an escalated QC case.
//
// Every line is copied from a timestamped log entry or a structured field
// already stored on the case. A missing timestamp stays missing. A missing
// field is omitted. Nothing here decides fault.

export const FACTUAL_SUMMARY_DISCLAIMER =
  "Prepared as a factual summary and evidence index. This is not a legal filing and does not constitute legal advice. Recommend review by an attorney before use in any proceeding.";

export const FACTUAL_SUMMARY_TITLE = "Factual Summary and Evidence Index";

export const TIMELINE_NOTE =
  "Listed below are the entries logged on this case, in the order of their stored timestamps. A period with no logged entry is left blank. No date was added to fill a gap.";

export const UNDATED_NOTE = "Timestamp not stored.";

export const NO_DESCRIPTION = "No description logged on the case.";

export const ADVOCACY_PHRASES = [
  "clearly",
  "obviously",
  "at fault",
  "not at fault",
  "liable",
  "negligent",
  "proves that",
  "must have",
  "without question",
];

export interface LoggedEntry {
  at?: string | null;
  source: string;
  label: string;
  text?: string | null;
}

export interface EvidenceMeta {
  id?: string | null;
  kind?: string | null;
  filename?: string | null;
  source?: string | null;
  received_at?: string | null;
  objective_description?: string | null;
  description?: string | null;
  /** Full attachment body. The index must not read this. */
  content?: string | null;
  content_text?: string | null;
}

export interface CorrespondenceEntry {
  id?: string | null;
  direction?: string | null;
  method?: string | null;
  at?: string | null;
  from?: string | null;
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface StatementLog {
  submitted_at?: string | null;
  sequence?: number | null;
  kind?: string | null;
  text?: string | null;
}

export interface ContractorPosition {
  stance?: string | null;
  subject?: string | null;
  changed?: boolean | null;
  source?: string | null;
  summary?: string | null;
}

export interface PaymentRequest {
  amount_cents?: number | null;
  basis?: string | null;
  at?: string | null;
}

export interface ClientPosition {
  stance?: string | null;
  amended?: boolean | null;
  withdrawn?: boolean | null;
  summary?: string | null;
  written_payment_requests?: PaymentRequest[] | null;
}

export interface MedicalFinding {
  finding?: string | null;
  basis?: string | null;
}

export interface MedicalRecordReview {
  confirmed?: MedicalFinding[] | null;
  ruled_out?: MedicalFinding[] | null;
  not_established?: MedicalFinding[] | null;
}

export interface EscalationRecord {
  indicated?: boolean | null;
  forum?: string | null;
  demand_amount_cents?: number | null;
  demand_currency?: string | null;
  communicated_at?: string | null;
  method?: string | null;
  summary?: string | null;
}

export interface InsuranceNotification {
  status?: string | null;
  notified_at?: string | null;
  method?: string | null;
  carrier_response?: string | null;
}

export interface GeneratedDocMeta {
  id?: string | null;
  generated_at?: string | null;
}

export interface CaseEventLog {
  created_at?: string | null;
  action?: string | null;
  note?: string | null;
  actor_name?: string | null;
  from_status?: string | null;
  to_status?: string | null;
}

export interface FactualSummaryInput {
  issueNumber?: number | string | null;
  bookingRef?: string | null;
  title?: string | null;
  status?: string | null;
  issueType?: string | null;
  createdAt?: string | null;
  managerAccount?: string | null;
  contractorStatement?: string | null;
  clientWrittenCommunication?: string | null;
  events?: CaseEventLog[] | null;
  correspondence?: CorrespondenceEntry[] | null;
  documents?: EvidenceMeta[] | null;
  evidenceFiles?: EvidenceMeta[] | null;
  statements?: StatementLog[] | null;
  priorSummaries?: GeneratedDocMeta[] | null;
  contractorPosition?: ContractorPosition | null;
  clientPosition?: ClientPosition | null;
  medicalRecordReview?: MedicalRecordReview | null;
  escalation?: EscalationRecord | null;
  insurance?: InsuranceNotification | null;
  generatedAt: string;
}

export interface TimelineItem {
  at: string | null;
  source: string;
  label: string;
  text: string | null;
  gapNote: string | null;
}

export interface PositionSection {
  heading: string;
  lines: string[];
}

export interface CorrespondenceBlock {
  lines: string[];
  body: string | null;
}

export interface FactualSummary {
  disclaimer: string;
  title: string;
  preamble: string;
  caseLines: string[];
  timelineNote: string;
  timelineDated: TimelineItem[];
  timelineUndated: TimelineItem[];
  evidence: string[];
  correspondence: CorrespondenceBlock[];
  positions: PositionSection[];
  generatedAt: string;
}

export function factualSummaryAvailable(issue: {
  status?: string | null;
  escalation?: { indicated?: boolean | null } | null;
} | null | undefined): boolean {
  if (!issue) return false;
  if (String(issue.status || "") === "escalated") return true;
  return issue.escalation?.indicated === true;
}

export function insuranceIsComplete(ins: InsuranceNotification | null | undefined): boolean {
  return String(ins?.status || "") === "notified" && Boolean(String(ins?.notified_at || "").trim());
}

export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.trunc(Math.abs(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
}

function storedIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const n = Date.parse(String(value));
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString();
}

function clean(value: string | null | undefined): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function fieldLine(label: string, value: string | number | boolean | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return `${label}: ${value ? "yes" : "no"}`;
  return `${label}: ${value}`;
}

export function evidenceIndexLine(doc: EvidenceMeta): string {
  const description = clean(doc.objective_description) || clean(doc.description) || NO_DESCRIPTION;
  const received = storedIso(doc.received_at);
  return [
    clean(doc.kind) || "document",
    clean(doc.filename) || "filename not stored",
    clean(doc.source) || "source not stored",
    received ? `received ${received}` : "received date not stored",
    description,
  ].join(" — ");
}

function findingLines(items: MedicalFinding[] | null | undefined, prefix: string): string[] {
  const lines: string[] = [];
  for (const item of items || []) {
    const finding = clean(item?.finding);
    if (!finding) continue;
    const basis = clean(item?.basis);
    lines.push(basis ? `${prefix}: ${finding} (${basis})` : `${prefix}: ${finding}`);
  }
  return lines;
}

function paymentLines(items: PaymentRequest[] | null | undefined): string[] {
  const lines: string[] = [];
  for (const item of items || []) {
    if (!item || typeof item !== "object") continue;
    const parts: string[] = ["Written payment request"];
    if (typeof item.amount_cents === "number" && Number.isFinite(item.amount_cents)) {
      parts.push(formatUsdCents(item.amount_cents));
    } else {
      parts.push("amount not stored");
    }
    parts.push(clean(item.basis) || "basis not stored");
    const at = storedIso(item.at);
    parts.push(at ? `at ${at}` : "date not stored");
    lines.push(parts.join(" — "));
  }
  return lines;
}

export function positionSections(input: Pick<
  FactualSummaryInput,
  "contractorPosition" | "clientPosition" | "medicalRecordReview" | "escalation" | "insurance"
>): PositionSection[] {
  const sections: PositionSection[] = [];

  const contractor = input.contractorPosition;
  if (contractor) {
    const lines = [
      fieldLine("Stance", clean(contractor.stance)),
      fieldLine("Subject", clean(contractor.subject)),
      fieldLine("Changed", contractor.changed == null ? null : contractor.changed),
      fieldLine("Source", clean(contractor.source)),
      fieldLine("Summary", clean(contractor.summary)),
    ].filter((l): l is string => Boolean(l));
    if (lines.length) sections.push({ heading: "Contractor position", lines });
  }

  const client = input.clientPosition;
  if (client) {
    const lines = [
      fieldLine("Stance", clean(client.stance)),
      fieldLine("Amended", client.amended == null ? null : client.amended),
      fieldLine("Withdrawn", client.withdrawn == null ? null : client.withdrawn),
      fieldLine("Summary", clean(client.summary)),
      ...paymentLines(client.written_payment_requests),
    ].filter((l): l is string => Boolean(l));
    if (lines.length) sections.push({ heading: "Client position", lines });
  }

  const review = input.medicalRecordReview;
  if (review) {
    const lines = [
      ...findingLines(review.confirmed, "Recorded finding"),
      ...findingLines(review.ruled_out, "Ruled out on the record"),
      ...findingLines(review.not_established, "Not established"),
    ];
    if (lines.length) sections.push({ heading: "Medical record review", lines });
  }

  const escalation = input.escalation;
  if (escalation) {
    const lines = [
      fieldLine("Indicated", escalation.indicated == null ? null : escalation.indicated),
      fieldLine("Forum", clean(escalation.forum)),
      typeof escalation.demand_amount_cents === "number" && Number.isFinite(escalation.demand_amount_cents)
        ? `Demand amount: ${formatUsdCents(escalation.demand_amount_cents)}${clean(escalation.demand_currency) ? ` ${clean(escalation.demand_currency)}` : ""}`
        : null,
      fieldLine("Communicated at", storedIso(escalation.communicated_at) || (escalation.communicated_at === undefined ? null : "not stored")),
      fieldLine("Method", clean(escalation.method) || (escalation.method === undefined ? null : "not stored")),
      fieldLine("Summary", clean(escalation.summary)),
    ].filter((l): l is string => Boolean(l));
    if (lines.length) sections.push({ heading: "Escalation", lines });
  }

  const insurance = input.insurance;
  if (insurance) {
    const status = clean(insurance.status) || "pending";
    const notified = status === "notified" && Boolean(storedIso(insurance.notified_at));
    const lines = [
      `Status: ${notified ? "notified" : "pending"}`,
      `Notification date: ${notified ? storedIso(insurance.notified_at) : "not recorded"}`,
      `Method: ${clean(insurance.method) || "not recorded"}`,
      `Carrier response: ${clean(insurance.carrier_response) || "not recorded"}`,
    ];
    sections.push({ heading: "Insurance carrier notification", lines });
  }

  return sections;
}

function pushEntry(bucket: LoggedEntry[], entry: LoggedEntry | null) {
  if (!entry) return;
  const label = clean(entry.label);
  if (!label) return;
  bucket.push({
    at: entry.at ?? null,
    source: entry.source,
    label,
    text: clean(entry.text),
  });
}

export function collectLoggedEntries(input: FactualSummaryInput): LoggedEntry[] {
  const entries: LoggedEntry[] = [];
  const hasCreatedEvent = (input.events || []).some((event) => clean(event.action) === "created");
  if (!hasCreatedEvent && (clean(input.createdAt) || clean(input.title))) {
    pushEntry(entries, {
      at: input.createdAt,
      source: "qc_issues",
      label: `Case opened${clean(input.title) ? `: ${clean(input.title)}` : ""}`,
    });
  }
  for (const event of input.events || []) {
    const action = clean(event.action) || "event";
    const note = clean(event.note);
    const actor = clean(event.actor_name);
    pushEntry(entries, {
      at: event.created_at,
      source: "qc_issue_events",
      label: [action, actor ? `by ${actor}` : null, note].filter(Boolean).join(" — "),
    });
  }
  if (clean(input.managerAccount)) {
    pushEntry(entries, {
      at: null,
      source: "qc_issues.manager_account",
      label: "Manager account on file",
      text: input.managerAccount,
    });
  }
  if (clean(input.contractorStatement)) {
    pushEntry(entries, {
      at: null,
      source: "qc_issues.contractor_statement",
      label: "Contractor statement notes on file",
      text: input.contractorStatement,
    });
  }
  if (clean(input.clientWrittenCommunication)) {
    pushEntry(entries, {
      at: null,
      source: "qc_issues.client_written_communication",
      label: "Client written communication on file",
      text: input.clientWrittenCommunication,
    });
  }
  for (const statement of input.statements || []) {
    const seq = statement.sequence ? ` sequence ${statement.sequence}` : "";
    const kind = clean(statement.kind);
    pushEntry(entries, {
      at: statement.submitted_at,
      source: "qc_statement_submissions",
      label: `Contractor statement submitted${kind ? ` (${kind})` : ""}${seq}`,
      text: statement.text,
    });
  }
  for (const doc of input.documents || []) {
    pushEntry(entries, {
      at: doc.received_at,
      source: "client_followup_documents",
      label: `Document attached (${clean(doc.kind) || "document"}): ${clean(doc.filename) || "filename not stored"}`,
    });
  }
  for (const file of input.evidenceFiles || []) {
    pushEntry(entries, {
      at: file.received_at,
      source: "evidence_files",
      label: `File attached (${clean(file.kind) || "file"}): ${clean(file.filename) || "filename not stored"}`,
    });
  }
  for (const mail of input.correspondence || []) {
    const direction = clean(mail.direction) || "logged";
    const method = clean(mail.method) || "message";
    pushEntry(entries, {
      at: mail.at,
      source: "correspondence_log",
      label: `Correspondence (${direction} ${method}): ${clean(mail.subject) || "subject not stored"}`,
    });
  }
  for (const prior of input.priorSummaries || []) {
    pushEntry(entries, {
      at: prior.generated_at,
      source: "generated_case_documents",
      label: `Factual summary generated${clean(prior.id) ? ` (${clean(prior.id)})` : ""}`,
    });
  }
  return entries;
}

export function splitTimeline(entries: LoggedEntry[]): { dated: TimelineItem[]; undated: TimelineItem[] } {
  const dated: TimelineItem[] = [];
  const undated: TimelineItem[] = [];
  for (const entry of entries) {
    const at = storedIso(entry.at);
    const item: TimelineItem = {
      at,
      source: entry.source,
      label: entry.label,
      text: clean(entry.text),
      gapNote: at ? null : UNDATED_NOTE,
    };
    if (at) dated.push(item);
    else undated.push(item);
  }
  dated.sort((a, b) => Date.parse(a.at || "") - Date.parse(b.at || ""));
  return { dated, undated };
}

function correspondenceBlocks(entries: CorrespondenceEntry[] | null | undefined): CorrespondenceBlock[] {
  return (entries || []).map((mail) => {
    const at = storedIso(mail.at);
    const lines = [
      fieldLine("Direction", clean(mail.direction)),
      fieldLine("Method", clean(mail.method)),
      fieldLine("At", at || (mail.at ? "not stored" : null)),
      !mail.at ? "At: not stored" : null,
      fieldLine("From", clean(mail.from)),
      fieldLine("To", clean(mail.to)),
      fieldLine("Subject", clean(mail.subject)),
    ].filter((l): l is string => Boolean(l));
    return {
      lines: lines.length ? lines : ["Correspondence entry with no stored fields"],
      body: clean(mail.body),
    };
  });
}

export function assembleFactualSummary(input: FactualSummaryInput): FactualSummary {
  const { dated, undated } = splitTimeline(collectLoggedEntries(input));
  const evidence = [
    ...(input.documents || []).map(evidenceIndexLine),
    ...(input.evidenceFiles || []).map(evidenceIndexLine),
    ...(input.correspondence || []).map((mail) => evidenceIndexLine({
      kind: "correspondence",
      filename: clean(mail.subject),
      source: [clean(mail.direction), clean(mail.method)].filter(Boolean).join(" ") || null,
      received_at: mail.at,
      objective_description: [clean(mail.direction), clean(mail.method), clean(mail.subject)].filter(Boolean).join(" ") || null,
    })),
  ];
  const caseLines = [
    fieldLine("Issue", input.issueNumber == null || input.issueNumber === "" ? null : String(input.issueNumber)),
    fieldLine("Booking", clean(input.bookingRef)),
    fieldLine("Title", clean(input.title)),
    fieldLine("Status", clean(input.status)),
    fieldLine("Type", clean(input.issueType)),
    fieldLine("Generated at", storedIso(input.generatedAt) || input.generatedAt),
  ].filter((l): l is string => Boolean(l));

  return {
    disclaimer: FACTUAL_SUMMARY_DISCLAIMER,
    title: FACTUAL_SUMMARY_TITLE,
    preamble: "This document lists what is logged on the case. It does not add a conclusion.",
    caseLines,
    timelineNote: TIMELINE_NOTE,
    timelineDated: dated,
    timelineUndated: undated,
    evidence,
    correspondence: correspondenceBlocks(input.correspondence),
    positions: positionSections(input),
    generatedAt: storedIso(input.generatedAt) || input.generatedAt,
  };
}

export function authoredBoilerplate(summary: FactualSummary): string {
  return [
    summary.disclaimer,
    summary.title,
    summary.preamble,
    summary.timelineNote,
    UNDATED_NOTE,
    NO_DESCRIPTION,
    "Timeline",
    "Evidence index",
    "Correspondence",
    "Factual positions",
    "Case identification",
    ...summary.positions.map((s) => s.heading),
    ...summary.timelineUndated.map((item) => item.gapNote || ""),
  ].join("\n");
}

export function boilerplateAssertsFault(summary: FactualSummary): string | null {
  const text = authoredBoilerplate(summary).toLowerCase();
  for (const phrase of ADVOCACY_PHRASES) {
    if (text.includes(phrase)) return phrase;
  }
  return null;
}

function idOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const id = String((item as { id?: unknown }).id || "").trim();
  return id || null;
}

function entryKey(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const d = item as Record<string, unknown>;
  const key = [
    String(d.kind || ""),
    String(d.filename || ""),
    String(d.received_at || d.at || ""),
    String(d.description || d.objective_description || d.subject || ""),
  ].join("|");
  return key === "|||" ? null : key;
}

/** Keep every previously stored object. Append only entries that are not already present. */
export function preserveCaseEntries(oldRows: unknown, incoming: unknown): unknown[] {
  const oldArr = Array.isArray(oldRows) ? oldRows : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const ids = new Set(oldArr.map(idOf).filter((id): id is string => Boolean(id)));
  const keys = new Set(oldArr.map(entryKey).filter((key): key is string => Boolean(key)));
  const out = [...oldArr];
  for (const item of next) {
    const id = idOf(item);
    if (id && ids.has(id)) continue;
    const key = entryKey(item);
    if (key && keys.has(key)) continue;
    if (oldArr.some((prev) => JSON.stringify(prev) === JSON.stringify(item))) continue;
    out.push(item);
    if (id) ids.add(id);
    if (key) keys.add(key);
  }
  return out;
}

export function normalizeFollowupDocument(raw: unknown, enteredBy: string, nowIso: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const description = String(d.objective_description || d.description || "").trim().slice(0, 8000);
  const content = String(d.content || d.content_text || "").slice(0, 200000);
  const filename = d.filename ? String(d.filename).slice(0, 300) : null;
  if (!description && !content && !filename) return null;
  const received = storedIso(d.received_at ? String(d.received_at) : null) || nowIso;
  const doc: Record<string, unknown> = {
    received_at: received,
    kind: String(d.kind || "document").slice(0, 80),
    description: description.slice(0, 8000),
    objective_description: description.slice(0, 8000),
    source: d.source ? String(d.source).slice(0, 200) : null,
    url: d.url ? String(d.url).slice(0, 2000) : null,
    filename,
    content: content || null,
    document_id: d.document_id ? String(d.document_id).slice(0, 120) : null,
    sha256: d.sha256 ? String(d.sha256).slice(0, 80) : null,
    entered_by: d.entered_by ? String(d.entered_by).slice(0, 120) : enteredBy,
  };
  if (d.id) doc.id = String(d.id).slice(0, 120);
  return doc;
}

export function normalizeCorrespondence(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const body = String(d.body || "").slice(0, 100000);
  const subject = String(d.subject || "").trim().slice(0, 500);
  if (!body && !subject) return null;
  const row: Record<string, unknown> = {
    direction: d.direction ? String(d.direction).slice(0, 40) : null,
    method: d.method ? String(d.method).slice(0, 40) : null,
    at: storedIso(d.at ? String(d.at) : null),
    from: d.from ? String(d.from).slice(0, 200) : null,
    to: d.to ? String(d.to).slice(0, 200) : null,
    subject: subject || null,
    body: body || null,
    gmail_message_id: d.gmail_message_id ? String(d.gmail_message_id).slice(0, 80) : null,
  };
  if (d.id) row.id = String(d.id).slice(0, 120);
  return row;
}

export function normalizeInsurance(raw: unknown, existing?: InsuranceNotification | null): InsuranceNotification {
  const d = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const prev = existing || {};
  const statusRaw = d.status != null ? String(d.status) : (prev.status || "pending");
  const status = statusRaw === "notified" ? "notified" : "pending";
  const notifiedAt = status === "notified"
    ? storedIso(d.notified_at != null ? String(d.notified_at) : prev.notified_at)
    : null;
  return {
    status: status === "notified" && !notifiedAt ? "pending" : status,
    notified_at: status === "notified" ? notifiedAt : null,
    method: d.method !== undefined
      ? clean(d.method == null ? null : String(d.method))
      : (prev.method ?? null),
    carrier_response: d.carrier_response !== undefined
      ? clean(d.carrier_response == null ? null : String(d.carrier_response))
      : (prev.carrier_response ?? null),
  };
}
