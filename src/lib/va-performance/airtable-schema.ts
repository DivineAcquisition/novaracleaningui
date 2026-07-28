// ─── "Novara — Team Performance" base definition ──────────────────────────────
//
// The seven tables from the spec, defined declaratively so the provisioner can
// create the base, add anything missing to an existing base, and wire the links
// — all idempotently. Field IDs are discovered at runtime (this base is created
// by us, so unlike the Revenue Ops base there are no pre-existing IDs to pin).
//
// Airtable is a MIRROR here. Supabase remains the system of record: the EOD
// form writes there, the verification layer writes there, and this base is
// refreshed from it. Nothing reads back from Airtable into the app, so a human
// editing a cell can never overwrite a verified metric.

import type { CreateFieldSpec } from "@/lib/airtable/client";
import { METRIC_FIELDS, SELECT_FIELDS } from "./catalog";

export const TEAM_PERF_BASE_NAME = "Novara — Team Performance";

export type TeamPerfTableKey =
  | "vas"
  | "eodSubmissions"
  | "verifiedMetrics"
  | "discrepancyFlags"
  | "kpiTargets"
  | "performancePeriods"
  | "coachingLog";

const CHECKBOX = { color: "greenBright", icon: "check" } as const;
const DATE = { dateFormat: { name: "iso" } } as const;
const DATETIME = {
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
  timeZone: "America/New_York",
} as const;
const INT = { precision: 0 } as const;
const DEC2 = { precision: 2 } as const;
const USD = { precision: 2, symbol: "$" } as const;

const select = (choices: string[]) => ({ choices: choices.map((name) => ({ name })) });

export interface TableSpec {
  key: TeamPerfTableKey;
  name: string;
  description: string;
  /** First field becomes the primary field and the upsert merge key. */
  fields: CreateFieldSpec[];
  /** Link fields added after every table exists (Airtable needs the target id). */
  links?: { name: string; to: TeamPerfTableKey }[];
}

export const TEAM_PERF_TABLES: TableSpec[] = [
  {
    key: "vas",
    name: "VAs",
    description:
      "One row per virtual assistant. Email is the merge key. Verification identity (Apploye / workspace user IDs) lives here — that is how activity is attributed to a person.",
    // ADDITIVE ONLY. This table already exists in the Client & Revenue Ops base
    // and is owned by the VA onboarding sync (src/lib/airtable/vas.ts), which
    // writes Name, Phone, Role, Pay Type, Status, agreement dates and Notes.
    //
    // Nothing here may collide with those. The existing "Status" is the
    // onboarding lifecycle (Invited → Approved) and "Pay Type" is
    // Base pay / Hourly — writing performance values into either would corrupt
    // a column another sync owns. Performance standing gets its own field, and
    // only fields this layer owns are written.
    fields: [
      { name: "Email", type: "email" },
      { name: "Name", type: "singleLineText" },
      {
        name: "Performance Status",
        type: "singleSelect",
        options: select(["Active", "Probation", "Inactive", "Removed"]),
      },
      { name: "Rate", type: "currency", options: USD },
      { name: "Start Date", type: "date", options: DATE },
      {
        name: "Functions Assigned",
        type: "multipleSelects",
        options: select(["Operations", "Sales", "Recruiting"]),
      },
      { name: "Apploye Member ID", type: "singleLineText" },
      { name: "Workspace User ID", type: "singleLineText" },
      { name: "Perf Last Synced", type: "dateTime", options: DATETIME },
    ],
  },
  {
    key: "eodSubmissions",
    name: "EOD Submissions",
    description:
      "One record per VA per day. Holds what the VA supplied: the tasks they selected, their Tier 2 self-reported numbers, and their qualitative notes. Qualitative fields are never scored.",
    fields: [
      { name: "Submission ID", type: "singleLineText" },
      { name: "Date", type: "date", options: DATE },
      { name: "Submitted At", type: "dateTime", options: DATETIME },
      // One column per entered metric, so the base is queryable rather than a
      // wall of JSON. Currency fields keep their own type.
      ...METRIC_FIELDS.map((m) => ({
        name: m.label,
        type: m.currency ? "currency" : "number",
        options: m.currency ? USD : INT,
      })),
      // The verification half of the record: what the system saw, beside what
      // was entered. Kept as text so "not tracked" reads as itself rather than
      // collapsing into a blank cell.
      { name: "Entered vs Verified", type: "multilineText" },
      ...SELECT_FIELDS.map((f) => ({
        name: f.label,
        type: "singleSelect",
        options: select(f.options),
      })),
      { name: "Blockers", type: "multilineText" },
      { name: "Escalations", type: "multilineText" },
      { name: "Cleaner Issue Notes", type: "multilineText" },
      { name: "Tomorrow's Priorities", type: "multilineText" },
      { name: "Wins", type: "multilineText" },
      { name: "Status", type: "singleSelect", options: select(["Submitted", "Reviewed", "Flagged", "Draft"]) },
      { name: "Submitted Late", type: "checkbox", options: { ...CHECKBOX } },
      { name: "Locked", type: "checkbox", options: { ...CHECKBOX } },
      // The generated record. Airtable fetches and re-hosts the PDF itself.
      { name: "EOD Report PDF", type: "multipleAttachments" },
      { name: "Drive Link", type: "url" },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [
      { name: "VA", to: "vas" },
      { name: "Verified Metrics", to: "verifiedMetrics" },
      { name: "Discrepancy Flags", to: "discrepancyFlags" },
    ],
  },
  {
    key: "verifiedMetrics",
    name: "Verified Metrics",
    description:
      "SYSTEM-WRITTEN ONLY — never hand-edit. This is the source of truth for what actually happened. A blank cell means UNVERIFIED (the source was unreachable or the VA isn't linked to it); it does NOT mean zero. Source Sync Status records which source reported what.",
    fields: [
      { name: "Metric ID", type: "singleLineText" },
      { name: "Date", type: "date", options: DATE },
      { name: "Hours Tracked", type: "number", options: DEC2 },
      { name: "Calls Placed", type: "number", options: INT },
      { name: "Conversations Connected", type: "number", options: INT },
      { name: "SMS Sent", type: "number", options: INT },
      { name: "Inbound Leads", type: "number", options: INT },
      { name: "Leads Responded", type: "number", options: INT },
      { name: "Median Response Time (s)", type: "number", options: INT },
      { name: "Leads Converted", type: "number", options: INT },
      { name: "Bookings Created", type: "number", options: INT },
      { name: "Revenue Booked", type: "currency", options: USD },
      { name: "Revenue Collected", type: "currency", options: USD },
      { name: "Quotes Sent", type: "number", options: INT },
      { name: "Applications Reviewed", type: "number", options: INT },
      { name: "Phone Screens Completed", type: "number", options: INT },
      { name: "Onboarding Launched", type: "number", options: INT },
      { name: "Cleaners Activated", type: "number", options: INT },
      { name: "Commercial Accounts Touched", type: "number", options: INT },
      { name: "Walkthroughs Booked", type: "number", options: INT },
      { name: "Source Sync Status", type: "multilineText" },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [{ name: "VA", to: "vas" }],
  },
  {
    key: "discrepancyFlags",
    name: "Discrepancy Flags",
    description:
      "A variance between a self-reported number and its corroborating signal. A flag is a prompt to review, not an accusation — it captures the VA's explanation and a human's decision. Nothing is ever auto-penalized from a variance.",
    fields: [
      { name: "Flag ID", type: "singleLineText" },
      { name: "Date", type: "date", options: DATE },
      { name: "Metric", type: "singleLineText" },
      { name: "Self-Reported Value", type: "number", options: DEC2 },
      { name: "Verified Value", type: "number", options: DEC2 },
      { name: "Variance", type: "number", options: DEC2 },
      { name: "Variance %", type: "number", options: DEC2 },
      { name: "Severity", type: "singleSelect", options: select(["Low", "Medium", "High"]) },
      {
        name: "Status",
        type: "singleSelect",
        options: select(["Open", "Explained", "Confirmed Issue", "Dismissed"]),
      },
      { name: "VA Explanation", type: "multilineText" },
      { name: "Review Note", type: "multilineText" },
      { name: "Reviewed By", type: "singleLineText" },
      { name: "Reviewed At", type: "dateTime", options: DATETIME },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [
      { name: "VA", to: "vas" },
      { name: "EOD Submission", to: "eodSubmissions" },
    ],
  },
  {
    key: "kpiTargets",
    name: "KPI Targets",
    description:
      "What good looks like, per function or per VA. Targets scale to the review window; a metric with no verified data is left unscored rather than counted as a miss.",
    fields: [
      { name: "Target ID", type: "singleLineText" },
      {
        name: "Function",
        type: "singleSelect",
        options: select(["All", "Operations", "Sales", "Recruiting"]),
      },
      { name: "Metric", type: "singleLineText" },
      { name: "Target Value", type: "number", options: DEC2 },
      { name: "Comparator", type: "singleSelect", options: select(["At or above", "At or below"]) },
      { name: "Unit", type: "singleLineText" },
      { name: "Period", type: "singleSelect", options: select(["Daily", "Weekly", "Monthly"]) },
      { name: "Active", type: "checkbox", options: { ...CHECKBOX } },
      { name: "Effective Date", type: "date", options: DATE },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [{ name: "Applies To", to: "vas" }],
  },
  {
    key: "performancePeriods",
    name: "Performance Periods",
    description:
      "A weekly or monthly rollup generated for a documented review conversation. Revenue per VA Hour is the number that answers whether the VA is paying for themselves.",
    fields: [
      { name: "Period ID", type: "singleLineText" },
      { name: "Period Type", type: "singleSelect", options: select(["Weekly", "Monthly"]) },
      { name: "Start", type: "date", options: DATE },
      { name: "End", type: "date", options: DATE },
      { name: "Total Hours", type: "number", options: DEC2 },
      { name: "Metric Rollups", type: "multilineText" },
      { name: "Target Attainment %", type: "number", options: DEC2 },
      { name: "Revenue Attributed", type: "currency", options: USD },
      { name: "Revenue per VA Hour", type: "currency", options: USD },
      { name: "EOD Compliance %", type: "number", options: DEC2 },
      { name: "Discrepancy Count", type: "number", options: INT },
      {
        name: "Overall Rating",
        type: "singleSelect",
        options: select(["Exceeding", "On Track", "Needs Improvement", "At Risk"]),
      },
      { name: "Reviewed By", type: "singleLineText" },
      { name: "Review Notes", type: "multilineText" },
      { name: "Status", type: "singleSelect", options: select(["Draft", "Reviewed", "Final"]) },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [{ name: "VA", to: "vas" }],
  },
  {
    key: "coachingLog",
    name: "Coaching Log",
    description:
      "The documented ladder: coaching conversation, then formal warning. Never a pay consequence — consistent with 1099 contractor treatment.",
    fields: [
      { name: "Entry ID", type: "singleLineText" },
      { name: "Date", type: "date", options: DATE },
      {
        name: "Type",
        type: "singleSelect",
        options: select(["Coaching Note", "Formal Warning", "Recognition", "Performance Review"]),
      },
      { name: "Trigger", type: "singleLineText" },
      { name: "Summary", type: "multilineText" },
      { name: "Action Agreed", type: "multilineText" },
      { name: "Follow-up Date", type: "date", options: DATE },
      { name: "Logged By", type: "singleLineText" },
      { name: "Outcome", type: "multilineText" },
      { name: "Last Synced", type: "dateTime", options: DATETIME },
    ],
    links: [
      { name: "VA", to: "vas" },
      { name: "Trigger Flag", to: "discrepancyFlags" },
      { name: "Trigger Period", to: "performancePeriods" },
    ],
  },
];

export const TABLE_BY_KEY: Record<TeamPerfTableKey, TableSpec> = Object.fromEntries(
  TEAM_PERF_TABLES.map((t) => [t.key, t]),
) as Record<TeamPerfTableKey, TableSpec>;
