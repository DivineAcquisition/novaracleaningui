// Contractor statement form — policy helpers shared by the tokenized
// page, qc-issues, the reminder/overdue runner, and offline tests.
//
// A written statement is evidence, not a finding. Non-response is a
// factual flag only. This module never writes Score, accountability,
// contractor status, or QC case status.

export const QC_STATEMENT_SETTINGS_KEY = "qc_statement_settings";
export const QC_STATEMENT_PORTAL_HOST = "https://contractor.novaracleaning.com";
export const QC_STATEMENT_STORAGE_BUCKET = "qc-statement-files";

export const QC_STATEMENT_STATUSES = ["none", "requested", "submitted", "not_provided"] as const;
export type QcStatementStatus = (typeof QC_STATEMENT_STATUSES)[number];

export const QC_STATEMENT_REQUEST_STATUSES = ["requested", "submitted", "not_provided"] as const;
export type QcStatementRequestStatus = (typeof QC_STATEMENT_REQUEST_STATUSES)[number];

export const QC_STATEMENT_KINDS = ["original", "supplemental"] as const;
export type QcStatementKind = (typeof QC_STATEMENT_KINDS)[number];

export interface QcStatementSettings {
  due_hours: number;
  reminder_hours_before: number;
  token_ttl_days: number;
  required_issue_types: string[];
  required_severities: string[];
}

export const DEFAULT_QC_STATEMENT_SETTINGS: QcStatementSettings = {
  due_hours: 48,
  reminder_hours_before: 24,
  token_ttl_days: 14,
  required_issue_types: ["serious_allegation", "damage", "conduct"],
  required_severities: ["critical"],
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback.slice();
  const out = value.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  return out.length ? Array.from(new Set(out)) : fallback.slice();
}

export function parseQcStatementSettings(raw: unknown): QcStatementSettings {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const due = clampInt(src.due_hours, DEFAULT_QC_STATEMENT_SETTINGS.due_hours, 1, 336);
  let reminder = clampInt(
    src.reminder_hours_before,
    DEFAULT_QC_STATEMENT_SETTINGS.reminder_hours_before,
    1,
    336,
  );
  if (reminder >= due) reminder = Math.max(1, due - 1);
  return {
    due_hours: due,
    reminder_hours_before: reminder,
    token_ttl_days: clampInt(src.token_ttl_days, DEFAULT_QC_STATEMENT_SETTINGS.token_ttl_days, 1, 90),
    required_issue_types: stringList(src.required_issue_types, DEFAULT_QC_STATEMENT_SETTINGS.required_issue_types),
    required_severities: stringList(src.required_severities, DEFAULT_QC_STATEMENT_SETTINGS.required_severities),
  };
}

/** Incident/allegation, damage, conduct, and highest-severity cases default on. Routine complaints do not. */
export function statementRequiredByDefault(
  issueType: string | null | undefined,
  severity: string | null | undefined,
  settings: QcStatementSettings = DEFAULT_QC_STATEMENT_SETTINGS,
): boolean {
  const type = String(issueType || "").toLowerCase();
  const sev = String(severity || "").toLowerCase();
  if (settings.required_issue_types.includes(type)) return true;
  if (settings.required_severities.includes(sev)) return true;
  return false;
}

export function qcStatementLink(token: string): string {
  return `${QC_STATEMENT_PORTAL_HOST}/cleaner/statement/${encodeURIComponent(token)}`;
}

export function generalLocation(city?: string | null, state?: string | null): string {
  const c = String(city || "").trim();
  const s = String(state || "").trim();
  if (c && s) return `${c}, ${s}`;
  return c || s || "the job site";
}

export function formatServiceDate(iso?: string | null): string {
  const raw = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "the service date";
  const d = new Date(`${raw}T12:00:00-04:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export function formatDueBy(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "the due date";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export function dueAtFromNow(settings: QcStatementSettings, now = new Date()): Date {
  return new Date(now.getTime() + settings.due_hours * 3_600_000);
}

export function reminderAt(dueAt: Date, settings: QcStatementSettings): Date {
  return new Date(dueAt.getTime() - settings.reminder_hours_before * 3_600_000);
}

export function tokenExpiresAt(dueAt: Date, settings: QcStatementSettings, sentAt = new Date()): Date {
  const ttl = new Date(sentAt.getTime() + settings.token_ttl_days * 86_400_000);
  return ttl.getTime() > dueAt.getTime() ? ttl : new Date(dueAt.getTime() + 7 * 86_400_000);
}

/** Neutral request copy. Never states the allegation. Never implies a conclusion. */
export function statementSmsMessage(args: {
  firstName: string;
  generalLocation: string;
  serviceDate: string;
  dueBy: string;
  link: string;
  reminder?: boolean;
}): string {
  const name = String(args.firstName || "").trim() || "there";
  const loc = args.generalLocation || "the job site";
  const date = args.serviceDate || "the service date";
  const due = args.dueBy || "the due date";
  if (args.reminder) {
    return (
      `Hi ${name} — reminder: we still need your written account of the job at ${loc} on ${date} ` +
      `before we review it. Please complete the form by ${due}: ${args.link} Reply STOP to opt out.`
    );
  }
  return (
    `Hi ${name} — we've received a report regarding the job at ${loc} on ${date}, and we need ` +
    `your account of what happened before we review it. Please complete the form below by ${due}. ` +
    `This is your opportunity to give your side in writing and have it on the record. ${args.link} ` +
    `Reply STOP to opt out.`
  );
}

export function statementMessageImpliesConclusion(text: string): boolean {
  return /\b(guilty|at fault|you (did|caused|injured)|we (have )?determined|you are responsible|suspended|terminated)\b/i
    .test(text);
}

export function statementMessageLeaksAllegation(text: string, reportSummary: string): boolean {
  const report = String(reportSummary || "").trim().toLowerCase();
  if (report.length < 12) return false;
  const sms = String(text || "").toLowerCase();
  const distinctive = report.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 6);
  if (distinctive.length === 0) return false;
  const hits = distinctive.filter((w) => sms.includes(w));
  return hits.length >= Math.min(3, distinctive.length);
}

export interface QcStatementAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  driveFileId?: string | null;
  uploadedAt: string;
}

export interface QcStatementDraft {
  account: string;
  arrived: string;
  started: string;
  left: string;
  timelineNotes: string;
  reportResponse: string;
  othersPresent: string;
  attestationName: string;
  attested: boolean;
  attachments: QcStatementAttachment[];
}

export const EMPTY_QC_STATEMENT_DRAFT: QcStatementDraft = {
  account: "",
  arrived: "",
  started: "",
  left: "",
  timelineNotes: "",
  reportResponse: "",
  othersPresent: "",
  attestationName: "",
  attested: false,
  attachments: [],
};

function clip(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

export function normalizeQcStatementDraft(raw: unknown, fallback: QcStatementDraft = EMPTY_QC_STATEMENT_DRAFT): QcStatementDraft {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const attachments: QcStatementAttachment[] = [];
  const list = Array.isArray(src.attachments) ? src.attachments : fallback.attachments;
  for (const item of list.slice(0, 30)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const storagePath = String(a.storagePath || a.storage_path || "").trim();
    if (!storagePath) continue;
    attachments.push({
      id: String(a.id || cryptoRandomId()),
      filename: clip(a.filename, 200) || "file",
      contentType: clip(a.contentType || a.content_type, 120) || "application/octet-stream",
      size: Math.max(0, Number(a.size) || 0),
      storagePath,
      driveFileId: a.driveFileId || a.drive_file_id ? String(a.driveFileId || a.drive_file_id) : null,
      uploadedAt: String(a.uploadedAt || a.uploaded_at || new Date().toISOString()),
    });
  }
  return {
    account: clip(src.account ?? fallback.account, 20000),
    arrived: clip(src.arrived ?? fallback.arrived, 80),
    started: clip(src.started ?? fallback.started, 80),
    left: clip(src.left ?? fallback.left, 80),
    timelineNotes: clip(src.timelineNotes ?? src.timeline_notes ?? fallback.timelineNotes, 8000),
    reportResponse: clip(src.reportResponse ?? src.report_response ?? fallback.reportResponse, 20000),
    othersPresent: clip(src.othersPresent ?? src.others_present ?? fallback.othersPresent, 4000),
    attestationName: clip(src.attestationName ?? src.attestation_name ?? fallback.attestationName, 120),
    attested: src.attested === true || src.attested === "true" || fallback.attested,
    attachments,
  };
}

function cryptoRandomId(): string {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `att-${Date.now()}`;
  }
}

export function qcStatementDraftComplete(draft: QcStatementDraft): boolean {
  const timelineOk = Boolean(
    draft.arrived.trim() || draft.started.trim() || draft.left.trim() || draft.timelineNotes.trim(),
  );
  return Boolean(
    draft.account.trim()
    && draft.reportResponse.trim()
    && draft.othersPresent.trim()
    && draft.attestationName.trim()
    && draft.attested
    && timelineOk,
  );
}

export function deriveIssueStatementStatus(args: {
  required?: boolean;
  submissionCount: number;
  openRequested: boolean;
  notProvided: boolean;
}): QcStatementStatus {
  if (args.submissionCount > 0) return "submitted";
  if (args.notProvided) return "not_provided";
  if (args.openRequested || args.required) return "requested";
  return "none";
}

export type StatementSweepAction = "none" | "remind" | "mark_not_provided";

/** Reminder before due; after due, flag not_provided. Never a penalty. */
export function statementSweepAction(args: {
  status: string;
  submittedAt?: string | null;
  dueAt: string | Date | null;
  reminderSentAt?: string | null;
  reminderHoursBefore: number;
  now?: Date;
}): StatementSweepAction {
  if (args.submittedAt) return "none";
  if (String(args.status) !== "requested") return "none";
  const due = args.dueAt instanceof Date ? args.dueAt : args.dueAt ? new Date(args.dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return "none";
  const now = args.now || new Date();
  if (now.getTime() >= due.getTime()) return "mark_not_provided";
  const remindAt = due.getTime() - args.reminderHoursBefore * 3_600_000;
  if (!args.reminderSentAt && now.getTime() >= remindAt) return "remind";
  return "none";
}

/** Tables/columns the overdue path is forbidden to touch. */
export const QC_STATEMENT_OVERDUE_FORBIDDEN = {
  tables: ["cleaners", "accountability_actions", "cleaner_terminations"] as const,
  issueColumns: ["status", "severity", "score_exempt", "cleaner_id"] as const,
  scoreFields: ["novara_score", "quality_score", "overall_score"] as const,
};

export function factualReportSummary(args: {
  description?: string | null;
  title?: string | null;
  clientName?: string | null;
}): string {
  const body = String(args.description || "").trim();
  if (body) {
    return `The client reported that the following occurred during this visit:\n\n${body}`;
  }
  const title = String(args.title || "").trim();
  const who = String(args.clientName || "the client").trim() || "the client";
  if (title) return `${who} reported that ${title} occurred during this visit.`;
  return `${who} reported an issue during this visit. No additional detail is on the form besides the job context below.`;
}

export function statementKindForIssue(existingSubmissionCount: number): QcStatementKind {
  return existingSubmissionCount > 0 ? "supplemental" : "original";
}

export interface QcStatementPdfInput {
  issueNumber: number | string;
  bookingRef: string;
  serviceDate: string;
  generalLocation: string;
  serviceType: string;
  contractorName: string;
  kind: string;
  sequence: number;
  reportSummary: string;
  account: string;
  arrived: string;
  started: string;
  left: string;
  timelineNotes: string;
  reportResponse: string;
  othersPresent: string;
  attestationName: string;
  attestedAt: string;
  attachmentNames: string[];
  driveFolderUrl?: string | null;
  submittedAt: string;
}
