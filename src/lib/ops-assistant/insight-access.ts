// ─── Role-scoped insight / aggregate access ───────────────────────────────
//
// Aggregate business data is visible to the assistant only when the asker's
// role already permits seeing that data in the workspace. This is the
// existing "never widen a user's effective permissions" rule applied to
// totals, not just individual records.
//
// A VA asking company-wide revenue/profit/margin/CAC is routed to
// "that's outside what I can share — check with Malik" — the same
// escalation pattern as out-of-policy topics. The assistant must not
// compute the number and then refuse; it must not compute it at all.

import type { AssistantRole, GuardrailResult } from "./types";

export const FINANCIAL_SCOPE_REASON =
  "that's outside what I can share — check with Malik";

/** Company-wide / account-level financials that live on admin-only screens. */
const FINANCIAL_RE =
  /\b(profit|margin|ebitda|cac|ltv|ad ?spend|mrr|payroll|payouts? to cleaners|net income|gross margin)\b/i;

const FINANCIAL_WITH_SCOPE_RE =
  /\b(revenue|sales dollars|how much (did|have) we (make|made|collect|book)|how'?s (revenue|sales) tracking|(this|our|the) month'?s (revenue|sales|profit)|company[- ]wide|account-level financial)\b/i;

const ZONE_REVENUE_RE = /\bzone\b.{0,40}\b(revenue|profit|sales|made)\b|\b(revenue|profit|sales).{0,40}\bzone\b/i;

const WEEKLY_REPORT_RE = /\bweekly (sales )?report\b|\bexecutive summary\b/i;

/** Operational counts a VA already sees on Bookings / QC. */
const OPERATIONAL_RE =
  /\b(re-?clean rate|reclean|how many bookings|which zone.{0,40}bookings|bookings this (week|month)|qc cases|quality control (cases|issues)|jobs completed this)\b/i;

const ADMIN_OPS_RE =
  /\b(eod (on-?time|reports?)|novara score|va calls|accountability actions|ad ?spend)\b/i;

export type InsightTopic =
  | "financial"
  | "operational"
  | "admin_ops"
  | "none";

export function classifyInsightTopic(message: string): InsightTopic {
  const text = message || "";
  if (FINANCIAL_RE.test(text) || FINANCIAL_WITH_SCOPE_RE.test(text) || ZONE_REVENUE_RE.test(text)) {
    return "financial";
  }
  if (WEEKLY_REPORT_RE.test(text) && /\b(revenue|profit|margin|numbers|metrics|tracking)\b/i.test(text)) {
    return "financial";
  }
  if (ADMIN_OPS_RE.test(text)) return "admin_ops";
  if (OPERATIONAL_RE.test(text) || WEEKLY_REPORT_RE.test(text)) return "operational";
  return "none";
}

/** True when this question would reveal aggregate financials. */
export function isFinancialAggregate(message: string): boolean {
  return classifyInsightTopic(message) === "financial";
}

/**
 * Hard permission gate. Fires only for VAs on financial (and admin-only ops)
 * aggregates. Admins are never blocked here — they already see Weekly Report
 * and VA Performance.
 */
export function financialScopeForRole(message: string, role: AssistantRole): GuardrailResult {
  if (role === "admin") return { kind: "none", reason: null };
  const topic = classifyInsightTopic(message);
  if (topic === "financial" || topic === "admin_ops") {
    return { kind: "escalation", reason: FINANCIAL_SCOPE_REASON };
  }
  return { kind: "none", reason: null };
}

export function wantsInsightData(message: string): boolean {
  return classifyInsightTopic(message) !== "none";
}

/** Metric keys on the stored weekly report that are admin-only financials. */
export const ADMIN_ONLY_METRIC_KEYS = new Set([
  "revenue_booked_cents",
  "revenue_collected_cents",
  "mrr_cents",
  "ad_spend_cents",
  "referral_credits_cents",
  "referral_credit_cost_cents",
  "reclean_absorbed_cents",
  "va_calls",
  "va_leads_responded",
  "va_screens",
  "va_hires",
  "va_eod_submitted",
  "va_eod_ontime_pct",
  "accountability_actions",
  "novara_score_avg",
  "churn_pct",
]);

/** Operational metric keys a VA may hear if we ever read them from live tables — never from weekly_reports (admin RLS). */
export const VA_OK_LIVE_TOPICS = new Set(["reclean", "zone_volume", "bookings", "qc"]);

export function insightMetricKeysFor(message: string): string[] {
  const text = (message || "").toLowerCase();
  const keys: string[] = [];
  const add = (...k: string[]) => {
    for (const key of k) if (!keys.includes(key)) keys.push(key);
  };
  if (/\brevenue|sales tracking|how much did we (make|collect|book)/i.test(text)) {
    add("revenue_booked_cents", "revenue_collected_cents", "bookings_made", "jobs_completed");
  }
  if (/\bprofit|margin|payroll\b/i.test(text)) {
    add("revenue_collected_cents", "reclean_absorbed_cents", "ad_spend_cents");
  }
  if (/\bcac|ad ?spend\b/i.test(text)) add("ad_spend_cents", "new_customers", "bookings_made");
  if (/\bmrr|churn|member/i.test(text)) add("mrr_cents", "churn_pct", "active_members", "new_enrollments");
  if (/\bre-?clean/i.test(text)) add("recleans_completed", "jobs_completed", "reclean_absorbed_cents");
  if (/\bqc\b|quality control/i.test(text)) add("qc_cases", "qc_open");
  if (/\bbookings?\b/.test(text)) add("bookings_made", "jobs_completed");
  if (/\breferral/i.test(text)) add("referrals_sent", "referrals_booked", "referral_credits_cents");
  if (/\beod\b/.test(text)) add("va_eod_submitted", "va_eod_ontime_pct");
  if (/\bweekly (sales )?report\b/.test(text)) {
    add("revenue_booked_cents", "revenue_collected_cents", "bookings_made", "jobs_completed", "recleans_completed");
  }
  if (!keys.length && classifyInsightTopic(message) !== "none") {
    add("bookings_made", "jobs_completed", "recleans_completed", "qc_cases");
  }
  return keys;
}
