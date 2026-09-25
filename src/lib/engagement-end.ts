// Contractor engagement end: Terminate vs Log Resignation.
//
// Admin actions only. Cleaner accountability (coaching note → strike →
// suspension → removal) does not import this module and keeps its own
// notices. The shared "engagement has ended" SMS is also separate.

export const CONTRACTOR_OPS_DISPLAY_NAME = "NVC Operations";
export const CONTRACTOR_OPS_EMAIL = "operations@novaracleaning.com";
export const CONTRACTOR_OPS_FROM = `${CONTRACTOR_OPS_DISPLAY_NAME} <${CONTRACTOR_OPS_EMAIL}>`;
export const CONTRACTOR_OPS_REPLY_TO = CONTRACTOR_OPS_EMAIL;
export const CONTRACTOR_SIGNER_LINE = "Malik, NovaraCleaning";
export const CONTRACTOR_LETTER_CC = ["contact@novaracleaning.com"] as const;

export const ABANDONMENT_WINDOW_DAYS = 30;
export const ABANDONMENT_TERMINATION_MIN = 3;
export const ABANDONMENT_ISSUE_TYPES = ["no_show", "job_abandonment", "abandonment"] as const;

export const TERMINATION_BASES = [
  { value: "no_cause", section: "5.2", label: "No-cause — Section 5.2" },
  { value: "for_cause", section: "5.3", label: "For-cause — Section 5.3" },
  { value: "job_abandonment", section: "6.4", label: "Job abandonment — Section 6.4" },
] as const;

export type TerminationBasis = (typeof TERMINATION_BASES)[number]["value"];

export const FOR_CAUSE_GROUNDS = [
  { value: "material_breach", label: "Material breach of the agreement" },
  { value: "misconduct", label: "Misconduct or unprofessional conduct" },
  { value: "performance", label: "Cleaning quality or performance" },
  { value: "attendance", label: "Persistent no-shows or lateness" },
  { value: "customer_complaints", label: "Repeated customer complaints" },
  { value: "misrepresentation", label: "Misrepresentation" },
  { value: "confidentiality_or_nonsolicit", label: "Confidentiality or non-solicit breach" },
] as const;

export type ForCauseGround = (typeof FOR_CAUSE_GROUNDS)[number]["value"];

export type NoticeTemplate = { subject: string; body: string; sms: string };
export type NoticeKind = "termination" | "resignation";
export type W9Status = "complete" | "incomplete" | "missing";

const NOTICE_PLACEHOLDERS = ["firstName", "effectiveDate", "signoff", "operationsEmail"] as const;

export const DEFAULT_NOTICES: Record<NoticeKind, NoticeTemplate> = {
  termination: {
    subject: "Your contractor engagement is terminated",
    body: [
      "Dear {{firstName}},",
      "",
      "This confirms that your independent contractor engagement with NovaraCleaning is terminated effective {{effectiveDate}}.",
      "",
      "Portal access and new job offers are closed. Any upcoming jobs assigned to you have been released. Final pay for completed work follows the normal payout schedule.",
      "",
      "Please return any company property in your possession, per your Independent Contractor Agreement, Section 5.4.",
      "",
      "Questions: {{operationsEmail}}",
      "",
      "{{signoff}}",
    ].join("\n"),
    sms: "Novara: Your contractor engagement is terminated effective {{effectiveDate}}. Portal access and new jobs are closed. Return company property per your Independent Contractor Agreement, Section 5.4. Questions: {{operationsEmail}}",
  },
  resignation: {
    subject: "We received your resignation",
    body: [
      "Dear {{firstName}},",
      "",
      "We received your resignation from your independent contractor engagement with NovaraCleaning, effective {{effectiveDate}}.",
      "",
      "Portal access and new job offers are closed. Final pay for completed work follows the normal payout schedule.",
      "",
      "Please return any company property in your possession, per your Independent Contractor Agreement, Section 5.4.",
      "",
      "Questions: {{operationsEmail}}",
      "",
      "{{signoff}}",
    ].join("\n"),
    sms: "Novara: We received your resignation effective {{effectiveDate}}. Portal access and new jobs are closed. Final pay follows the normal schedule. Return company property per your Independent Contractor Agreement, Section 5.4. Questions: {{operationsEmail}}",
  },
};

export function contractorIdentityProblems(text: string): string[] {
  const problems: string[] = [];
  if (/human resources/i.test(text)) problems.push("human_resources");
  if (/\bhr@/i.test(text)) problems.push("hr_address");
  if (/contractor relations|employee relations/i.test(text)) problems.push("relations_suffix");
  if (/per\s+(?:hr\s+|our\s+|the\s+|company\s+)?policy\b/i.test(text)) problems.push("per_policy");
  return problems;
}

export type AbandonmentInstance = {
  id?: string | null;
  job_id?: string | null;
  created_at: string;
  issue_type?: string | null;
};

/** Highest distinct-instance count inside any 30-day window. Same job counts once. */
export function abandonmentInstancesInWindow(
  rows: AbandonmentInstance[],
  now: Date = new Date(),
): { count: number; allowed: boolean; windowDays: number; min: number } {
  const types = new Set<string>(ABANDONMENT_ISSUE_TYPES);
  const nowMs = now.getTime();
  const span = ABANDONMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const byKey = new Map<string, number>();
  for (const row of rows) {
    const type = String(row.issue_type || "").toLowerCase();
    if (!types.has(type)) continue;
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t) || t > nowMs) continue;
    const job = String(row.job_id || "").trim();
    const key = job ? `job:${job}` : `row:${String(row.id || row.created_at)}`;
    const prev = byKey.get(key);
    if (prev == null || t < prev) byKey.set(key, t);
  }
  const times = [...byKey.values()].sort((a, b) => a - b);
  let max = 0;
  for (let i = 0; i < times.length; i++) {
    let n = 0;
    for (let j = i; j < times.length; j++) {
      if (times[j] - times[i] <= span) n++;
      else break;
    }
    if (n > max) max = n;
  }
  return {
    count: max,
    allowed: max >= ABANDONMENT_TERMINATION_MIN,
    windowDays: ABANDONMENT_WINDOW_DAYS,
    min: ABANDONMENT_TERMINATION_MIN,
  };
}

/**
 * A filed W-9, not a Stripe account. Departure used to mark this complete
 * when payouts were enabled, which let a contractor look ready for a 1099
 * with no TIN on file. A stored `complete` stays complete. Anything else
 * is incomplete or missing, including a connected Stripe account.
 */
export function evaluateW9Status(cleaner: {
  w9_status?: string | null;
  payouts_enabled?: boolean | null;
  stripe_account_id?: string | null;
  ob_payouts_setup?: boolean | null;
}): W9Status {
  if (cleaner.w9_status === "complete") return "complete";
  if (cleaner.w9_status === "incomplete") return "incomplete";
  return "missing";
}

export function formatEffectiveDate(isoDate: string): string {
  const day = String(isoDate || "").slice(0, 10);
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day || isoDate;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function renderNotice(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    if (!(NOTICE_PLACEHOLDERS as readonly string[]).includes(key)) return "";
    return vars[key] ?? "";
  });
}

export function mergeNoticeTemplate(base: NoticeTemplate, override: unknown): NoticeTemplate {
  if (!override || typeof override !== "object") return base;
  const src = override as Record<string, unknown>;
  const pick = (key: keyof NoticeTemplate) => {
    const value = src[key];
    return typeof value === "string" && value.trim() ? value : base[key];
  };
  return { subject: pick("subject"), body: pick("body"), sms: pick("sms") };
}

export function renderDepartureNotice(
  template: NoticeTemplate,
  vars: { firstName: string; effectiveDate: string; signoff?: string; operationsEmail?: string },
): NoticeTemplate {
  const filled: Record<string, string> = {
    firstName: vars.firstName,
    effectiveDate: vars.effectiveDate,
    signoff: vars.signoff || CONTRACTOR_SIGNER_LINE,
    operationsEmail: vars.operationsEmail || CONTRACTOR_OPS_EMAIL,
  };
  return {
    subject: renderNotice(template.subject, filled).trim(),
    body: renderNotice(template.body, filled).trim(),
    sms: renderNotice(template.sms, filled).trim(),
  };
}

export function noticeWordingProblems(
  kind: NoticeKind,
  notice: NoticeTemplate,
  extra?: { internalNote?: string | null; forbiddenPhrases?: string[] },
): string[] {
  const problems: string[] = [];
  const email = `${notice.subject}\n${notice.body}`;
  const all = `${email}\n${notice.sms}`;
  problems.push(...contractorIdentityProblems(all));
  if (/\{\{/.test(all)) problems.push("unresolved_placeholder");
  if (!/Section 5\.4/.test(notice.body)) problems.push("missing_section_5_4");
  if (kind === "termination") {
    if (!/\bterminated\b/i.test(email)) problems.push("email_missing_terminated");
    if (!/\bterminated\b/i.test(notice.sms)) problems.push("sms_missing_terminated");
  } else if (/terminat/i.test(all)) {
    problems.push("resignation_says_terminat");
  }
  const blobs = [String(extra?.internalNote || ""), ...(extra?.forbiddenPhrases || [])];
  const hay = all.toLowerCase();
  for (const phrase of blobs) {
    const needle = phrase.trim().toLowerCase();
    if (needle.length >= 8 && hay.includes(needle)) {
      problems.push("reason_in_notice");
      break;
    }
  }
  return problems;
}

export function terminationSection(basis: string): string | null {
  return TERMINATION_BASES.find((row) => row.value === basis)?.section ?? null;
}

export function isForCauseGround(value: string): boolean {
  return FOR_CAUSE_GROUNDS.some((row) => row.value === value);
}

export function forCauseGroundLabel(value: string): string | null {
  return FOR_CAUSE_GROUNDS.find((row) => row.value === value)?.label ?? null;
}

export function validateTerminationSelection(input: {
  basis: string;
  ground?: string | null;
  abandonmentAllowed: boolean;
}):
  | { ok: true; basis: TerminationBasis; section: string; ground: string | null }
  | { ok: false; code: string; error: string } {
  const basis = String(input.basis || "").trim();
  const section = terminationSection(basis);
  if (!section) {
    return {
      ok: false,
      code: "BASIS_REQUIRED",
      error: "Choose a termination basis: no-cause (Section 5.2), for-cause (Section 5.3), or job abandonment (Section 6.4).",
    };
  }
  if (basis === "job_abandonment" && !input.abandonmentAllowed) {
    return {
      ok: false,
      code: "ABANDONMENT_THRESHOLD",
      error: `Job abandonment (Section 6.4) needs ${ABANDONMENT_TERMINATION_MIN} documented instances in a ${ABANDONMENT_WINDOW_DAYS}-day window.`,
    };
  }
  const ground = String(input.ground || "").trim();
  if (basis === "for_cause") {
    if (!isForCauseGround(ground)) {
      return {
        ok: false,
        code: "GROUND_REQUIRED",
        error: "For-cause termination needs one of the Section 5.3 grounds.",
      };
    }
    return { ok: true, basis: "for_cause", section, ground };
  }
  if (ground) {
    return {
      ok: false,
      code: "GROUND_NOT_ALLOWED",
      error: "A for-cause ground only applies to Section 5.3.",
    };
  }
  return { ok: true, basis: basis as TerminationBasis, section, ground: null };
}

export function engagementAlreadyEnded(cleaner: {
  status?: string | null;
  engagement_end_action?: string | null;
}): boolean {
  const status = String(cleaner.status || "").toLowerCase();
  if (status === "terminated" || status === "resigned") return true;
  const action = String(cleaner.engagement_end_action || "").toLowerCase();
  return action === "terminated" || action === "resigned";
}
