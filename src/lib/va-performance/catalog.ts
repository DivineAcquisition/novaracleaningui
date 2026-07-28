// ─── The EOD task catalog + three-tier field model ────────────────────────────
//
// One form, one submission per VA per day. The VA first selects which tasks
// they actually worked on; only those question blocks render. No role
// configuration — the form adapts to the work that was done.
//
// Every field is exactly one of three tiers:
//
//   Tier 1  Auto-filled, read-only. Fed from the verification layer. The VA
//           cannot type these — they review and confirm what was recorded.
//   Tier 2  VA-entered and corroborated. The system can partially see this
//           number; on submit it is compared to its corroborating signal and a
//           material variance raises a Discrepancy Flag for human review.
//   Tier 3  Qualitative only. Never scored, never compared, never counted.
//           Blockers and notes are only useful if they're safe to be honest in.
//
// This module is imported by BOTH the browser form and the server, so the
// rendered questions and the accepted payload can never diverge.

import type { MetricKey } from "./metrics";

export type Tier = 1 | 2 | 3;

/** Read-only, system-fed. */
export interface Tier1Field {
  tier: 1;
  metric: MetricKey;
  /** Override the metric's default label for this block's context. */
  label?: string;
}

/**
 * How a Tier 2 answer is checked against reality.
 *
 *   direct   — the signal counts the same thing; compare like for like.
 *   ceiling  — the signal is an upper-bound proxy (activity the VA could
 *              plausibly have generated). Only a self-reported value ABOVE the
 *              signal is meaningful; being under it is normal and never flagged.
 *
 * `metrics` may list several keys; verified values are summed. If EVERY listed
 * metric is unverified there is no signal, so no flag can be raised.
 */
export interface Corroboration {
  mode: "direct" | "ceiling";
  metrics: MetricKey[];
  /** Plain-English description of what the number is checked against. */
  describe: string;
}

/** VA-entered number that the system can partially see. */
export interface Tier2Field {
  tier: 2;
  key: string;
  label: string;
  unit?: string;
  help?: string;
  /** Null when nothing observable corroborates it — then it is never flagged. */
  corroborate: Corroboration | null;
}

/** Free text. Never scored. */
export interface Tier3Field {
  tier: 3;
  key: string;
  label: string;
  placeholder?: string;
  rows?: number;
}

/** A choice the VA records for context; qualitative, never scored. */
export interface ChoiceField {
  tier: 3;
  key: string;
  label: string;
  choices: string[];
  multiple?: boolean;
}

export type EodField = Tier1Field | Tier2Field | Tier3Field | ChoiceField;

export function isTier1(f: EodField): f is Tier1Field {
  return f.tier === 1;
}
export function isTier2(f: EodField): f is Tier2Field {
  return f.tier === 2;
}
export function isChoice(f: EodField): f is ChoiceField {
  return f.tier === 3 && "choices" in f;
}
export function isTier3Text(f: EodField): f is Tier3Field {
  return f.tier === 3 && !("choices" in f);
}

export type TaskCategory = "operations" | "sales" | "recruiting" | "admin";

export interface TaskDef {
  id: string;
  label: string;
  category: TaskCategory;
  /** Shown under the label in the picker. */
  hint?: string;
  fields: EodField[];
  /** "Other" needs a description before the form can be submitted. */
  requiresDescription?: boolean;
}

export const TASK_CATEGORIES: { id: TaskCategory; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "sales", label: "Sales & Revenue" },
  { id: "recruiting", label: "Recruiting & Talent" },
  { id: "admin", label: "Admin & Other" },
];

const notes = (key: string, label: string, placeholder: string, rows = 3): Tier3Field => ({
  tier: 3,
  key,
  label,
  placeholder,
  rows,
});

// ─── The catalog ──────────────────────────────────────────────────────────────

export const TASKS: TaskDef[] = [
  // ── Operations ──────────────────────────────────────────────────────────
  {
    id: "inbound_leads",
    label: "Handled inbound leads",
    category: "operations",
    hint: "Answering and working leads that came to us",
    fields: [
      { tier: 1, metric: "inbound_leads" },
      { tier: 1, metric: "leads_responded" },
      { tier: 1, metric: "median_response_seconds" },
      { tier: 1, metric: "leads_converted" },
      {
        tier: 2,
        key: "leads_handled",
        label: "Leads you personally handled",
        unit: "leads",
        help: "Including any that came in outside GHL.",
        corroborate: {
          mode: "direct",
          metrics: ["inbound_leads"],
          describe: "inbound leads assigned to you in GHL",
        },
      },
      notes("inbound_leads_notes", "Context on any lost lead", "What happened, and anything worth knowing for next time."),
    ],
  },
  {
    id: "bookings_created",
    label: "Created / scheduled bookings",
    category: "operations",
    fields: [
      { tier: 1, metric: "bookings_created" },
      { tier: 1, metric: "revenue_booked_cents" },
      notes("bookings_notes", "Notes", "Anything unusual about today's bookings."),
    ],
  },
  {
    id: "dispatch",
    label: "Dispatched or assigned cleaners",
    category: "operations",
    fields: [
      {
        tier: 2,
        key: "jobs_dispatched",
        label: "Jobs dispatched or assigned",
        unit: "jobs",
        corroborate: null,
      },
      {
        tier: 2,
        key: "dispatch_gaps",
        label: "Jobs you couldn't fill",
        unit: "jobs",
        corroborate: null,
      },
      notes("dispatch_notes", "Notes", "Coverage gaps, cleaner availability, anything at risk for tomorrow."),
    ],
  },
  {
    id: "reschedules",
    label: "Handled reschedules or cancellations",
    category: "operations",
    fields: [
      { tier: 2, key: "reschedules_handled", label: "Reschedules handled", unit: "bookings", corroborate: null },
      { tier: 2, key: "cancellations_handled", label: "Cancellations handled", unit: "bookings", corroborate: null },
      notes("reschedules_notes", "Notes", "Reasons, patterns, anything the schedule needs to know."),
    ],
  },
  {
    id: "customer_issue",
    label: "Handled a customer issue or complaint",
    category: "operations",
    fields: [
      { tier: 2, key: "issues_handled", label: "Issues handled", unit: "issues", corroborate: null },
      notes(
        "customer_issue_notes",
        "What happened and how it was resolved",
        "Customer, the issue, what you did, and whether it's closed.",
        4,
      ),
    ],
  },
  {
    id: "qc_followup",
    label: "QC follow-up",
    category: "operations",
    fields: [
      { tier: 2, key: "qc_followups", label: "QC follow-ups", unit: "jobs", corroborate: null },
      notes("qc_notes", "Notes", "What you checked and what you found."),
    ],
  },
  {
    id: "review_requests",
    label: "Sent review / feedback requests",
    category: "operations",
    fields: [
      {
        tier: 2,
        key: "review_requests_sent",
        label: "Review requests sent",
        unit: "requests",
        corroborate: {
          mode: "ceiling",
          metrics: ["sms_sent"],
          describe: "outbound SMS from your GHL user",
        },
      },
      notes("review_requests_notes", "Notes", "Anything notable in the responses."),
    ],
  },

  // ── Sales & Revenue ─────────────────────────────────────────────────────
  {
    id: "outbound_calling",
    label: "Outbound calling",
    category: "sales",
    fields: [
      { tier: 1, metric: "calls_placed" },
      { tier: 1, metric: "conversations_connected" },
      {
        tier: 2,
        key: "quotes_from_calls",
        label: "Quotes resulting from calls",
        unit: "quotes",
        corroborate: {
          mode: "direct",
          metrics: ["quotes_sent"],
          describe: "quotes saved and sent under your name in the workspace",
        },
      },
      notes("outbound_calling_notes", "Notes on notable calls", "Who's worth calling back and why."),
    ],
  },
  {
    id: "quotes_sent",
    label: "Sent quotes",
    category: "sales",
    fields: [
      { tier: 1, metric: "quotes_sent" },
      {
        tier: 2,
        key: "quotes_sent_reported",
        label: "Quotes you sent today",
        unit: "quotes",
        help: "Include anything quoted outside the workspace.",
        corroborate: {
          mode: "direct",
          metrics: ["quotes_sent"],
          describe: "quotes recorded in the workspace under your name",
        },
      },
      notes("quotes_notes", "Notes", "Pricing pushback, competitors, anything worth knowing."),
    ],
  },
  {
    id: "commercial_outreach",
    label: "Commercial outreach",
    category: "sales",
    fields: [
      {
        tier: 2,
        key: "businesses_contacted",
        label: "Businesses contacted",
        unit: "businesses",
        corroborate: {
          mode: "ceiling",
          metrics: ["calls_placed", "sms_sent", "commercial_accounts_touched"],
          describe: "GHL outbound activity plus commercial accounts touched",
        },
      },
      {
        tier: 3,
        key: "commercial_method",
        label: "Method",
        choices: ["Call", "Email", "In-person"],
        multiple: true,
      },
      { tier: 1, metric: "walkthroughs_booked" },
      notes("commercial_notes", "Notes", "Who's interested, who to circle back to."),
    ],
  },
  {
    id: "commercial_walkthrough",
    label: "Commercial walkthrough booked",
    category: "sales",
    fields: [
      { tier: 1, metric: "walkthroughs_booked" },
      { tier: 1, metric: "commercial_accounts_touched" },
      notes("walkthrough_notes", "Notes", "Site, decision maker, and what they need."),
    ],
  },
  {
    id: "str_outreach",
    label: "STR / Airbnb partnership outreach",
    category: "sales",
    fields: [
      {
        tier: 2,
        key: "str_hosts_contacted",
        label: "Hosts contacted",
        unit: "hosts",
        corroborate: {
          mode: "ceiling",
          metrics: ["calls_placed", "sms_sent"],
          describe: "GHL outbound calls and SMS",
        },
      },
      notes("str_notes", "Notes", "Property counts, turnover volume, objections."),
    ],
  },
  {
    id: "reactivation",
    label: "Reactivation outreach",
    category: "sales",
    fields: [
      {
        tier: 2,
        key: "reactivation_attempts",
        label: "Reactivation attempts",
        unit: "customers",
        corroborate: {
          mode: "ceiling",
          metrics: ["calls_placed", "sms_sent"],
          describe: "GHL outbound calls and SMS",
        },
      },
      {
        tier: 2,
        key: "reactivation_rebooked",
        label: "Customers who rebooked",
        unit: "customers",
        corroborate: {
          mode: "direct",
          metrics: ["bookings_created"],
          describe: "bookings created and attributed to you",
        },
      },
      notes("reactivation_notes", "Notes", "Why they left, what would bring them back."),
    ],
  },
  {
    id: "pending_quote_followup",
    label: "Followed up on pending quotes",
    category: "sales",
    fields: [
      {
        tier: 2,
        key: "pending_quotes_followed",
        label: "Pending quotes followed up",
        unit: "quotes",
        corroborate: {
          mode: "ceiling",
          metrics: ["calls_placed", "sms_sent"],
          describe: "GHL outbound calls and SMS",
        },
      },
      notes("pending_quote_notes", "Notes", "Who's close, who's gone cold."),
    ],
  },

  // ── Recruiting & Talent ─────────────────────────────────────────────────
  {
    id: "applications_reviewed",
    label: "Reviewed applications",
    category: "recruiting",
    fields: [
      { tier: 1, metric: "applications_reviewed" },
      notes("applications_notes", "Notes", "Quality of the pipeline, sourcing gaps."),
    ],
  },
  {
    id: "phone_screens",
    label: "Conducted phone screens",
    category: "recruiting",
    fields: [
      { tier: 1, metric: "phone_screens_completed" },
      { tier: 1, metric: "screens_advanced" },
      { tier: 1, metric: "screens_held" },
      { tier: 1, metric: "screens_declined" },
      notes("screens_notes", "Notes on candidates", "Standouts, concerns, follow-ups."),
    ],
  },
  {
    id: "onboarding_launched",
    label: "Launched onboarding",
    category: "recruiting",
    fields: [
      { tier: 1, metric: "onboarding_launched" },
      notes("onboarding_notes", "Notes", "Anyone stuck, anything blocking their start."),
    ],
  },
  {
    id: "cleaners_activated",
    label: "Activated cleaners",
    category: "recruiting",
    fields: [
      { tier: 1, metric: "cleaners_activated" },
      notes("activation_notes", "Notes", "Readiness, zone coverage, first-job plans."),
    ],
  },
  {
    id: "recruiting_outreach",
    label: "Recruiting outreach",
    category: "recruiting",
    hint: "Job posts, sourcing, reaching out to candidates",
    fields: [
      { tier: 2, key: "job_posts_published", label: "Job posts published", unit: "posts", corroborate: null },
      {
        tier: 2,
        key: "candidates_sourced",
        label: "Candidates sourced or contacted",
        unit: "candidates",
        corroborate: {
          mode: "ceiling",
          metrics: ["calls_placed", "sms_sent"],
          describe: "GHL outbound calls and SMS",
        },
      },
      notes("recruiting_outreach_notes", "Notes", "Which channels are working."),
    ],
  },

  // ── Admin & Other ───────────────────────────────────────────────────────
  {
    id: "expenses_logged",
    label: "Logged expenses / ad spend",
    category: "admin",
    fields: [
      { tier: 2, key: "expense_entries", label: "Entries logged", unit: "entries", corroborate: null },
      notes("expenses_notes", "Notes", "What was logged and where."),
    ],
  },
  {
    id: "data_cleanup",
    label: "Data cleanup / record updates",
    category: "admin",
    fields: [
      { tier: 2, key: "records_updated", label: "Records updated", unit: "records", corroborate: null },
      notes("data_cleanup_notes", "Notes", "Which system, and what you fixed."),
    ],
  },
  {
    id: "training",
    label: "Training",
    category: "admin",
    fields: [notes("training_notes", "What you worked on", "Course, doc, or shadowing — and what you took from it.")],
  },
  {
    id: "other",
    label: "Other",
    category: "admin",
    hint: "Requires a short description",
    requiresDescription: true,
    fields: [
      notes("other_description", "What did you work on?", "A sentence is enough.", 3),
    ],
  },
];

export const TASKS_BY_ID: Record<string, TaskDef> = Object.fromEntries(
  TASKS.map((t) => [t.id, t]),
);

export const TASK_IDS = TASKS.map((t) => t.id);

// ─── The always-present core block ────────────────────────────────────────────
//
// Rendered regardless of which tasks were selected. Hours is the only Tier 1
// field here; everything else is qualitative and never scored.

export const CORE_HOURS_METRIC: MetricKey = "hours_tracked";

export const CORE_FIELDS: Tier3Field[] = [
  {
    tier: 3,
    key: "blockers",
    label: "Blockers / what's stuck",
    placeholder: "What slowed you down or is waiting on someone else?",
    rows: 3,
  },
  {
    tier: 3,
    key: "priorities",
    label: "Tomorrow's top 3 priorities",
    placeholder: "1.\n2.\n3.",
    rows: 4,
  },
  {
    tier: 3,
    key: "wins",
    label: "Wins",
    placeholder: "Anything that went well today.",
    rows: 2,
  },
  {
    tier: 3,
    key: "escalations",
    label: "Anything Malik needs to know / escalations",
    placeholder: "Say it here — this field is never scored.",
    rows: 3,
  },
];

/** Core Tier 3 keys are columns on va_eod_submissions, not task_notes entries. */
export const CORE_TEXT_KEYS = CORE_FIELDS.map((f) => f.key) as Array<
  "blockers" | "priorities" | "wins" | "escalations"
>;

// ─── Derived helpers (shared by client and server) ────────────────────────────

export function tasksFor(taskIds: string[]): TaskDef[] {
  return taskIds.map((id) => TASKS_BY_ID[id]).filter(Boolean);
}

/** Every Tier 1 metric revealed by this task selection, plus the core hours. */
export function visibleMetrics(taskIds: string[]): MetricKey[] {
  const out = new Set<MetricKey>([CORE_HOURS_METRIC]);
  for (const task of tasksFor(taskIds)) {
    for (const f of task.fields) if (isTier1(f)) out.add(f.metric);
  }
  return [...out];
}

/** Every Tier 2 field revealed by this task selection. */
export function tier2Fields(taskIds: string[]): Tier2Field[] {
  const out: Tier2Field[] = [];
  for (const task of tasksFor(taskIds)) {
    for (const f of task.fields) if (isTier2(f)) out.push(f);
  }
  return out;
}

const ALL_TIER2 = new Map<string, Tier2Field>();
for (const task of TASKS) {
  for (const f of task.fields) if (isTier2(f)) ALL_TIER2.set(f.key, f);
}

export function tier2FieldByKey(key: string): Tier2Field | undefined {
  return ALL_TIER2.get(key);
}

/** Every qualitative key that lives in `task_notes` (i.e. not a core column). */
export function taskNoteKeys(taskIds: string[]): string[] {
  const out: string[] = [];
  for (const task of tasksFor(taskIds)) {
    for (const f of task.fields) {
      if (f.tier === 3) out.push(f.key);
    }
  }
  return out;
}

// ─── Validation (run on the client for feedback, on the server for truth) ────

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface SubmissionInput {
  tasksSelected: string[];
  selfReported: Record<string, unknown>;
  taskNotes: Record<string, unknown>;
}

/**
 * Validate a submission against the catalog. Deliberately forgiving on Tier 2:
 * a blank number is allowed (not every day has one) — we only reject values
 * that are impossible. Qualitative fields are never required except the "Other"
 * description, which exists so an unlabelled task can still be understood.
 */
export function validateSubmission(input: SubmissionInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!input.tasksSelected.length) {
    issues.push({ field: "tasks", message: "Select at least one task you worked on today." });
  }

  for (const id of input.tasksSelected) {
    if (!TASKS_BY_ID[id]) {
      issues.push({ field: "tasks", message: `Unknown task: ${id}` });
    }
  }

  for (const task of tasksFor(input.tasksSelected)) {
    if (task.requiresDescription) {
      const descField = task.fields.find((f) => isTier3Text(f)) as Tier3Field | undefined;
      const value = descField ? String(input.taskNotes[descField.key] ?? "").trim() : "";
      if (!value) {
        issues.push({
          field: descField?.key || task.id,
          message: `"${task.label}" needs a short description.`,
        });
      }
    }
  }

  for (const field of tier2Fields(input.tasksSelected)) {
    const raw = input.selfReported[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      issues.push({ field: field.key, message: `${field.label} must be a number of 0 or more.` });
    } else if (n > 100000) {
      issues.push({ field: field.key, message: `${field.label} looks out of range.` });
    }
  }

  return issues;
}

/**
 * Strip a client payload down to what the catalog actually allows for the
 * selected tasks. Tier 1 metrics can never arrive this way — the server reads
 * them from va_verified_metrics — so anything resembling one is discarded.
 */
export function sanitizeSelfReported(
  taskIds: string[],
  raw: Record<string, unknown>,
): Record<string, number> {
  const allowed = new Set(tier2Fields(taskIds).map((f) => f.key));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!allowed.has(k)) continue;
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function sanitizeTaskNotes(
  taskIds: string[],
  raw: Record<string, unknown>,
): Record<string, string | string[]> {
  const allowed = new Map<string, EodField>();
  for (const task of tasksFor(taskIds)) {
    for (const f of task.fields) {
      if (f.tier === 3) allowed.set(f.key, f);
    }
  }
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const field = allowed.get(k);
    if (!field) continue;
    if (isChoice(field)) {
      const list = Array.isArray(v) ? v : [v];
      const valid = list.map(String).filter((c) => field.choices.includes(c));
      if (valid.length) out[k] = field.multiple ? valid : valid.slice(0, 1);
    } else {
      const s = String(v ?? "").trim();
      if (s) out[k] = s.slice(0, 4000);
    }
  }
  return out;
}
