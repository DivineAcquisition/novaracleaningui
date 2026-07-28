// ─── The verification layer ───────────────────────────────────────────────────
//
// Runs every collector for a date, merges the results into one row per VA per
// day, and upserts it. The invariants this file exists to enforce:
//
//   1. Verified data always beats self-reported data. Nothing here reads a VA's
//      submission; the two are stored separately and compared, never merged.
//   2. A missing source is NULL, never 0. If a collector reports anything other
//      than `ok`, every metric it owns for that VA resolves to NULL and the
//      reason is recorded on the row.
//   3. Every metric carries its source and sync timestamp (metric_sources).
//   4. Idempotent. Upsert on (va_id, work_date) — re-running a day updates in
//      place and can never duplicate.
//   5. Apploye contributes hours and nothing else.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  METRICS,
  type MetricKey,
  type MetricProvenance,
  type MetricValues,
  type SourceReport,
  type SourceStatusMap,
} from "./metrics";
import { apployeCollector } from "./sources/apploye";
import { ghlCollector } from "./sources/ghl";
import { revenueOpsCollector } from "./sources/revenue-ops";
import { stripeCollector } from "./sources/stripe";
import { talentCollector } from "./sources/talent";
import { workspaceCollector } from "./sources/workspace";
import type { Collector, CollectContext } from "./sources/types";
import { getEodSettings, primePerformanceSecrets } from "./settings";
import { dayWindow } from "./time";
import { listTrackedVas, type VaRecord } from "./vas";

const COLLECTORS: Collector[] = [
  apployeCollector,
  ghlCollector,
  revenueOpsCollector,
  talentCollector,
  workspaceCollector,
  stripeCollector,
];

/** Columns on va_verified_metrics, one per metric key. */
const METRIC_COLUMN: Record<MetricKey, string> = {
  hours_tracked: "hours_tracked",
  calls_placed: "calls_placed",
  conversations_connected: "conversations_connected",
  sms_sent: "sms_sent",
  inbound_leads: "inbound_leads",
  leads_responded: "leads_responded",
  median_response_seconds: "median_response_seconds",
  leads_converted: "leads_converted",
  bookings_created: "bookings_created",
  revenue_booked_cents: "revenue_booked_cents",
  quotes_sent: "quotes_sent",
  commercial_accounts_touched: "commercial_accounts_touched",
  walkthroughs_booked: "walkthroughs_booked",
  revenue_collected_cents: "revenue_collected_cents",
  applications_reviewed: "applications_reviewed",
  phone_screens_completed: "phone_screens_completed",
  screens_advanced: "screens_advanced",
  screens_held: "screens_held",
  screens_declined: "screens_declined",
  onboarding_launched: "onboarding_launched",
  cleaners_activated: "cleaners_activated",
};

export interface VerifiedDay {
  vaId: string;
  workDate: string;
  values: MetricValues;
  sourceStatus: SourceStatusMap;
  provenance: MetricProvenance;
  lastSyncedAt: string;
}

export interface SyncReport {
  dates: string[];
  vasSynced: number;
  rowsWritten: number;
  sources: Record<string, { status: string; error?: string }>;
  warnings: string[];
}

/**
 * Collect one date for a set of VAs and return the merged rows without
 * writing. Used by the sync route and by the EOD form's live pre-fill.
 */
export async function collectDay(date: string, vas: VaRecord[]): Promise<{
  rows: VerifiedDay[];
  sources: Record<string, SourceReport>;
}> {
  await primePerformanceSecrets();
  const settings = await getEodSettings();
  const supabase = getAdminSupabase();
  const ctx: CollectContext = {
    date,
    timezone: settings.timezone,
    window: dayWindow(date, settings.timezone),
    vas,
    supabase,
  };

  const results = await Promise.all(
    COLLECTORS.map(async (collector) => {
      try {
        return { collector, result: await collector.collect(ctx) };
      } catch (err) {
        return {
          collector,
          result: {
            byVa: new Map<string, MetricValues>(),
            status: {
              status: "unavailable" as const,
              syncedAt: new Date().toISOString(),
              error: err instanceof Error ? err.message : String(err),
            },
          },
        };
      }
    }),
  );

  const sources: Record<string, SourceReport> = {};
  for (const { collector, result } of results) sources[collector.source] = result.status;

  const rows: VerifiedDay[] = vas.map((va) => {
    const values: MetricValues = {};
    const provenance: MetricProvenance = {};
    const sourceStatus: SourceStatusMap = {};

    for (const { collector, result } of results) {
      const perVa = result.vaStatus?.get(va.id);
      const effective = perVa ?? result.status.status;
      sourceStatus[collector.source] = {
        status: effective,
        syncedAt: result.status.syncedAt,
        ...(result.status.error ? { error: result.status.error } : {}),
      };

      const bucket = result.byVa.get(va.id) || {};
      for (const key of collector.metrics) {
        const metricStatus = result.metricStatus?.[key] ?? effective;
        const raw = bucket[key];
        const usable = metricStatus === "ok" && raw !== undefined && raw !== null;
        values[key] = usable ? (raw as number) : null;
        provenance[key] = {
          source: collector.source,
          syncedAt: result.status.syncedAt,
          status: metricStatus,
        };
      }
    }

    return {
      vaId: va.id,
      workDate: date,
      values,
      sourceStatus,
      provenance,
      lastSyncedAt: new Date().toISOString(),
    };
  });

  return { rows, sources };
}

/** Upsert merged rows. Idempotent on (va_id, work_date) — never duplicates. */
export async function writeVerifiedDays(rows: VerifiedDay[]): Promise<number> {
  if (!rows.length) return 0;
  const supabase = getAdminSupabase();

  const payload = rows.map((row) => {
    const record: Record<string, unknown> = {
      va_id: row.vaId,
      work_date: row.workDate,
      source_status: row.sourceStatus,
      metric_sources: row.provenance,
      last_synced_at: row.lastSyncedAt,
    };
    for (const [key, column] of Object.entries(METRIC_COLUMN)) {
      record[column] = row.values[key as MetricKey] ?? null;
    }
    return record;
  });

  const { error } = await supabase
    .from("va_verified_metrics")
    .upsert(payload, { onConflict: "va_id,work_date" });
  if (error) throw new Error(`Write verified metrics failed: ${error.message}`);
  return payload.length;
}

/** Collect + write one or more dates. This is what the cron calls. */
export async function syncVerifiedMetrics(dates: string[], vaIds?: string[]): Promise<SyncReport> {
  const allVas = await listTrackedVas();
  const vas = vaIds?.length ? allVas.filter((v) => vaIds.includes(v.id)) : allVas;

  const report: SyncReport = {
    dates,
    vasSynced: vas.length,
    rowsWritten: 0,
    sources: {},
    warnings: [],
  };

  if (!vas.length) {
    report.warnings.push("No approved VAs to sync.");
    return report;
  }

  for (const date of dates) {
    const { rows, sources } = await collectDay(date, vas);
    report.rowsWritten += await writeVerifiedDays(rows);
    for (const [source, status] of Object.entries(sources)) {
      report.sources[source] = { status: status.status, ...(status.error ? { error: status.error } : {}) };
      if (status.status !== "ok") {
        report.warnings.push(
          `${source}: ${status.status}${status.error ? ` — ${status.error}` : ""} (affected metrics stay unverified for ${date}).`,
        );
      }
    }
  }

  return report;
}

// ─── Reading back ─────────────────────────────────────────────────────────────

export interface StoredVerifiedDay {
  vaId: string;
  workDate: string;
  values: MetricValues;
  sourceStatus: SourceStatusMap;
  provenance: MetricProvenance;
  lastSyncedAt: string | null;
}

export function mapVerifiedRow(row: Record<string, unknown>): StoredVerifiedDay {
  const values: MetricValues = {};
  for (const [key, column] of Object.entries(METRIC_COLUMN)) {
    const raw = row[column];
    values[key as MetricKey] = raw === null || raw === undefined ? null : Number(raw);
  }
  return {
    vaId: String(row.va_id),
    workDate: String(row.work_date),
    values,
    sourceStatus: (row.source_status as SourceStatusMap) || {},
    provenance: (row.metric_sources as MetricProvenance) || {},
    lastSyncedAt: (row.last_synced_at as string) || null,
  };
}

/** An empty, fully-unverified day — what a VA sees before the first sync lands. */
export function emptyVerifiedDay(vaId: string, workDate: string): StoredVerifiedDay {
  const values: MetricValues = {};
  const provenance: MetricProvenance = {};
  for (const key of Object.keys(METRIC_COLUMN) as MetricKey[]) {
    values[key] = null;
    provenance[key] = {
      source: METRICS[key].source,
      syncedAt: new Date().toISOString(),
      status: "unavailable",
    };
  }
  return { vaId, workDate, values, provenance, sourceStatus: {}, lastSyncedAt: null };
}

export async function readVerifiedDay(
  vaId: string,
  workDate: string,
): Promise<StoredVerifiedDay | null> {
  const supabase = getAdminSupabase();
  const { data } = await supabase
    .from("va_verified_metrics")
    .select("*")
    .eq("va_id", vaId)
    .eq("work_date", workDate)
    .maybeSingle();
  return data ? mapVerifiedRow(data as Record<string, unknown>) : null;
}

export async function readVerifiedRange(
  vaIds: string[],
  startDate: string,
  endDate: string,
): Promise<StoredVerifiedDay[]> {
  if (!vaIds.length) return [];
  const supabase = getAdminSupabase();
  const { data, error } = await supabase
    .from("va_verified_metrics")
    .select("*")
    .in("va_id", vaIds)
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date", { ascending: true });
  if (error) throw new Error(`Read verified metrics failed: ${error.message}`);
  return (data || []).map((r) => mapVerifiedRow(r as Record<string, unknown>));
}
