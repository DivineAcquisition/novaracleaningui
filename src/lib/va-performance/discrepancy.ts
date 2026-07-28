// ─── Discrepancy detection ────────────────────────────────────────────────────
//
// On submit, every Tier 2 answer is compared to its corroborating signal.
//
// A discrepancy is a PROMPT TO REVIEW, not an accusation. There are legitimate
// causes — work done outside the logged systems, a call from a personal line, a
// source outage, a metric that counts something slightly different. So:
//
//   * Nothing is flagged when the signal itself is unverified. We only compare
//     against numbers we actually observed.
//   * A `ceiling` corroboration only fires when the self-reported number is
//     ABOVE the observed activity. Being under it is normal.
//   * Severity escalates on size, and on repetition inside a rolling window.
//   * The flag asks the VA for an explanation. A human decides the outcome.
//   * Nothing here writes to pay, status, or any automated consequence.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { METRIC_FIELDS, metricFieldByKey, type MetricField } from "./catalog";
import { type MetricValues } from "./metrics";
import {
  getDiscrepancyThresholds,
  type DiscrepancyThresholds,
  type ThresholdBand,
} from "./settings";

export type Severity = "low" | "medium" | "high";

export interface DiscrepancyCandidate {
  metricKey: string;
  metricLabel: string;
  selfReported: number;
  verified: number;
  variance: number;
  variancePct: number;
  severity: Severity;
  repeatCount: number;
  /** What the number was compared against, in plain English. */
  comparedTo: string;
}

/** Threshold value for a band: the GREATER of pct-of-verified and the absolute. */
function thresholdFor(band: ThresholdBand, verified: number): number {
  return Math.max((band.pct / 100) * Math.abs(verified), band.abs);
}

function severityFor(
  variance: number,
  verified: number,
  thresholds: DiscrepancyThresholds,
): Severity | null {
  if (variance <= thresholdFor(thresholds.base, verified)) return null;
  if (variance > thresholdFor(thresholds.high, verified)) return "high";
  if (variance > thresholdFor(thresholds.medium, verified)) return "medium";
  return "low";
}

/**
 * Sum the corroborating metrics. Returns null when NONE of them is verified —
 * there is no signal, so there can be no discrepancy.
 */
function signalFor(field: MetricField, verified: MetricValues): number | null {
  if (!field.corroborate) return null;
  let total = 0;
  let sawOne = false;
  for (const key of field.corroborate.metrics) {
    const value = verified[key];
    if (value === null || value === undefined) continue;
    sawOne = true;
    total += value;
  }
  return sawOne ? total : null;
}

export interface EvaluateInput {
  /** The VA's entered metrics, keyed by metric field key. */
  selfReported: Record<string, number>;
  verified: MetricValues;
  /** Prior flag counts per metric inside the repeat window. */
  repeatCounts?: Record<string, number>;
  thresholds: DiscrepancyThresholds;
}

/** Pure evaluation — no I/O, so it is trivially testable and reusable. */
export function evaluateDiscrepancies(input: EvaluateInput): DiscrepancyCandidate[] {
  const out: DiscrepancyCandidate[] = [];

  for (const field of METRIC_FIELDS) {
    if (!field.corroborate) continue;

    const reported = input.selfReported[field.key];
    if (reported === undefined || reported === null || !Number.isFinite(reported)) continue;

    const signal = signalFor(field, input.verified);
    if (signal === null) continue;

    const rawVariance = reported - signal;
    // A ceiling signal is an upper bound: only exceeding it is meaningful.
    const variance = field.corroborate.mode === "ceiling" ? rawVariance : Math.abs(rawVariance);
    if (variance <= 0) continue;

    let severity = severityFor(variance, signal, input.thresholds);
    if (!severity) continue;

    const repeatCount = input.repeatCounts?.[field.key] ?? 0;
    if (repeatCount + 1 >= input.thresholds.repeat.count) severity = "high";

    out.push({
      metricKey: field.key,
      metricLabel: field.label,
      selfReported: reported,
      verified: signal,
      variance: Math.round(variance * 100) / 100,
      variancePct:
        signal === 0 ? 100 : Math.round((variance / Math.abs(signal)) * 1000) / 10,
      severity,
      repeatCount,
      comparedTo: field.corroborate.describe,
    });
  }

  return out;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** How many times each metric has already been flagged inside the window. */
export async function repeatCountsFor(
  vaId: string,
  workDate: string,
  windowDays: number,
): Promise<Record<string, number>> {
  const supabase = getAdminSupabase();
  const since = new Date(Date.parse(`${workDate}T12:00:00.000Z`) - windowDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data } = await supabase
    .from("va_discrepancy_flags")
    .select("metric_key, status")
    .eq("va_id", vaId)
    .gte("work_date", since)
    .lt("work_date", workDate)
    // A dismissed flag was a false alarm and must not count toward a repeat.
    .neq("status", "dismissed");

  const counts: Record<string, number> = {};
  for (const row of ((data || []) as Record<string, unknown>[])) {
    const key = String(row.metric_key);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export interface PersistedFlag extends DiscrepancyCandidate {
  id: string;
  isNew: boolean;
}

/**
 * Write the flags for a submission. Re-submitting the same day re-evaluates in
 * place: a metric that no longer varies has its open flag withdrawn, and one
 * that still does is updated rather than duplicated.
 *
 * A flag already reviewed by a human is never rewritten — their judgement
 * stands, and the row keeps the values it was judged on.
 */
export async function persistFlags(
  submissionId: string,
  vaId: string,
  workDate: string,
  candidates: DiscrepancyCandidate[],
): Promise<PersistedFlag[]> {
  const supabase = getAdminSupabase();

  const { data: existingRows } = await supabase
    .from("va_discrepancy_flags")
    .select("id, metric_key, status")
    .eq("submission_id", submissionId);
  const existing = new Map(
    ((existingRows || []) as Record<string, unknown>[]).map((r) => [
      String(r.metric_key),
      { id: String(r.id), status: String(r.status) },
    ]),
  );

  const keep = new Set(candidates.map((c) => c.metricKey));
  const stale = [...existing.entries()]
    .filter(([key, row]) => !keep.has(key) && row.status === "open")
    .map(([, row]) => row.id);
  if (stale.length) {
    await supabase.from("va_discrepancy_flags").delete().in("id", stale);
  }

  const out: PersistedFlag[] = [];
  for (const c of candidates) {
    const prior = existing.get(c.metricKey);
    // Don't overwrite a decision a human already made.
    if (prior && prior.status !== "open") {
      out.push({ ...c, id: prior.id, isNew: false });
      continue;
    }

    const payload = {
      va_id: vaId,
      work_date: workDate,
      submission_id: submissionId,
      metric_key: c.metricKey,
      metric_label: c.metricLabel,
      self_reported: c.selfReported,
      verified: c.verified,
      variance: c.variance,
      variance_pct: c.variancePct,
      severity: c.severity,
      repeat_count: c.repeatCount,
    };

    const { data, error } = await supabase
      .from("va_discrepancy_flags")
      .upsert(payload, { onConflict: "submission_id,metric_key" })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Write discrepancy flag failed: ${error.message}`);

    out.push({ ...c, id: String((data as { id?: string } | null)?.id || prior?.id || ""), isNew: !prior });
  }

  return out;
}

/** Evaluate + persist in one call, resolving thresholds and repeats first. */
export async function runDiscrepancyCheck(args: {
  submissionId: string;
  vaId: string;
  workDate: string;
  selfReported: Record<string, number>;
  verified: MetricValues;
}): Promise<PersistedFlag[]> {
  const thresholds = await getDiscrepancyThresholds();
  const repeatCounts = await repeatCountsFor(
    args.vaId,
    args.workDate,
    thresholds.repeat.windowDays,
  );
  const candidates = evaluateDiscrepancies({
    selfReported: args.selfReported,
    verified: args.verified,
    repeatCounts,
    thresholds,
  });
  return persistFlags(args.submissionId, args.vaId, args.workDate, candidates);
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const FLAG_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  explained: "Explained",
  confirmed_issue: "Confirmed issue",
  dismissed: "Dismissed",
};
