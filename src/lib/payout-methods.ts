// Contractor payout methods: Stripe, plus manual methods paid in a pay run.
//
// Pay amounts, approvals, holds, and deductions are decided before this
// module. It only decides how a contractor gets that money, how a change
// is verified, and how a manual payment is recorded once.

import { cleanerSetupSteps, type CleanerSetupState } from "./cleaner-supplies";
import {
  CONTRACTOR_OPS_DISPLAY_NAME,
  CONTRACTOR_OPS_EMAIL,
  CONTRACTOR_OPS_FROM,
} from "./engagement-end";
import { necInclusion, type NecInclusion } from "./nec-1099";

export {
  CONTRACTOR_OPS_DISPLAY_NAME,
  CONTRACTOR_OPS_EMAIL,
  CONTRACTOR_OPS_FROM,
};

export const PAYOUT_SETTINGS_KEY = "contractor_payout_methods";
export const RECOMMENDED_LABEL = "Recommended: fastest, paid automatically.";
export const NO_TAX_WITHHELD =
  "No taxes were withheld because you are an independent contractor.";
export const PAYMENT_SUMMARY_TITLE = "Payment Summary";
export const OVERPAYMENT_SECTION = "7.9";

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type IdentifierFormat = "stripe" | "cashtag" | "email_or_phone" | "chime_sign" | "text";
export type PayoutMethodKind = "stripe" | "manual";

export type PayoutMethodDefinition = {
  code: string;
  displayName: string;
  enabled: boolean;
  kind: PayoutMethodKind;
  recommended: boolean;
  sortOrder: number;
  identifierFormat: IdentifierFormat;
  identifierLabel: string;
  /** What the contractor is asked to provide. */
  contractorProvides: string;
  /** Short instructions on the form. */
  instructions: string;
  /** One line on the chooser. Manual methods say they are paid on the pay run day. */
  summary: string;
  /**
   * Accountant's choice. Null until set. Never inferred.
   * Snapshotted onto each payout. Later edits do not rewrite old rows.
   */
  countsTowardOwn1099: boolean | null;
};

export type AcknowledgmentVersion = {
  id: string;
  text: string;
  createdAt: string;
};

export type PayoutSettings = {
  methods: PayoutMethodDefinition[];
  /** 0 = Sunday … 6 = Saturday. Default Friday. */
  payRunWeekday: number;
  changeHoldHours: number;
  agingDays: number;
  reminderIntervalDays: number;
  acknowledgmentVersions: AcknowledgmentVersion[];
  activeAcknowledgmentId: string;
};

export const DEFAULT_ACKNOWLEDGMENT_TEXT =
  "I confirm these payout details are accurate, and that Novara is not responsible for payments sent to the details I provided.";

const ACK_V1 = "ack-2026-10-15";

function method(
  partial: PayoutMethodDefinition,
): PayoutMethodDefinition {
  return partial;
}

export function defaultPayoutMethods(): PayoutMethodDefinition[] {
  return [
    method({
      code: "stripe",
      displayName: "Stripe",
      enabled: true,
      kind: "stripe",
      recommended: true,
      sortOrder: 0,
      identifierFormat: "stripe",
      identifierLabel: "Stripe account",
      contractorProvides: "Finish Stripe Connect. Novara does not collect a bank number here.",
      instructions: "Use the Stripe setup button. Stripe pays you automatically after a job is approved.",
      summary: "Paid automatically after a job is approved.",
      countsTowardOwn1099: null,
    }),
    method({
      code: "cash_app",
      displayName: "Cash App",
      enabled: true,
      kind: "manual",
      recommended: false,
      sortOrder: 1,
      identifierFormat: "cashtag",
      identifierLabel: "$Cashtag",
      contractorProvides: "The $Cashtag on the Cash App account.",
      instructions: "Enter the $Cashtag exactly as Cash App shows it, and the name on that account.",
      summary: "Paid weekly on Friday.",
      countsTowardOwn1099: null,
    }),
    method({
      code: "zelle",
      displayName: "Zelle",
      enabled: true,
      kind: "manual",
      recommended: false,
      sortOrder: 2,
      identifierFormat: "email_or_phone",
      identifierLabel: "Zelle email or mobile number",
      contractorProvides: "The email or mobile number enrolled with Zelle.",
      instructions: "Enter the email or mobile number that is enrolled with Zelle, and the name on that enrollment.",
      summary: "Paid weekly on Friday.",
      countsTowardOwn1099: null,
    }),
    method({
      code: "chime",
      displayName: "Chime",
      enabled: true,
      kind: "manual",
      recommended: false,
      sortOrder: 3,
      identifierFormat: "chime_sign",
      identifierLabel: "$ChimeSign",
      contractorProvides: "The $ChimeSign other Chime members use to pay you.",
      instructions:
        "Enter your $ChimeSign. In the Chime app it is under Profile, then Personal Info. It starts with $.",
      summary: "Paid weekly on Friday.",
      countsTowardOwn1099: null,
    }),
  ];
}

export function defaultPayoutSettings(now = "2026-10-15T00:00:00.000Z"): PayoutSettings {
  return {
    methods: defaultPayoutMethods(),
    payRunWeekday: 5,
    changeHoldHours: 48,
    agingDays: 10,
    reminderIntervalDays: 7,
    acknowledgmentVersions: [
      { id: ACK_V1, text: DEFAULT_ACKNOWLEDGMENT_TEXT, createdAt: now },
    ],
    activeAcknowledgmentId: ACK_V1,
  };
}

function asBoolOrNull(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function cleanText(value: unknown, max = 400): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function weekdayName(weekday: number): string {
  const index = Math.round(Number(weekday));
  return WEEKDAYS[index] || "Friday";
}

export function activeAcknowledgment(settings: PayoutSettings): AcknowledgmentVersion {
  return (
    settings.acknowledgmentVersions.find((v) => v.id === settings.activeAcknowledgmentId) ||
    settings.acknowledgmentVersions[settings.acknowledgmentVersions.length - 1]
  );
}

export function parsePayoutSettings(raw: unknown): PayoutSettings {
  const base = defaultPayoutSettings();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Partial<PayoutSettings>;
  const weekday = Math.round(Number(src.payRunWeekday));
  const versions = Array.isArray(src.acknowledgmentVersions)
    ? src.acknowledgmentVersions
        .map((v) => {
          if (!v || typeof v !== "object") return null;
          const row = v as AcknowledgmentVersion;
          const text = cleanText(row.text, 800);
          const id = cleanText(row.id, 80);
          if (!text || !id) return null;
          return { id, text, createdAt: cleanText(row.createdAt, 40) || base.acknowledgmentVersions[0].createdAt };
        })
        .filter((v): v is AcknowledgmentVersion => Boolean(v))
    : [];
  const methodsIn = Array.isArray(src.methods) ? src.methods : null;
  const methods = methodsIn
    ? methodsIn
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;
          const row = item as Partial<PayoutMethodDefinition>;
          const code = cleanText(row.code, 40).toLowerCase().replace(/[^a-z0-9_]/g, "");
          if (!code) return null;
          const format = String(row.identifierFormat || "");
          const identifierFormat: IdentifierFormat =
            format === "stripe" || format === "cashtag" || format === "email_or_phone" || format === "chime_sign" || format === "text"
              ? format
              : "text";
          const kind: PayoutMethodKind = row.kind === "stripe" || identifierFormat === "stripe" ? "stripe" : "manual";
          return method({
            code,
            displayName: cleanText(row.displayName, 60) || code,
            enabled: row.enabled !== false,
            kind,
            recommended: code === "stripe" || row.recommended === true,
            sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index,
            identifierFormat,
            identifierLabel: cleanText(row.identifierLabel, 80) || "Payout identifier",
            contractorProvides: cleanText(row.contractorProvides, 240) || "The identifier for this method.",
            instructions: cleanText(row.instructions, 400) || "Enter the details for this method.",
            summary: cleanText(row.summary, 200) || (kind === "stripe" ? "Paid automatically after approval." : `Paid weekly on ${weekdayName(weekday)}.`),
            countsTowardOwn1099: asBoolOrNull(row.countsTowardOwn1099),
          });
        })
        .filter((m): m is PayoutMethodDefinition => Boolean(m))
    : base.methods;
  const acknowledgmentVersions = versions.length ? versions : base.acknowledgmentVersions;
  const requestedActive = cleanText(src.activeAcknowledgmentId, 80);
  const activeAcknowledgmentId = acknowledgmentVersions.some((v) => v.id === requestedActive)
    ? requestedActive
    : acknowledgmentVersions[acknowledgmentVersions.length - 1].id;
  return {
    methods: methods.length ? methods : base.methods,
    payRunWeekday: weekday >= 0 && weekday <= 6 ? weekday : base.payRunWeekday,
    changeHoldHours: clampNumber(src.changeHoldHours, 1, 24 * 14, base.changeHoldHours),
    agingDays: clampNumber(src.agingDays, 1, 90, base.agingDays),
    reminderIntervalDays: clampNumber(src.reminderIntervalDays, 1, 60, base.reminderIntervalDays),
    acknowledgmentVersions,
    activeAcknowledgmentId,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Settings edits never describe a ledger rewrite. */
export function applySettingsChange(
  current: PayoutSettings,
  patch: unknown,
  now: string,
): { settings: PayoutSettings; ledgerUpdates: [] } {
  const next = parsePayoutSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
  const text = cleanText((patch as { acknowledgmentText?: string } | null)?.acknowledgmentText, 800);
  if (text && text !== activeAcknowledgment(next).text) {
    const id = `ack-${now.slice(0, 19).replace(/[^\d]/g, "")}`;
    const versions = next.acknowledgmentVersions.some((v) => v.text === text)
      ? next.acknowledgmentVersions
      : [...next.acknowledgmentVersions, { id, text, createdAt: now }];
    const match = versions.find((v) => v.text === text)!;
    next.acknowledgmentVersions = versions;
    next.activeAcknowledgmentId = match.id;
  }
  next.methods = next.methods.map((item) => {
    if (item.kind !== "manual") return item;
    if (!/^Paid weekly on /i.test(item.summary)) return item;
    return { ...item, summary: `Paid weekly on ${weekdayName(next.payRunWeekday)}.` };
  });
  return { settings: next, ledgerUpdates: [] };
}

export function findMethod(settings: PayoutSettings, code: string | null | undefined): PayoutMethodDefinition | null {
  if (!code) return null;
  return settings.methods.find((m) => m.code === code) || null;
}

/** Enabled methods, Stripe first, then the configured order. */
export function methodsForChoice(settings: PayoutSettings): PayoutMethodDefinition[] {
  return settings.methods
    .filter((m) => m.enabled)
    .slice()
    .sort((a, b) => {
      if (a.code === "stripe" && b.code !== "stripe") return -1;
      if (b.code === "stripe" && a.code !== "stripe") return 1;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
}

export function methodOneLine(methodRow: PayoutMethodDefinition, settings: PayoutSettings): string {
  if (methodRow.kind === "stripe") return methodRow.summary || "Paid automatically after approval.";
  if (methodRow.summary) return methodRow.summary;
  return `Paid weekly on ${weekdayName(settings.payRunWeekday)}.`;
}

export function nextPayRunDate(weekday: number, fromYmd: string): string {
  const [y, m, d] = fromYmd.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const delta = ((Math.round(weekday) - date.getUTCDay()) + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function normalizeIdentifier(value: string, format: IdentifierFormat): string {
  const trimmed = value.trim();
  if (format === "cashtag" || format === "chime_sign") {
    const body = trimmed.replace(/\s+/g, "");
    return body.startsWith("$") ? `$${body.slice(1).toLowerCase()}` : `$${body.toLowerCase()}`;
  }
  if (format === "email_or_phone") {
    if (trimmed.includes("@")) return trimmed.toLowerCase();
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return digits;
  }
  return trimmed.toLowerCase();
}

export function identifiersMatch(a: string, b: string, format: IdentifierFormat): boolean {
  const left = normalizeIdentifier(a, format);
  const right = normalizeIdentifier(b, format);
  return Boolean(left) && left === right;
}

export function validateIdentifier(
  value: string,
  format: IdentifierFormat,
): { ok: true; normalized: string } | { ok: false; error: string } {
  const normalized = normalizeIdentifier(value, format);
  if (format === "stripe") return { ok: false, error: "Stripe uses its own setup." };
  if (format === "cashtag") {
    if (!/^\$[a-z][a-z0-9_]{1,19}$/.test(normalized)) {
      return { ok: false, error: "Enter a $Cashtag that starts with a letter, like $yourname." };
    }
    return { ok: true, normalized };
  }
  if (format === "chime_sign") {
    if (!/^\$[a-z][a-z0-9]{2,29}$/.test(normalized)) {
      return { ok: false, error: "Enter a $ChimeSign that starts with a letter, like $yourname." };
    }
    return { ok: true, normalized };
  }
  if (format === "email_or_phone") {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: true, normalized };
    if (/^\d{10}$/.test(normalized)) return { ok: true, normalized };
    return { ok: false, error: "Enter the email or 10-digit mobile number enrolled with Zelle." };
  }
  if (normalized.length < 3 || normalized.length > 80) {
    return { ok: false, error: "Enter the identifier for this method." };
  }
  return { ok: true, normalized };
}

export function validateAccountName(value: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: "Enter the name exactly as it appears on that account." };
  }
  return { ok: true, name };
}

export function validateManualSubmission(input: {
  method: PayoutMethodDefinition | null;
  identifier: string;
  identifierAgain: string;
  accountName: string;
  acknowledged: boolean;
  acknowledgmentText: string;
  activeAcknowledgmentText: string;
}): { ok: true; identifier: string; accountName: string } | { ok: false; error: string } {
  if (!input.method || !input.method.enabled || input.method.kind !== "manual") {
    return { ok: false, error: "Choose an available payout method." };
  }
  if (!identifiersMatch(input.identifier, input.identifierAgain, input.method.identifierFormat)) {
    return { ok: false, error: "The two identifiers don't match. Enter the same one twice." };
  }
  const identifier = validateIdentifier(input.identifier, input.method.identifierFormat);
  if (identifier.ok === false) return { ok: false, error: identifier.error };
  const accountName = validateAccountName(input.accountName);
  if (accountName.ok === false) return { ok: false, error: accountName.error };
  if (!input.acknowledged) {
    return { ok: false, error: "Check the acknowledgment before saving these details." };
  }
  if (cleanText(input.acknowledgmentText, 800) !== cleanText(input.activeAcknowledgmentText, 800)) {
    return { ok: false, error: "The acknowledgment wording changed. Read the current version and confirm it." };
  }
  return { ok: true, identifier: identifier.normalized, accountName: accountName.name };
}

export function confirmationPreview(input: {
  method: PayoutMethodDefinition;
  identifier: string;
  accountName: string;
  settings: PayoutSettings;
}): { identifier: string; accountName: string; expect: string; acknowledgment: string } {
  return {
    identifier: normalizeIdentifier(input.identifier, input.method.identifierFormat),
    accountName: input.accountName.replace(/\s+/g, " ").trim(),
    expect: methodOneLine(input.method, input.settings),
    acknowledgment: activeAcknowledgment(input.settings).text,
  };
}

/** Columns written when a manual method is verified. Stripe columns are not in this patch. */
export function cleanerPatchForVerifiedManual(code: string): { payout_method_code: string; payout_method_status: "verified" } {
  return { payout_method_code: code, payout_method_status: "verified" };
}

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t && !NAME_SUFFIXES.has(t));
}

/** A displayed recipient name reasonably matches the W-9 legal name. */
export function namesReasonablyMatch(w9Name: string, displayed: string): boolean {
  const legal = nameTokens(w9Name);
  const shown = nameTokens(displayed);
  if (!legal.length || !shown.length) return false;
  const shownSet = new Set(shown);
  const first = legal[0];
  const last = legal[legal.length - 1];
  if (!shownSet.has(last)) return false;
  if (legal.length === 1) return true;
  if (shownSet.has(first)) return true;
  if (shown.some((token) => token.length === 1 && token[0] === first[0])) return true;
  if (shown.some((token) => token.startsWith(first) && token.length - first.length <= 3)) return true;
  return false;
}

export function maskPayoutIdentifier(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("$")) {
    const body = raw.slice(1);
    if (body.length <= 2) return "$••";
    return `$${body.slice(0, 1)}•••${body.slice(-1)}`;
  }
  if (raw.includes("@")) {
    const [user, domain] = raw.split("@");
    return `${(user || "•").slice(0, 1)}•••@${domain || "•••"}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 7) return `•••-•••-${digits.slice(-4)}`;
  if (raw.length <= 2) return "••";
  return `${raw.slice(0, 1)}•••${raw.slice(-1)}`;
}

export function redactPayoutIdentifiers(text: string, identifiers: Array<string | null | undefined> = []): string {
  let out = String(text ?? "");
  for (const identifier of identifiers) {
    const raw = String(identifier ?? "").trim();
    if (raw.length < 3) continue;
    out = out.replace(new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[payout id removed]");
  }
  out = out.replace(/\$[A-Za-z][A-Za-z0-9_]{2,30}/g, "[payout id removed]");
  return out;
}

const SECRET_KEY = /identifier|cashtag|chimesign|account_?name|pending_identifier|payout_id/i;

/** Drop payout identifiers before a log line, export, or model prompt. */
export function payoutSafeRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = typeof value === "string" ? redactPayoutIdentifiers(value) : value;
  }
  return out;
}

export function forAiPrompt(text: string, identifiers: string[] = []): string {
  return redactPayoutIdentifiers(text, identifiers);
}

export type PayEarning = {
  id: string;
  cleanerId: string;
  amountCents: number;
  jobId: string | null;
  jobDate: string | null;
  kind: "job" | "extra" | "adjustment";
  reason: string | null;
  section: string | null;
  /** approved = the same confirmed, unpaid earnings Stripe would pay. */
  status: "approved" | "hold" | "disputed" | "paid" | "cancelled";
  qcCleared: boolean;
  approvedAt: string | null;
};

export type PayContractor = {
  cleanerId: string;
  name: string;
  methodCode: string | null;
  methodKind: PayoutMethodKind | null;
  methodStatus: "verified" | "pending" | "on_hold" | "none";
  identifier: string | null;
  accountName: string | null;
  w9OnFile: boolean;
  w9LegalName: string | null;
  engagementStatus: string;
  detailsChangedAt: string | null;
  confirmDetails: boolean;
  priorPaidIdentifiers: string[];
};

export type PayRunDraft = {
  payRunAt: string;
  holdHours: number;
  contractors: PayContractor[];
  earnings: PayEarning[];
  /** Earning ids already on an open or paid line. */
  claimedEarningIds: string[];
};

export type PayLineEarning = {
  id: string;
  amountCents: number;
  jobId: string | null;
  jobDate: string | null;
  kind: "job" | "extra" | "adjustment";
  reason: string | null;
  section: string | null;
};

export type PayFlag = "first_payment" | "recent_change_hold" | "confirm_details" | "name_mismatch";

export type PayLine = {
  key: string;
  cleanerId: string;
  contractorName: string;
  methodCode: string;
  identifier: string;
  accountName: string | null;
  w9LegalName: string | null;
  grossCents: number;
  deductionCents: number;
  amountDueCents: number;
  earnings: PayLineEarning[];
  flags: PayFlag[];
  recentChangeHold: boolean;
  firstPayment: boolean;
};

export type CannotPayEntry = {
  cleanerId: string;
  contractorName: string;
  methodCode: string | null;
  amountCents: number;
  reason: CannotPayReason;
  reasonText: string;
  earningIds: string[];
};

export type CannotPayReason =
  | "missing_w9"
  | "unverified_details"
  | "on_hold"
  | "qc_not_cleared"
  | "earning_on_hold"
  | "disputed"
  | "no_method"
  | "nothing_due";

const CANNOT_PAY_TEXT: Record<CannotPayReason, string> = {
  missing_w9: "Missing W-9",
  unverified_details: "Payout details are not verified",
  on_hold: "On hold",
  qc_not_cleared: "QC is not cleared",
  earning_on_hold: "Earnings are on hold",
  disputed: "Earnings are disputed",
  no_method: "No payout method on file",
  nothing_due: "Deductions meet or exceed the amount due",
};

export function cannotPayText(reason: CannotPayReason): string {
  return CANNOT_PAY_TEXT[reason];
}

function withinChangeHold(changedAt: string, dueAt: string | null, hours: number): boolean {
  if (!dueAt) return false;
  const changed = Date.parse(changedAt);
  const due = Date.parse(dueAt);
  if (!Number.isFinite(changed) || !Number.isFinite(due)) return false;
  return due >= changed && due <= changed + hours * 3_600_000;
}

function earningBlocked(earning: PayEarning): CannotPayReason | null {
  if (earning.status === "paid" || earning.status === "cancelled") return null;
  if (earning.status === "disputed") return "disputed";
  if (earning.status === "hold") return "earning_on_hold";
  if (!earning.qcCleared) return "qc_not_cleared";
  if (earning.status !== "approved") return null;
  return null;
}

/**
 * Manual-method pay run. Stripe contractors are left out — Stripe still pays
 * them automatically. Everyone who has manual earnings but cannot be paid is
 * listed with a reason.
 */
export function assemblePayRun(draft: PayRunDraft): {
  lines: PayLine[];
  cannotPay: CannotPayEntry[];
  groups: { methodCode: string; lines: PayLine[] }[];
} {
  const claimed = new Set(draft.claimedEarningIds);
  const byCleaner = new Map<string, PayEarning[]>();
  for (const earning of draft.earnings) {
    if (claimed.has(earning.id)) continue;
    if (earning.status === "paid" || earning.status === "cancelled") continue;
    const list = byCleaner.get(earning.cleanerId) || [];
    list.push(earning);
    byCleaner.set(earning.cleanerId, list);
  }

  const lines: PayLine[] = [];
  const cannotPay: CannotPayEntry[] = [];

  for (const contractor of draft.contractors) {
    const earnings = byCleaner.get(contractor.cleanerId) || [];
    if (!earnings.length) continue;
    if (contractor.methodKind === "stripe") continue;

    const blocked = new Map<CannotPayReason, PayEarning[]>();
    const payable: PayEarning[] = [];
    const pushBlocked = (reason: CannotPayReason, rows: PayEarning[]) => {
      if (!rows.length) return;
      blocked.set(reason, [...(blocked.get(reason) || []), ...rows]);
    };

    if (!contractor.methodCode || contractor.methodKind !== "manual") {
      pushBlocked("no_method", earnings);
    } else if (contractor.methodStatus === "on_hold") {
      pushBlocked("on_hold", earnings);
    } else if (contractor.methodStatus !== "verified" || !contractor.identifier) {
      pushBlocked("unverified_details", earnings);
    } else if (!contractor.w9OnFile) {
      pushBlocked("missing_w9", earnings);
    } else {
      for (const earning of earnings) {
        const reason = earningBlocked(earning);
        if (reason) pushBlocked(reason, [earning]);
        else if (earning.status === "approved") payable.push(earning);
      }
    }

    for (const [reason, rows] of blocked) {
      const amount = rows.reduce((sum, row) => sum + (row.kind === "adjustment" ? -Math.abs(row.amountCents) : row.amountCents), 0);
      cannotPay.push({
        cleanerId: contractor.cleanerId,
        contractorName: contractor.name,
        methodCode: contractor.methodCode,
        amountCents: amount,
        reason,
        reasonText: cannotPayText(reason),
        earningIds: rows.map((row) => row.id),
      });
    }

    if (!payable.length || !contractor.methodCode || !contractor.identifier) continue;
    const jobs = payable.filter((row) => row.kind !== "adjustment");
    const adjustments = payable.filter((row) => row.kind === "adjustment");
    const gross = jobs.reduce((sum, row) => sum + Math.max(0, Math.round(row.amountCents)), 0);
    const deduction = adjustments.reduce((sum, row) => sum + Math.abs(Math.round(row.amountCents)), 0);
    const amountDue = gross - deduction;
    if (amountDue <= 0) {
      cannotPay.push({
        cleanerId: contractor.cleanerId,
        contractorName: contractor.name,
        methodCode: contractor.methodCode,
        amountCents: amountDue,
        reason: "nothing_due",
        reasonText: cannotPayText("nothing_due"),
        earningIds: payable.map((row) => row.id),
      });
      continue;
    }

    const recentChangeHold = Boolean(
      contractor.detailsChangedAt &&
        payable.some((row) =>
          withinChangeHold(contractor.detailsChangedAt || "", row.approvedAt, draft.holdHours) ||
          withinChangeHold(contractor.detailsChangedAt || "", draft.payRunAt, draft.holdHours),
        ),
    );
    const normalizedId = contractor.identifier.trim().toLowerCase();
    const firstPayment = !contractor.priorPaidIdentifiers.some((id) => id.trim().toLowerCase() === normalizedId);
    const flags: PayFlag[] = [];
    if (firstPayment) flags.push("first_payment");
    if (recentChangeHold) flags.push("recent_change_hold");
    if (contractor.confirmDetails) flags.push("confirm_details");

    lines.push({
      key: `${contractor.methodCode}:${contractor.cleanerId}`,
      cleanerId: contractor.cleanerId,
      contractorName: contractor.name,
      methodCode: contractor.methodCode,
      identifier: contractor.identifier,
      accountName: contractor.accountName,
      w9LegalName: contractor.w9LegalName,
      grossCents: gross,
      deductionCents: deduction,
      amountDueCents: amountDue,
      earnings: payable.map((row) => ({
        id: row.id,
        amountCents: row.kind === "adjustment" ? -Math.abs(row.amountCents) : Math.round(row.amountCents),
        jobId: row.jobId,
        jobDate: row.jobDate,
        kind: row.kind,
        reason: row.reason,
        section: row.section,
      })),
      flags,
      recentChangeHold,
      firstPayment,
    });
  }

  lines.sort((a, b) => a.methodCode.localeCompare(b.methodCode) || a.contractorName.localeCompare(b.contractorName));
  const groups: { methodCode: string; lines: PayLine[] }[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (!last || last.methodCode !== line.methodCode) groups.push({ methodCode: line.methodCode, lines: [line] });
    else last.lines.push(line);
  }
  return { lines, cannotPay, groups };
}

export type LedgerWrite = {
  id: string;
  created: boolean;
  methodCode: string;
  amountCents: number;
  amountDueCents: number;
  differenceCents: number;
  differenceReason: string | null;
  countsTowardOwn1099: boolean | null;
  recordedBy: string | null;
  reference: string | null;
  recipientName: string | null;
  paidAt: string;
  earningIds: string[];
  inclusion: NecInclusion;
};

export function applyPaid(
  line: PayLine,
  input: {
    now: string;
    actorId: string | null;
    amountSentCents: number;
    recipientName: string | null;
    mismatchNote: string | null;
    differenceReason: string | null;
    confirmationRef: string | null;
    holdReleased: boolean;
    w9OnFile: boolean;
    countsTowardOwn1099: boolean | null;
    existingLedgerId: string | null;
    alreadyPaid: boolean;
  },
): { ok: true; ledger: LedgerWrite; flags: PayFlag[] } | { ok: false; error: string; flags: PayFlag[] } {
  if (input.alreadyPaid && input.existingLedgerId) {
    const sent = Math.round(input.amountSentCents);
    return {
      ok: true,
      flags: line.flags,
      ledger: {
        id: input.existingLedgerId,
        created: false,
        methodCode: line.methodCode,
        amountCents: sent,
        amountDueCents: line.amountDueCents,
        differenceCents: sent - line.amountDueCents,
        differenceReason: input.differenceReason,
        countsTowardOwn1099: input.countsTowardOwn1099,
        recordedBy: input.actorId,
        reference: input.confirmationRef,
        recipientName: input.recipientName,
        paidAt: input.now,
        earningIds: line.earnings.map((row) => row.id),
        inclusion: necInclusion({ methodCode: line.methodCode, countsTowardOwn1099: input.countsTowardOwn1099 }),
      },
    };
  }
  if (!input.w9OnFile) return { ok: false, error: "A W-9 must be on file before any payout.", flags: line.flags };
  if (line.recentChangeHold && !input.holdReleased) {
    return {
      ok: false,
      error: "Earnings from the last change are held for admin review.",
      flags: line.flags.includes("recent_change_hold") ? line.flags : [...line.flags, "recent_change_hold"],
    };
  }
  const sent = Math.round(Number(input.amountSentCents));
  if (!Number.isFinite(sent) || sent < 0) return { ok: false, error: "Enter the amount you actually sent.", flags: line.flags };
  if (sent !== line.amountDueCents && !cleanText(input.differenceReason, 400)) {
    return { ok: false, error: "The amount sent differs from the amount due. A reason is required.", flags: line.flags };
  }
  const flags: PayFlag[] = line.flags.filter((flag) => flag !== "name_mismatch");
  if (line.firstPayment) {
    const recipient = cleanText(input.recipientName, 80);
    if (!recipient) {
      return { ok: false, error: "First payment: enter the recipient name the payment app displayed.", flags };
    }
    const matches = line.w9LegalName ? namesReasonablyMatch(line.w9LegalName, recipient) : false;
    if (!matches && !cleanText(input.mismatchNote, 400)) {
      return {
        ok: false,
        error: "The recipient name does not match the W-9. An admin note is required before this can be marked paid.",
        flags: [...flags, "name_mismatch"],
      };
    }
    if (!matches) flags.push("name_mismatch");
  }
  const ledgerId = input.existingLedgerId || `ledger:${line.key}:${input.now}`;
  return {
    ok: true,
    flags,
    ledger: {
      id: ledgerId,
      created: true,
      methodCode: line.methodCode,
      amountCents: sent,
      amountDueCents: line.amountDueCents,
      differenceCents: sent - line.amountDueCents,
      differenceReason: sent === line.amountDueCents ? null : cleanText(input.differenceReason, 400),
      countsTowardOwn1099: input.countsTowardOwn1099,
      recordedBy: input.actorId,
      reference: cleanText(input.confirmationRef, 120) || null,
      recipientName: cleanText(input.recipientName, 80) || null,
      paidAt: input.now,
      earningIds: line.earnings.map((row) => row.id),
      inclusion: necInclusion({ methodCode: line.methodCode, countsTowardOwn1099: input.countsTowardOwn1099 }),
    },
  };
}

export function applyFailed(
  line: PayLine,
  input: { reason: string },
): { ok: true; releasedEarningIds: string[]; reason: string } | { ok: false; error: string } {
  const reason = cleanText(input.reason, 400);
  if (!reason) return { ok: false, error: "A reason is required to mark a payment failed." };
  return { ok: true, releasedEarningIds: line.earnings.map((row) => row.id), reason };
}

export function reopenPaid(input: { reason: string; alreadyPaid: boolean }): { ok: true; reason: string } | { ok: false; error: string } {
  if (!input.alreadyPaid) return { ok: false, error: "Only a paid line can be reopened." };
  const reason = cleanText(input.reason, 400);
  if (!reason) return { ok: false, error: "A reason is required to reopen a paid line." };
  return { ok: true, reason };
}

export function allocateSentCents(
  parts: { id: string; amountCents: number }[],
  sentCents: number,
): { id: string; amountCents: number }[] {
  const positive = parts.filter((part) => part.amountCents > 0);
  const gross = positive.reduce((sum, part) => sum + part.amountCents, 0);
  if (!positive.length || gross <= 0) return parts.map((part) => ({ id: part.id, amountCents: 0 }));
  let remaining = Math.max(0, Math.round(sentCents));
  return positive.map((part, index) => {
    if (index === positive.length - 1) return { id: part.id, amountCents: remaining };
    const share = Math.floor((part.amountCents / gross) * Math.max(0, Math.round(sentCents)));
    remaining -= share;
    return { id: part.id, amountCents: share };
  });
}

export function isAgedUnpaid(approvedAt: string | null, agingDays: number, nowIso: string): boolean {
  if (!approvedAt) return false;
  const age = Date.parse(nowIso) - Date.parse(approvedAt);
  if (!Number.isFinite(age)) return false;
  return age > agingDays * 24 * 3_600_000;
}

export function agedEarnings(earnings: PayEarning[], agingDays: number, nowIso: string): PayEarning[] {
  return earnings.filter(
    (row) => row.status === "approved" && row.kind !== "adjustment" && isAgedUnpaid(row.approvedAt, agingDays, nowIso),
  );
}

export function agingAlert(count: number, oldestDays: number): { urgent: true; title: string; body: string } | null {
  if (count <= 0) return null;
  return {
    urgent: true,
    title: "Unpaid earnings are getting old",
    body: `${count} approved earning${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} been unpaid for more than ${oldestDays} days. Late pay is the fastest way to lose a good cleaner.`,
  };
}

export function reminderIsDue(lastSentAt: string | null, intervalDays: number, nowIso: string): boolean {
  if (!lastSentAt) return true;
  const age = Date.parse(nowIso) - Date.parse(lastSentAt);
  if (!Number.isFinite(age)) return true;
  return age >= intervalDays * 24 * 3_600_000;
}

export function canSendExistingOptionsNotice(
  alreadySent: boolean,
  adminApproved: boolean,
): { ok: true } | { ok: false; error: string } {
  if (alreadySent) return { ok: false, error: "This one-time note was already sent." };
  if (!adminApproved) return { ok: false, error: "An admin reviews and sends this note. It is never sent automatically." };
  return { ok: true };
}

export function isStalledAtPayoutStep(state: CleanerSetupState): boolean {
  const steps = cleanerSetupSteps(state);
  const index = steps.findIndex((step) => step.id === "payouts");
  if (index < 0) return false;
  if (steps[index].done) return false;
  return steps.slice(0, index).every((step) => step.done);
}

export function payoutMethodReport(rows: {
  name: string;
  methodCode: string | null;
  methodStatus: string | null;
  stalledAtPayout: boolean;
}[]): {
  byMethod: { methodCode: string; count: number }[];
  noCompleteMethod: string[];
  stalledAtPayout: number;
} {
  const counts = new Map<string, number>();
  const missing: string[] = [];
  let stalled = 0;
  for (const row of rows) {
    if (row.methodStatus === "verified" && row.methodCode) {
      counts.set(row.methodCode, (counts.get(row.methodCode) || 0) + 1);
    } else {
      missing.push(row.name);
    }
    if (row.stalledAtPayout) stalled += 1;
  }
  return {
    byMethod: [...counts.entries()].map(([methodCode, count]) => ({ methodCode, count })).sort((a, b) => a.methodCode.localeCompare(b.methodCode)),
    noCompleteMethod: missing,
    stalledAtPayout: stalled,
  };
}

export function monthlyTotalsByMethod(
  rows: { methodCode: string | null; amountCents: number; paidAt: string | null }[],
  month: string,
): { methodCode: string; amountCents: number; count: number }[] {
  const prefix = month.slice(0, 7);
  const totals = new Map<string, { amountCents: number; count: number }>();
  for (const row of rows) {
    if (!row.paidAt || !row.paidAt.startsWith(prefix)) continue;
    const key = row.methodCode || "unspecified";
    const current = totals.get(key) || { amountCents: 0, count: 0 };
    current.amountCents += Math.round(row.amountCents) || 0;
    current.count += 1;
    totals.set(key, current);
  }
  return [...totals.entries()]
    .map(([methodCode, value]) => ({ methodCode, ...value }))
    .sort((a, b) => a.methodCode.localeCompare(b.methodCode));
}

export function finalPayDestination(contractor: PayContractor): "pay_run" | "stripe" | "none" {
  if (contractor.methodKind === "stripe" && contractor.methodStatus === "verified") return "stripe";
  if (contractor.methodKind === "manual") return "pay_run";
  return "none";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const formatted = (abs / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return negative ? `-${formatted}` : formatted;
}

export type ContractorMessage = {
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  sms: string;
  html: string;
};

function message(subject: string, text: string, sms: string): ContractorMessage {
  const html = text
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 12px">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return {
    from: CONTRACTOR_OPS_FROM,
    replyTo: CONTRACTOR_OPS_EMAIL,
    subject,
    text,
    sms,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">${html}<p style="color:#64748b;font-size:12px">${escapeHtml(CONTRACTOR_OPS_DISPLAY_NAME)} · ${escapeHtml(CONTRACTOR_OPS_EMAIL)}</p></div>`,
  };
}

export function paidNotice(input: {
  firstName: string;
  amountCents: number;
  methodName: string;
  paidOn: string;
  jobs: { jobId: string | null; jobDate: string | null }[];
  summaryUrl: string;
}): ContractorMessage {
  const name = input.firstName.trim() || "there";
  const jobs = input.jobs
    .map((job) => [job.jobId, job.jobDate].filter(Boolean).join(" · "))
    .filter(Boolean);
  const jobLine = jobs.length ? `Jobs: ${jobs.join("; ")}.` : "The payment summary lists the jobs this covers.";
  const text = [
    `Hi ${name},`,
    "",
    `We sent ${money(input.amountCents)} by ${input.methodName} on ${input.paidOn}.`,
    jobLine,
    `Your ${PAYMENT_SUMMARY_TITLE} is here: ${input.summaryUrl}`,
    "",
    NO_TAX_WITHHELD,
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  const sms = `${CONTRACTOR_OPS_DISPLAY_NAME}: We sent ${money(input.amountCents)} by ${input.methodName} on ${input.paidOn}. ${PAYMENT_SUMMARY_TITLE}: ${input.summaryUrl}`;
  return message(`Payment sent — ${money(input.amountCents)}`, text, sms);
}

export function detailChangeNotice(firstName: string): ContractorMessage {
  const name = firstName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Your payout details were just changed. If you made this change, confirm it with the code we send to this email or phone.",
    "If you did not make this change, reply to this email right away so we can stop it.",
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(
    "Your payout details were changed",
    text,
    `${CONTRACTOR_OPS_DISPLAY_NAME}: Your payout details were changed. If this wasn't you, reply to ${CONTRACTOR_OPS_EMAIL}.`,
  );
}

export function adminDetailChangeNotice(contractorName: string): ContractorMessage {
  const text = [
    `${contractorName} changed their payout details.`,
    "The new details stay pending until they confirm the code sent to the email or phone already on file.",
    "The identifier is on the contractor record. It is not in this message.",
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(`Payout details changed — ${contractorName}`, text, text);
}

export function paymentFailedNotice(firstName: string): ContractorMessage {
  const name = firstName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "We couldn't complete a payment. Please confirm the payout details on your profile so the next pay run can include you.",
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(
    "Please confirm your payout details",
    text,
    `${CONTRACTOR_OPS_DISPLAY_NAME}: A payment didn't go through. Please confirm your payout details. ${CONTRACTOR_OPS_EMAIL}`,
  );
}

export function verificationCodeNotice(firstName: string, code: string): ContractorMessage {
  const name = firstName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    `Your confirmation code is ${code}. It expires in 15 minutes.`,
    "Enter it to confirm your payout details. If you didn't ask for this, ignore it and tell us.",
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(
    "Confirm your payout details",
    text,
    `${CONTRACTOR_OPS_DISPLAY_NAME}: Your payout confirmation code is ${code}. It expires in 15 minutes.`,
  );
}

export function missingSetupReminder(firstName: string, missing: Array<"method" | "w9">, link: string): ContractorMessage {
  const name = firstName.trim() || "there";
  const needs = [
    missing.includes("method") ? "choose how you get paid" : "",
    missing.includes("w9") ? "submit your W-9" : "",
  ].filter(Boolean).join(" and ");
  const text = [
    `Hi ${name},`,
    "",
    `Whenever you're ready, ${needs}. We need both before a payment can go out.`,
    link,
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(
    "A quick step before you can be paid",
    text,
    `${CONTRACTOR_OPS_DISPLAY_NAME}: Please ${needs} so we can pay you. ${link}`,
  );
}

export function existingStripeOptionsNotice(firstName: string, link: string): ContractorMessage {
  const name = firstName.trim() || "there";
  const text = [
    `Hi ${name},`,
    "",
    "Stripe is still the fastest way to get paid, and it pays you automatically. If Stripe setup has been a hassle, you can choose Cash App, Zelle, or Chime instead.",
    "Those are paid weekly on our pay run day. You'll confirm the details, and we keep a W-9 on file either way.",
    `Choose here: ${link}`,
    "",
    CONTRACTOR_OPS_DISPLAY_NAME,
  ].join("\n");
  return message(
    "More ways to get paid",
    text,
    `${CONTRACTOR_OPS_DISPLAY_NAME}: You can get paid by Stripe, or by Cash App, Zelle, or Chime. Choose here: ${link}`,
  );
}

export function payRunDayReminder(weekdayLabel: string): { title: string; body: string } {
  return {
    title: `Pay run day — ${weekdayLabel}`,
    body: `Today is the ${weekdayLabel} pay run. Review the manual-method lines, pay them in the app, and mark each one paid.`,
  };
}

const EMPLOYMENT_WORDING = /\b(employees?|employers?|wages|salary|pay\s*stubs?|paystubs?|w-2|w2)\b/i;

export function paymentSummaryProblems(text: string): string[] {
  const problems: string[] = [];
  if (!text.includes(PAYMENT_SUMMARY_TITLE)) problems.push("missing_title");
  if (/\bpay\s*stub\b/i.test(text)) problems.push("says_pay_stub");
  if (!text.includes(NO_TAX_WITHHELD)) problems.push("missing_no_withholding");
  if (EMPLOYMENT_WORDING.test(text)) problems.push("employment_wording");
  return problems;
}

export function buildPaymentSummary(input: {
  contractorName: string;
  methodName: string;
  paidOn: string;
  jobs: { jobId: string | null; jobDate: string | null; grossCents: number }[];
  adjustments: { reason: string; amountCents: number; section: string | null }[];
  netCents: number;
}): { title: typeof PAYMENT_SUMMARY_TITLE; text: string; html: string; problems: string[] } {
  const jobLines = input.jobs.map((job) => {
    const label = [job.jobId || "Job", job.jobDate].filter(Boolean).join(" · ");
    return `${label}    ${money(job.grossCents)}`;
  });
  const adjustmentLines = input.adjustments.map((row) => {
    const label = row.section === OVERPAYMENT_SECTION
      ? `Overpayment correction (section ${OVERPAYMENT_SECTION}): ${row.reason}`
      : row.reason;
    return `${label}    -${money(Math.abs(row.amountCents))}`;
  });
  const text = [
    PAYMENT_SUMMARY_TITLE,
    "",
    input.contractorName,
    `${input.methodName} · ${input.paidOn}`,
    "",
    "Jobs",
    ...(jobLines.length ? jobLines : ["None"]),
    "",
    "Adjustments",
    ...(adjustmentLines.length ? adjustmentLines : ["None"]),
    "",
    `Net amount paid    ${money(input.netCents)}`,
    "",
    NO_TAX_WITHHELD,
  ].join("\n");
  const html = `<article><h1>${PAYMENT_SUMMARY_TITLE}</h1><p>${escapeHtml(input.contractorName)}</p><p>${escapeHtml(input.methodName)} · ${escapeHtml(input.paidOn)}</p><h2>Jobs</h2><ul>${input.jobs.map((job) => `<li>${escapeHtml([job.jobId || "Job", job.jobDate].filter(Boolean).join(" · "))} — ${money(job.grossCents)}</li>`).join("") || "<li>None</li>"}</ul><h2>Adjustments</h2><ul>${input.adjustments.map((row) => `<li>${escapeHtml(row.section === OVERPAYMENT_SECTION ? `Overpayment correction (section ${OVERPAYMENT_SECTION}): ${row.reason}` : row.reason)} — -${money(Math.abs(row.amountCents))}</li>`).join("") || "<li>None</li>"}</ul><p><strong>Net amount paid ${money(input.netCents)}</strong></p><p>${escapeHtml(NO_TAX_WITHHELD)}</p></article>`;
  return { title: PAYMENT_SUMMARY_TITLE, text, html, problems: paymentSummaryProblems(text) };
}

export function snapshot1099Flag(methodRow: PayoutMethodDefinition | null): boolean | null {
  return methodRow ? methodRow.countsTowardOwn1099 : null;
}
