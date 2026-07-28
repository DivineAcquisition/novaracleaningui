// ─── Verified metric vocabulary ───────────────────────────────────────────────
//
// Every number the verification layer can observe, and where it comes from.
// This is the contract shared by the collectors (server), the EOD form
// (browser), the discrepancy engine and the Airtable mirror — one definition,
// no drifting duplicates.
//
// A metric value is `number | null`. NULL means UNVERIFIED: the source was
// unreachable, unconfigured, or the VA isn't linked to it. It is never
// rendered as 0, never summed as 0, and never used to raise a discrepancy.
//
// Apploye appears here exactly once, for `hours_tracked`. There is no metric
// for activity level, screenshots, keystrokes or app usage — that data is not
// requested from the API and has no home in this system.

export const METRIC_SOURCES = {
  apploye: "Apploye",
  ghl: "GHL",
  airtableRevenueOps: "Airtable — Client & Revenue Ops",
  airtableTalent: "Airtable — Talent Acquisition",
  workspace: "Workspace",
  stripe: "Stripe",
} as const;

export type MetricSource = keyof typeof METRIC_SOURCES;

/** How a metric should be rendered wherever it is shown. */
export type MetricFormat = "count" | "hours" | "currency" | "duration";

export interface MetricDef {
  key: MetricKey;
  label: string;
  source: MetricSource;
  format: MetricFormat;
  /** Short note explaining what the source actually counted. */
  detail: string;
}

export type MetricKey =
  | "hours_tracked"
  | "calls_placed"
  | "conversations_connected"
  | "sms_sent"
  | "inbound_leads"
  | "leads_responded"
  | "median_response_seconds"
  | "leads_converted"
  | "bookings_created"
  | "jobs_completed"
  | "revenue_booked_cents"
  | "quotes_sent"
  | "commercial_accounts_touched"
  | "walkthroughs_booked"
  | "revenue_collected_cents"
  | "applications_reviewed"
  | "phone_screens_completed"
  | "screens_advanced"
  | "screens_held"
  | "screens_declined"
  | "onboarding_launched"
  | "cleaners_activated";

export const METRICS: Record<MetricKey, MetricDef> = {
  hours_tracked: {
    key: "hours_tracked",
    label: "Hours worked today",
    source: "apploye",
    format: "hours",
    detail: "Sum of your Apploye time entries for this date. Hours only — no activity or screenshot data is read.",
  },
  calls_placed: {
    key: "calls_placed",
    label: "Calls placed",
    source: "ghl",
    format: "count",
    detail: "Outbound calls logged against your GHL user for this date.",
  },
  conversations_connected: {
    key: "conversations_connected",
    label: "Conversations connected",
    source: "ghl",
    format: "count",
    detail: "Calls that connected and lasted long enough to be a real conversation.",
  },
  sms_sent: {
    key: "sms_sent",
    label: "SMS sent",
    source: "ghl",
    format: "count",
    detail: "Outbound SMS sent from your GHL user.",
  },
  inbound_leads: {
    key: "inbound_leads",
    label: "Leads received",
    source: "ghl",
    format: "count",
    detail: "Inbound leads assigned to you on this date.",
  },
  leads_responded: {
    key: "leads_responded",
    label: "Leads responded to",
    source: "ghl",
    format: "count",
    detail: "Assigned leads that received a first outbound touch.",
  },
  median_response_seconds: {
    key: "median_response_seconds",
    label: "Median response time",
    source: "ghl",
    format: "duration",
    detail: "Median time from lead arrival to your first outbound touch.",
  },
  leads_converted: {
    key: "leads_converted",
    label: "Leads that converted",
    source: "ghl",
    format: "count",
    detail: "Assigned leads that became a booking on this date.",
  },
  bookings_created: {
    key: "bookings_created",
    label: "Bookings created",
    source: "airtableRevenueOps",
    format: "count",
    detail: "Jobs created and attributed to you on this date.",
  },
  jobs_completed: {
    key: "jobs_completed",
    label: "Jobs completed",
    source: "airtableRevenueOps",
    format: "count",
    detail:
      "Bookings marked completed on this date. Counted company-wide — a job is finished by the cleaner, not by whoever booked it.",
  },
  revenue_booked_cents: {
    key: "revenue_booked_cents",
    label: "Revenue booked",
    source: "airtableRevenueOps",
    format: "currency",
    detail: "Total estimate value of the bookings attributed to you.",
  },
  quotes_sent: {
    key: "quotes_sent",
    label: "Quotes sent",
    source: "workspace",
    format: "count",
    detail: "Quotes saved and sent from the workspace under your name.",
  },
  commercial_accounts_touched: {
    key: "commercial_accounts_touched",
    label: "Commercial accounts touched",
    source: "airtableRevenueOps",
    format: "count",
    detail: "Commercial or office accounts you created or updated on this date.",
  },
  walkthroughs_booked: {
    key: "walkthroughs_booked",
    label: "Walkthroughs booked",
    source: "airtableRevenueOps",
    format: "count",
    detail: "Commercial or office site visits scheduled and attributed to you on this date.",
  },
  revenue_collected_cents: {
    key: "revenue_collected_cents",
    label: "Revenue collected",
    source: "stripe",
    format: "currency",
    detail: "Payments that actually settled against bookings attributed to you.",
  },
  applications_reviewed: {
    key: "applications_reviewed",
    label: "Applications reviewed",
    source: "airtableTalent",
    format: "count",
    detail: "Applicant records you moved out of the unreviewed queue.",
  },
  phone_screens_completed: {
    key: "phone_screens_completed",
    label: "Phone screens completed",
    source: "workspace",
    format: "count",
    detail: "Screening records you submitted from the cleaner hub.",
  },
  screens_advanced: {
    key: "screens_advanced",
    label: "Screens — advanced",
    source: "workspace",
    format: "count",
    detail: "Screens you recommended to advance.",
  },
  screens_held: {
    key: "screens_held",
    label: "Screens — held",
    source: "workspace",
    format: "count",
    detail: "Screens you placed on hold.",
  },
  screens_declined: {
    key: "screens_declined",
    label: "Screens — declined",
    source: "workspace",
    format: "count",
    detail: "Screens you declined.",
  },
  onboarding_launched: {
    key: "onboarding_launched",
    label: "Onboarding launched",
    source: "workspace",
    format: "count",
    detail: "Applicants you sent into onboarding.",
  },
  cleaners_activated: {
    key: "cleaners_activated",
    label: "Cleaners activated",
    source: "workspace",
    format: "count",
    detail: "Cleaners you activated after onboarding gates cleared.",
  },
};

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

/** Metric keys that are stored in cents and must be divided before display. */
export function isCurrency(key: MetricKey): boolean {
  return METRICS[key].format === "currency";
}

// ─── Source reachability ─────────────────────────────────────────────────────

export type SourceStatus = "ok" | "unavailable" | "not_configured" | "unlinked";

export interface SourceReport {
  status: SourceStatus;
  /** ISO timestamp of the attempt (successful or not). */
  syncedAt: string;
  error?: string;
}

export type SourceStatusMap = Partial<Record<MetricSource, SourceReport>>;

/** { metricKey: { source, syncedAt, status } } — provenance for every value. */
export type MetricProvenance = Partial<
  Record<MetricKey, { source: MetricSource; syncedAt: string; status: SourceStatus }>
>;

export type MetricValues = Partial<Record<MetricKey, number | null>>;

export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  ok: "Verified",
  unavailable: "Source unavailable",
  not_configured: "Source not connected",
  unlinked: "Not linked to this VA",
};

/**
 * A metric is verified only when the value is a real number AND its source
 * reported ok. Anything else renders as "unverified" — never as zero.
 */
export function isVerified(
  key: MetricKey,
  values: MetricValues,
  provenance: MetricProvenance,
): boolean {
  const v = values[key];
  if (v === null || v === undefined || Number.isNaN(v)) return false;
  const p = provenance[key];
  return !p || p.status === "ok";
}

// ─── Display formatting (shared by the form and the admin tab) ───────────────

export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  switch (METRICS[key].format) {
    case "hours":
      return `${value.toFixed(2)} h`;
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value / 100);
    case "duration": {
      const total = Math.round(value);
      if (total < 60) return `${total}s`;
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;
      const hrs = Math.floor(mins / 60);
      return `${hrs}h ${mins % 60}m`;
    }
    default:
      return new Intl.NumberFormat("en-US").format(value);
  }
}
