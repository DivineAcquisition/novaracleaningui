// ─── The EOD field model ──────────────────────────────────────────────────────
//
// One flat form: every VA answers every field. We currently have one VA
// covering operations, sales and recruiting, so splitting the form by role
// would be ceremony without benefit.
//
// The definitions stay MODULAR so role filtering can come back without a
// rebuild: every metric and select carries a `functions` tag, and
// `metricsFor()` / `selectsFor()` already filter on it. Today every caller
// passes "all" and gets everything.
//
// ─── Hybrid verification ─────────────────────────────────────────────────────
//
// Each metric is entered by the VA AND, where a source exists, shown beside the
// system's own count. On submit the two are compared and a material gap raises
// a Discrepancy Flag for human review.
//
// A metric with no source shows "not tracked" — never a zero. Implying a
// verified count that doesn't exist would be worse than admitting the gap, and
// it's the difference between "we watched and saw nothing" and "we weren't
// looking". As integrations land, a metric moves from entered-only to
// entered-and-corroborated by filling in `corroborate` — no form redesign.

import type { MetricKey } from "./metrics";

export type VaFunction = "operations" | "sales" | "recruiting" | "all";

/**
 * How a metric is checked against reality.
 *
 *   direct  — the signal counts the same thing; compare like for like.
 *   ceiling — the signal is an upper bound on plausible activity. Only a
 *             self-reported value ABOVE it is meaningful.
 *
 * `metrics` may list several keys; verified values are summed. If every listed
 * metric is unverified there is no signal, so no flag can be raised.
 */
export interface Corroboration {
  mode: "direct" | "ceiling";
  metrics: MetricKey[];
  /** Shown beside the input, e.g. "GHL shows 22". */
  sourceLabel: string;
  /** Plain-English description used in flags and the PDF. */
  describe: string;
}

export interface MetricField {
  key: string;
  label: string;
  /** One line under the label explaining exactly what counts. */
  definition: string;
  unit?: string;
  /** Renders as dollars and is stored in cents. */
  currency?: boolean;
  functions: VaFunction[];
  /** Null until a source exists — the field then shows "not tracked". */
  corroborate: Corroboration | null;
  /** Why there's no source yet, shown on hover where useful. */
  notTrackedReason?: string;
}

// ─── 1. The metrics block ─────────────────────────────────────────────────────
//
// Zero is a valid answer. Blank is not — a blank tells us nothing, while a zero
// is a real report that the day had none of that thing.

export const METRIC_FIELDS: MetricField[] = [
  {
    key: "new_leads_contacted",
    label: "New leads contacted",
    definition: "New inbound leads you reached out to today.",
    unit: "leads",
    functions: ["sales", "operations"],
    corroborate: {
      mode: "direct",
      metrics: ["leads_responded"],
      sourceLabel: "GHL",
      describe: "leads assigned to you that received a first outbound touch",
    },
  },
  {
    key: "quotes_sent",
    label: "Quotes sent",
    definition: "Price quotes delivered to prospects.",
    unit: "quotes",
    functions: ["sales"],
    corroborate: {
      mode: "direct",
      metrics: ["quotes_sent"],
      sourceLabel: "Workspace",
      describe: "quotes saved and sent under your name",
    },
  },
  {
    key: "booked_jobs",
    label: "Booked jobs",
    definition: "New jobs scheduled today.",
    unit: "jobs",
    functions: ["sales", "operations"],
    corroborate: {
      mode: "direct",
      metrics: ["bookings_created"],
      sourceLabel: "Jobs",
      describe: "bookings created and attributed to you",
    },
  },
  {
    key: "revenue_booked",
    label: "Revenue booked",
    definition: "Total value of the jobs booked today.",
    currency: true,
    functions: ["sales", "operations"],
    corroborate: {
      mode: "direct",
      metrics: ["revenue_booked_cents"],
      sourceLabel: "Jobs",
      describe: "value of the bookings attributed to you",
    },
  },
  {
    key: "jobs_completed",
    label: "Jobs completed",
    definition: "Jobs that finished today.",
    unit: "jobs",
    functions: ["operations"],
    corroborate: {
      mode: "direct",
      metrics: ["jobs_completed"],
      sourceLabel: "Jobs",
      describe: "bookings marked completed today",
    },
  },
  {
    key: "commercial_outreach",
    label: "Commercial outreach",
    definition: "Businesses or property managers contacted about commercial work.",
    unit: "businesses",
    functions: ["sales"],
    corroborate: {
      mode: "ceiling",
      metrics: ["calls_placed", "sms_sent", "commercial_accounts_touched"],
      sourceLabel: "GHL + accounts",
      describe: "outbound calls and SMS plus commercial accounts touched",
    },
  },
  {
    key: "membership_closes",
    label: "Membership closes",
    definition: "Customers enrolled in a recurring plan.",
    unit: "customers",
    functions: ["sales"],
    // The recurring engine doesn't exist yet, so there is genuinely nothing to
    // compare against. Wire this to recurring enrolments when Phase 4 ships.
    corroborate: null,
    notTrackedReason: "The recurring engine isn't built yet.",
  },
  {
    key: "reactivations",
    label: "Reactivations",
    definition: "Lapsed customers you contacted who rebooked.",
    unit: "customers",
    functions: ["sales"],
    // Outbound touches are visible, but "was lapsed AND rebooked because of
    // this touch" isn't something we can honestly derive today.
    corroborate: null,
    notTrackedReason: "We can't yet tell a reactivation from a normal rebooking.",
  },
  {
    key: "applicants_screened",
    label: "Applicants screened",
    definition: "Phone screens you completed today.",
    unit: "screens",
    functions: ["recruiting"],
    corroborate: {
      mode: "direct",
      metrics: ["phone_screens_completed"],
      sourceLabel: "Screening records",
      describe: "screening records you submitted",
    },
  },
  {
    key: "cleaners_hired",
    label: "Cleaners hired",
    definition:
      "Cleaners fully activated — agreement signed, background check, W-9 and payout setup all complete. Not offers extended.",
    unit: "cleaners",
    functions: ["recruiting"],
    corroborate: {
      mode: "direct",
      metrics: ["cleaners_activated"],
      sourceLabel: "Cleaner hub",
      describe: "cleaners you moved to active",
    },
  },
];

export const METRIC_FIELD_KEYS = METRIC_FIELDS.map((m) => m.key);

const METRIC_BY_KEY = new Map(METRIC_FIELDS.map((m) => [m.key, m]));
export function metricFieldByKey(key: string): MetricField | undefined {
  return METRIC_BY_KEY.get(key);
}

/** Modular hook for a future role-scoped form. Today everyone gets everything. */
export function metricsFor(fn: VaFunction = "all"): MetricField[] {
  if (fn === "all") return METRIC_FIELDS;
  return METRIC_FIELDS.filter((m) => m.functions.includes(fn) || m.functions.includes("all"));
}

// ─── 2. Single-select fields ──────────────────────────────────────────────────
//
// Each has a conditional free-text follow-up that appears only when the answer
// implies there's something to say. Qualitative text is never scored.

export interface SelectField {
  key: "primary_focus" | "blockers_level" | "management_attention" | "cleaner_issues";
  label: string;
  options: string[];
  functions: VaFunction[];
  /** Answers that reveal the follow-up. */
  revealsOn?: string[];
  followUp?: { key: string; label: string; placeholder: string };
  /** Answers that notify admin immediately on submit. */
  urgentOn?: string[];
}

export const SELECT_FIELDS: SelectField[] = [
  {
    key: "primary_focus",
    label: "Primary focus today",
    options: ["Operations", "Sales", "Recruiting", "Mixed"],
    functions: ["all"],
  },
  {
    key: "blockers_level",
    label: "Blockers",
    options: ["None", "Minor", "Major"],
    functions: ["all"],
    revealsOn: ["Minor", "Major"],
    followUp: {
      key: "blockers",
      label: "What's blocked?",
      placeholder: "What's stuck, and what would unblock it?",
    },
  },
  {
    key: "management_attention",
    label: "Needs management's attention",
    options: ["No", "When you can", "Urgent"],
    functions: ["all"],
    revealsOn: ["When you can", "Urgent"],
    followUp: {
      key: "escalations",
      label: "What do they need to know?",
      placeholder: "Say it plainly — this field is never scored.",
    },
    urgentOn: ["Urgent"],
  },
  {
    key: "cleaner_issues",
    label: "Cleaner issues today",
    options: ["None", "Minor", "Serious"],
    functions: ["all"],
    revealsOn: ["Minor", "Serious"],
    followUp: {
      key: "cleaner_issue_notes",
      label: "What happened?",
      placeholder: "Who, what happened, and whether it's resolved.",
    },
    urgentOn: ["Serious"],
  },
];

const SELECT_BY_KEY = new Map(SELECT_FIELDS.map((s) => [s.key, s]));
export function selectFieldByKey(key: string): SelectField | undefined {
  return SELECT_BY_KEY.get(key as SelectField["key"]);
}

export function selectsFor(fn: VaFunction = "all"): SelectField[] {
  if (fn === "all") return SELECT_FIELDS;
  return SELECT_FIELDS.filter((s) => s.functions.includes(fn) || s.functions.includes("all"));
}

/** Does this answer set warrant an immediate admin ping? */
export function isUrgent(selects: Record<string, string>): SelectField[] {
  return SELECT_FIELDS.filter((f) => f.urgentOn?.includes(selects[f.key] ?? ""));
}

export function followUpRequired(field: SelectField, answer: string | undefined): boolean {
  return Boolean(field.followUp && answer && field.revealsOn?.includes(answer));
}

/** Free-text keys that live in their own column on va_eod_submissions. */
export const FREE_TEXT_KEYS = [
  "blockers",
  "escalations",
  "cleaner_issue_notes",
  "priorities",
  "wins",
] as const;
export type FreeTextKey = (typeof FREE_TEXT_KEYS)[number];

// ─── 3. Retained qualitative fields ───────────────────────────────────────────

export const CLOSING_FIELDS: { key: FreeTextKey; label: string; placeholder: string; required: boolean }[] = [
  {
    key: "priorities",
    label: "Tomorrow's top priorities",
    placeholder: "1.\n2.\n3.",
    required: true,
  },
  {
    key: "wins",
    label: "Wins / notes",
    placeholder: "Anything that went well, or anything else worth recording.",
    required: false,
  },
];

/** The metric the core block always shows, read-only, from Apploye. */
export const CORE_HOURS_METRIC: MetricKey = "hours_tracked";

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface SubmissionInput {
  metrics: Record<string, unknown>;
  selects: Record<string, unknown>;
  text: Record<string, unknown>;
}

/**
 * Every metric must carry a number — zero is fine, blank is not. Every select
 * must be answered, and any follow-up the answer revealed must be filled in.
 * Wins stays optional: forcing someone to invent a win produces noise.
 */
export function validateSubmission(input: SubmissionInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of METRIC_FIELDS) {
    const raw = input.metrics[field.key];
    if (raw === undefined || raw === null || raw === "") {
      issues.push({ field: field.key, message: `${field.label} needs a number — enter 0 if there were none.` });
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      issues.push({ field: field.key, message: `${field.label} must be 0 or more.` });
    } else if (n > 10_000_000) {
      issues.push({ field: field.key, message: `${field.label} looks out of range.` });
    }
  }

  for (const field of SELECT_FIELDS) {
    const answer = String(input.selects[field.key] ?? "");
    if (!answer) {
      issues.push({ field: field.key, message: `Choose an option for "${field.label}".` });
      continue;
    }
    if (!field.options.includes(answer)) {
      issues.push({ field: field.key, message: `"${answer}" isn't an option for ${field.label}.` });
      continue;
    }
    if (followUpRequired(field, answer) && !String(input.text[field.followUp!.key] ?? "").trim()) {
      issues.push({
        field: field.followUp!.key,
        message: `You selected "${answer}" — ${field.followUp!.label.toLowerCase()}`,
      });
    }
  }

  for (const field of CLOSING_FIELDS) {
    if (field.required && !String(input.text[field.key] ?? "").trim()) {
      issues.push({ field: field.key, message: `${field.label} is required.` });
    }
  }

  return issues;
}

// ─── Payload sanitation ───────────────────────────────────────────────────────
//
// The client can only ever send metrics, selects and free text. Tier 1 values
// are read server-side from va_verified_metrics and anything resembling one is
// discarded here, so a verified number can never arrive from a browser.

export function sanitizeMetrics(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of METRIC_FIELDS) {
    const value = raw?.[field.key];
    if (value === "" || value === null || value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    // Money is entered in dollars and stored in cents so it can be compared
    // against revenue_booked_cents without a lossy round-trip.
    out[field.key] = field.currency ? Math.round(n * 100) : Math.round(n);
  }
  return out;
}

export function sanitizeSelects(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of SELECT_FIELDS) {
    const value = String(raw?.[field.key] ?? "").trim();
    if (value && field.options.includes(value)) out[field.key] = value;
  }
  return out;
}

export function sanitizeText(raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of FREE_TEXT_KEYS) {
    const value = raw?.[key];
    if (value === undefined) continue;
    out[key] = String(value ?? "").slice(0, 4000);
  }
  return out;
}

/** Display helper shared by the form, the admin tab and the PDF. */
export function formatMetricEntry(field: MetricField, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (field.currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value / 100);
  }
  return new Intl.NumberFormat("en-US").format(value);
}
