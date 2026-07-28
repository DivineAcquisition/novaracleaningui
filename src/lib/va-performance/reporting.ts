// ─── Rollups for the VA Performance tab ───────────────────────────────────────
//
// Everything the admin surface reads: today's compliance, per-VA verified vs
// self-reported, target attainment, revenue per VA hour, and the Performance
// Period record that turns a window into a documented review.
//
// Two rules carried through from the collectors:
//   * NULL stays NULL. An unverified day is excluded from a rollup rather than
//     summed as zero, and the count of days that actually contributed is
//     reported alongside the total so nobody reads a partial week as a full one.
//   * Qualitative fields are never scored. Blockers, wins and notes appear in
//     the review UI as context and never feed a rating.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { metricFieldByKey } from "./catalog";
import { mapSubmission, type EodSubmission } from "./eod";
import { METRIC_KEYS, type MetricKey, type MetricValues } from "./metrics";
import { addDays, cutoffMinutes, getEodSettings, localDate, type EodSettings } from "./settings";
import { readVerifiedRange, type StoredVerifiedDay } from "./verify";
import { listAllVas, listTrackedVas, type VaRecord } from "./vas";

// ─── Targets ──────────────────────────────────────────────────────────────────

export interface KpiTarget {
  id: string;
  function: string;
  metricKey: string;
  label: string;
  targetValue: number;
  comparator: "gte" | "lte";
  unit: string | null;
  period: "daily" | "weekly" | "monthly";
  vaId: string | null;
  active: boolean;
  effectiveDate: string;
}

export function mapTarget(row: Record<string, unknown>): KpiTarget {
  return {
    id: String(row.id),
    function: String(row.function || "all"),
    metricKey: String(row.metric_key),
    label: String(row.label || row.metric_key),
    targetValue: Number(row.target_value),
    comparator: (String(row.comparator || "gte") as "gte" | "lte"),
    unit: (row.unit as string) ?? null,
    period: String(row.period || "daily") as KpiTarget["period"],
    vaId: (row.va_id as string) ?? null,
    active: row.active !== false,
    effectiveDate: String(row.effective_date),
  };
}

export async function listTargets(): Promise<KpiTarget[]> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_kpi_targets")
    .select("*")
    .order("function", { ascending: true })
    .order("metric_key", { ascending: true });
  if (error) throw new Error(`Read KPI targets failed: ${error.message}`);
  return (data || []).map((r) => mapTarget(r as Record<string, unknown>));
}

/** Targets that apply to this VA: their own overrides win over role-wide ones. */
export function targetsForVa(all: KpiTarget[], va: VaRecord, period: KpiTarget["period"]): KpiTarget[] {
  const functions = new Set(
    [...va.functionsAssigned, va.vaRole || ""].map((f) => f.toLowerCase()).filter(Boolean),
  );
  const applicable = all.filter((t) => {
    if (!t.active || t.period !== period) return false;
    if (t.vaId) return t.vaId === va.id;
    return t.function === "all" || functions.has(t.function);
  });

  const byMetric = new Map<string, KpiTarget>();
  for (const t of applicable) {
    const current = byMetric.get(t.metricKey);
    if (!current) {
      byMetric.set(t.metricKey, t);
      continue;
    }
    // Prefer a VA-specific target, then the most recently effective one.
    const better =
      (t.vaId ? 1 : 0) - (current.vaId ? 1 : 0) ||
      t.effectiveDate.localeCompare(current.effectiveDate);
    if (better > 0) byMetric.set(t.metricKey, t);
  }
  return [...byMetric.values()];
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface MetricRollup {
  total: number | null;
  /** Days that contributed a verified value. */
  verifiedDays: number;
  /** Days in the window with no verified value for this metric. */
  unverifiedDays: number;
  average: number | null;
}

export type Rollups = Partial<Record<MetricKey, MetricRollup>>;

/** Metrics that describe a rate/latency and should be averaged, not summed. */
const AVERAGED: MetricKey[] = ["median_response_seconds"];

export function rollUp(days: StoredVerifiedDay[]): Rollups {
  const out: Rollups = {};
  for (const key of METRIC_KEYS) {
    let total = 0;
    let verifiedDays = 0;
    let unverifiedDays = 0;
    for (const day of days) {
      const value = day.values[key];
      if (value === null || value === undefined) {
        unverifiedDays += 1;
        continue;
      }
      total += value;
      verifiedDays += 1;
    }
    const average = verifiedDays ? Math.round((total / verifiedDays) * 100) / 100 : null;
    out[key] = {
      total: verifiedDays ? (AVERAGED.includes(key) ? average : Math.round(total * 100) / 100) : null,
      verifiedDays,
      unverifiedDays,
      average,
    };
  }
  return out;
}

export interface TargetAttainment {
  metricKey: string;
  label: string;
  comparator: "gte" | "lte";
  target: number;
  actual: number | null;
  attainmentPct: number | null;
  met: boolean | null;
  unit: string | null;
}

/**
 * Attainment against daily targets, scaled to the window. Attainment is null
 * (not 0%) when the metric is unverified for the whole window — we don't score
 * what we couldn't see.
 */
export function attainment(
  targets: KpiTarget[],
  rollups: Rollups,
  daysInWindow: number,
  compliance: ComplianceSummary,
): TargetAttainment[] {
  return targets.map((t) => {
    if (t.metricKey === "eod_submitted_by") {
      const actual = compliance.expectedDays ? compliance.onTimeDays : null;
      const target = compliance.expectedDays;
      const pct = target ? Math.round(((actual ?? 0) / target) * 1000) / 10 : null;
      return {
        metricKey: t.metricKey,
        label: t.label,
        comparator: "gte" as const,
        target,
        actual,
        attainmentPct: pct,
        met: pct === null ? null : pct >= 100,
        unit: "on-time days",
      };
    }

    const rollup = rollups[t.metricKey as MetricKey];
    const isAveraged = AVERAGED.includes(t.metricKey as MetricKey);
    const actual = isAveraged ? (rollup?.average ?? null) : (rollup?.total ?? null);
    const scaledTarget =
      t.period === "daily" && !isAveraged ? t.targetValue * Math.max(1, daysInWindow) : t.targetValue;

    if (actual === null || rollup?.verifiedDays === 0) {
      return {
        metricKey: t.metricKey,
        label: t.label,
        comparator: t.comparator,
        target: scaledTarget,
        actual: null,
        attainmentPct: null,
        met: null,
        unit: t.unit,
      };
    }

    const pct =
      t.comparator === "gte"
        ? scaledTarget === 0
          ? 100
          : Math.round((actual / scaledTarget) * 1000) / 10
        : actual === 0
          ? 100
          : Math.round((scaledTarget / actual) * 1000) / 10;

    return {
      metricKey: t.metricKey,
      label: t.label,
      comparator: t.comparator,
      target: scaledTarget,
      actual,
      attainmentPct: pct,
      met: t.comparator === "gte" ? actual >= scaledTarget : actual <= scaledTarget,
      unit: t.unit,
    };
  });
}

// ─── EOD compliance ───────────────────────────────────────────────────────────

export interface ComplianceSummary {
  expectedDays: number;
  submittedDays: number;
  onTimeDays: number;
  lateDays: number;
  missedDates: string[];
  compliancePct: number | null;
}

/**
 * Expected days are weekdays inside the window that the VA had already started
 * by. Weekends are excluded — nobody is marked non-compliant for a day they
 * weren't expected to work.
 */
export function complianceFor(
  va: VaRecord,
  submissions: EodSubmission[],
  startDate: string,
  endDate: string,
  today: string,
): ComplianceSummary {
  const byDate = new Map(submissions.map((s) => [s.workDate, s]));
  const expected: string[] = [];

  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && cursor <= today && guard++ < 400) {
    const dow = new Date(`${cursor}T12:00:00.000Z`).getUTCDay();
    const beforeStart = va.startDate ? cursor < va.startDate : false;
    if (dow !== 0 && dow !== 6 && !beforeStart) expected.push(cursor);
    cursor = addDays(cursor, 1);
  }

  let submitted = 0;
  let onTime = 0;
  let late = 0;
  const missed: string[] = [];

  for (const date of expected) {
    const s = byDate.get(date);
    if (!s || s.status === "draft" || !s.submittedAt) {
      missed.push(date);
      continue;
    }
    submitted += 1;
    if (s.submittedLate) late += 1;
    else onTime += 1;
  }

  return {
    expectedDays: expected.length,
    submittedDays: submitted,
    onTimeDays: onTime,
    lateDays: late,
    missedDates: missed,
    compliancePct: expected.length ? Math.round((submitted / expected.length) * 1000) / 10 : null,
  };
}

// ─── Revenue per VA hour ──────────────────────────────────────────────────────
//
// The single number that answers whether the VA is paying for themselves.
// Null when hours are unverified for the whole window — dividing by an assumed
// zero would produce a number that looks precise and means nothing.

export interface RevenuePerHour {
  revenueAttributedCents: number | null;
  hours: number | null;
  perHourCents: number | null;
  /** True when some days in the window had no verified hours. */
  partial: boolean;
}

export function revenuePerHour(rollups: Rollups): RevenuePerHour {
  const hoursRollup = rollups.hours_tracked;
  const bookedRollup = rollups.revenue_booked_cents;
  const collectedRollup = rollups.revenue_collected_cents;

  // Prefer collected revenue when we have it — money in the bank beats money
  // on a calendar. Fall back to booked so the number exists before payments
  // settle, and label it in the UI.
  const revenue =
    collectedRollup && collectedRollup.verifiedDays > 0 && (collectedRollup.total ?? 0) > 0
      ? collectedRollup.total
      : (bookedRollup?.total ?? null);

  const hours = hoursRollup?.total ?? null;
  const perHourCents =
    revenue !== null && hours !== null && hours > 0 ? Math.round(revenue / hours) : null;

  return {
    revenueAttributedCents: revenue,
    hours,
    perHourCents,
    partial: (hoursRollup?.unverifiedDays ?? 0) > 0,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function readSubmissions(
  vaIds: string[],
  startDate: string,
  endDate: string,
): Promise<EodSubmission[]> {
  if (!vaIds.length) return [];
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_eod_submissions")
    .select("*")
    .in("va_id", vaIds)
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date", { ascending: false });
  if (error) throw new Error(`Read EOD submissions failed: ${error.message}`);
  return (data || []).map((r) => mapSubmission(r as Record<string, unknown>));
}

export interface TodayRow {
  va: VaRecord;
  submission: EodSubmission | null;
  verified: StoredVerifiedDay | null;
  openFlags: number;
  status: "submitted_on_time" | "submitted_late" | "draft" | "missing";
}

export interface TodayView {
  workDate: string;
  cutoffLocalTime: string;
  pastCutoff: boolean;
  rows: TodayRow[];
  openFlagTotal: number;
}

export async function todayView(date?: string): Promise<TodayView> {
  const settings = await getEodSettings();
  const now = new Date();
  const workDate = date || localDate(now, settings.timezone);
  const vas = await listTrackedVas();
  const vaIds = vas.map((v) => v.id);

  const [submissions, verified, flagRows] = await Promise.all([
    readSubmissions(vaIds, workDate, workDate),
    readVerifiedRange(vaIds, workDate, workDate),
    openFlagCounts(vaIds),
  ]);

  const subByVa = new Map(submissions.map((s) => [s.vaId, s]));
  const verByVa = new Map(verified.map((v) => [v.vaId, v]));

  const rows: TodayRow[] = vas.map((va) => {
    const submission = subByVa.get(va.id) ?? null;
    let status: TodayRow["status"] = "missing";
    if (submission && submission.status !== "draft" && submission.submittedAt) {
      status = submission.submittedLate ? "submitted_late" : "submitted_on_time";
    } else if (submission && (Object.keys(submission.metrics).length || submission.selects.primary_focus)) {
      status = "draft";
    }
    return {
      va,
      submission,
      verified: verByVa.get(va.id) ?? null,
      openFlags: flagRows.get(va.id) ?? 0,
      status,
    };
  });

  return {
    workDate,
    cutoffLocalTime: settings.cutoffLocalTime,
    pastCutoff: pastCutoff(settings, now),
    rows,
    openFlagTotal: [...flagRows.values()].reduce((a, b) => a + b, 0),
  };
}

function pastCutoff(settings: EodSettings, now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute > cutoffMinutes(settings);
}

export async function openFlagCounts(vaIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!vaIds.length) return out;
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_discrepancy_flags")
    .select("va_id, status")
    .in("va_id", vaIds)
    .in("status", ["open", "explained"]);
  for (const row of ((data || []) as Record<string, unknown>[])) {
    const id = String(row.va_id);
    out.set(id, (out.get(id) || 0) + 1);
  }
  return out;
}

// ─── Performance periods ──────────────────────────────────────────────────────

export interface PeriodResult {
  id: string;
  vaId: string;
  periodType: "weekly" | "monthly";
  startDate: string;
  endDate: string;
  totalHours: number | null;
  rollups: Rollups;
  targetDetail: TargetAttainment[];
  targetAttainmentPct: number | null;
  revenueAttributedCents: number | null;
  revenuePerHourCents: number | null;
  compliance: ComplianceSummary;
  discrepancyCount: number;
  status: string;
  overallRating: string | null;
  reviewNotes: string | null;
}

export function weekBounds(date: string): { start: string; end: string } {
  const d = new Date(`${date}T12:00:00.000Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const offsetToMonday = dow === 0 ? -6 : 1 - dow;
  const start = addDays(date, offsetToMonday);
  return { start, end: addDays(start, 6) };
}

export function monthBounds(date: string): { start: string; end: string } {
  const start = `${date.slice(0, 7)}-01`;
  const d = new Date(`${start}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const end = addDays(d.toISOString().slice(0, 10), -1);
  return { start, end };
}

/**
 * Build (or refresh) a Performance Period. Upserts on (va, type, start) so
 * regenerating a window updates it in place — a review conversation can be
 * re-run without creating a second record.
 */
export async function generatePeriod(
  vaId: string,
  periodType: "weekly" | "monthly",
  anchorDate: string,
): Promise<PeriodResult> {
  const settings = await getEodSettings();
  const today = localDate(new Date(), settings.timezone);
  const { start, end } = periodType === "weekly" ? weekBounds(anchorDate) : monthBounds(anchorDate);

  const vas = await listAllVas();
  const va = vas.find((v) => v.id === vaId);
  if (!va) throw new Error("VA not found.");

  const [verified, submissions, targets] = await Promise.all([
    readVerifiedRange([vaId], start, end),
    readSubmissions([vaId], start, end),
    listTargets(),
  ]);

  const rollups = rollUp(verified);
  const compliance = complianceFor(va, submissions, start, end, today);
  const daysWithData = verified.length || 1;
  const detail = attainment(targetsForVa(targets, va, "daily"), rollups, daysWithData, compliance);
  const scored = detail.filter((d) => d.attainmentPct !== null);
  const targetAttainmentPct = scored.length
    ? Math.round((scored.reduce((a, d) => a + Math.min(150, d.attainmentPct ?? 0), 0) / scored.length) * 10) / 10
    : null;

  const rev = revenuePerHour(rollups);

  const supabase = getAdminSupabase();
  const { count } = await supabase
    .from("va_discrepancy_flags")
    .select("id", { count: "exact", head: true })
    .eq("va_id", vaId)
    .gte("work_date", start)
    .lte("work_date", end)
    .neq("status", "dismissed");

  const payload = {
    va_id: vaId,
    period_type: periodType,
    start_date: start,
    end_date: end,
    total_hours: rollups.hours_tracked?.total ?? null,
    rollups: Object.fromEntries(
      Object.entries(rollups).map(([k, v]) => [k, v?.total ?? null]),
    ),
    target_detail: Object.fromEntries(detail.map((d) => [d.metricKey, d])),
    target_attainment_pct: targetAttainmentPct,
    revenue_attributed_cents: rev.revenueAttributedCents,
    revenue_per_hour_cents: rev.perHourCents,
    eod_expected_days: compliance.expectedDays,
    eod_submitted_days: compliance.submittedDays,
    eod_late_days: compliance.lateDays,
    eod_compliance_pct: compliance.compliancePct,
    discrepancy_count: count ?? 0,
  };

  const { data, error } = await supabase
    .from("va_performance_periods")
    .upsert(payload, { onConflict: "va_id,period_type,start_date" })
    .select("*")
    .single();
  if (error) throw new Error(`Write performance period failed: ${error.message}`);

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    vaId,
    periodType,
    startDate: start,
    endDate: end,
    totalHours: rollups.hours_tracked?.total ?? null,
    rollups,
    targetDetail: detail,
    targetAttainmentPct,
    revenueAttributedCents: rev.revenueAttributedCents,
    revenuePerHourCents: rev.perHourCents,
    compliance,
    discrepancyCount: count ?? 0,
    status: String(row.status || "draft"),
    overallRating: (row.overall_rating as string) ?? null,
    reviewNotes: (row.review_notes as string) ?? null,
  };
}

// ─── Per-VA detail ────────────────────────────────────────────────────────────

export interface SelfReportedVsVerified {
  workDate: string;
  metricKey: string;
  label: string;
  selfReported: number;
  verified: number | null;
  comparedTo: string;
}

export interface VaDetail {
  va: VaRecord;
  startDate: string;
  endDate: string;
  days: StoredVerifiedDay[];
  submissions: EodSubmission[];
  rollups: Rollups;
  targets: TargetAttainment[];
  compliance: ComplianceSummary;
  revenue: RevenuePerHour;
  flags: Record<string, unknown>[];
  coaching: Record<string, unknown>[];
  periods: Record<string, unknown>[];
  comparison: SelfReportedVsVerified[];
}

export async function vaDetail(vaId: string, startDate: string, endDate: string): Promise<VaDetail> {
  const settings = await getEodSettings();
  const today = localDate(new Date(), settings.timezone);
  const vas = await listAllVas();
  const va = vas.find((v) => v.id === vaId);
  if (!va) throw new Error("VA not found.");

  const supabase = getAdminSupabase();
  const [days, submissions, targets, flags, coaching, periods] = await Promise.all([
    readVerifiedRange([vaId], startDate, endDate),
    readSubmissions([vaId], startDate, endDate),
    listTargets(),
    supabase
      .from("va_discrepancy_flags")
      .select("*")
      .eq("va_id", vaId)
      .order("work_date", { ascending: false })
      .limit(100),
    supabase
      .from("va_coaching_log")
      .select("*")
      .eq("va_id", vaId)
      .order("entry_date", { ascending: false })
      .limit(50),
    supabase
      .from("va_performance_periods")
      .select("*")
      .eq("va_id", vaId)
      .order("start_date", { ascending: false })
      .limit(24),
  ]);

  const rollups = rollUp(days);
  const compliance = complianceFor(va, submissions, startDate, endDate, today);
  const detail = attainment(
    targetsForVa(targets, va, "daily"),
    rollups,
    days.length || 1,
    compliance,
  );

  const verifiedByDate = new Map(days.map((d) => [d.workDate, d.values as MetricValues]));
  const comparison = buildComparison(submissions, verifiedByDate);

  return {
    va,
    startDate,
    endDate,
    days,
    submissions,
    rollups,
    targets: detail,
    compliance,
    revenue: revenuePerHour(rollups),
    flags: (flags.data || []) as Record<string, unknown>[],
    coaching: (coaching.data || []) as Record<string, unknown>[],
    periods: (periods.data || []) as Record<string, unknown>[],
    comparison,
  };
}

/** Side-by-side of what the VA reported against what the signal showed. */
function buildComparison(
  submissions: EodSubmission[],
  verifiedByDate: Map<string, MetricValues>,
): SelfReportedVsVerified[] {
  const out: SelfReportedVsVerified[] = [];
  for (const s of submissions) {
    if (s.status === "draft") continue;
    const verified = verifiedByDate.get(s.workDate) || {};
    for (const [key, value] of Object.entries(s.metrics || {})) {
      const field = metricFieldByKey(key);
      if (!field?.corroborate) continue;
      let signal: number | null = null;
      for (const metric of field.corroborate.metrics) {
        const v = verified[metric];
        if (v === null || v === undefined) continue;
        signal = (signal ?? 0) + v;
      }
      out.push({
        workDate: s.workDate,
        metricKey: key,
        label: field.label,
        selfReported: Number(value),
        verified: signal,
        comparedTo: field.corroborate.describe,
      });
    }
  }
  return out;
}
