// ─── Collector contract ───────────────────────────────────────────────────────
//
// Every verification source implements this. The contract exists to make one
// rule impossible to break: a source that could not be reached reports
// `unavailable` and its metrics resolve to NULL. Only a source that WAS reached
// may report 0.
//
// Each collector declares up front which metrics it owns (`metrics`). The
// orchestrator uses that list to null out the whole set on failure, so a
// partial outage can never leave a stale value looking fresh.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MetricKey, MetricValues, SourceReport, SourceStatus } from "../metrics";
import type { VaRecord } from "../vas";
import type { DayWindow } from "../time";

export interface CollectContext {
  date: string;
  timezone: string;
  window: DayWindow;
  vas: VaRecord[];
  supabase: SupabaseClient;
}

export interface CollectorResult {
  /** Metric values keyed by VA id. Absent VA = source reached, nothing found. */
  byVa: Map<string, MetricValues>;
  /** Whole-source reachability. */
  status: SourceReport;
  /**
   * Per-VA override, for VAs this source cannot attribute (no linked user id).
   * Their metrics resolve to NULL even when the source itself is healthy.
   */
  vaStatus?: Map<string, SourceStatus>;
  /**
   * Per-metric override, for a source that is partially available (e.g. GHL
   * calls are mirrored locally but SMS needs an API key that isn't set).
   */
  metricStatus?: Partial<Record<MetricKey, SourceStatus>>;
}

export interface Collector {
  source: import("../metrics").MetricSource;
  /** Every metric this collector is responsible for. */
  metrics: MetricKey[];
  collect(ctx: CollectContext): Promise<CollectorResult>;
}

export function ok(syncedAt = new Date().toISOString()): SourceReport {
  return { status: "ok", syncedAt };
}

export function unavailable(error: unknown): SourceReport {
  return {
    status: "unavailable",
    syncedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
}

export function notConfigured(reason: string): SourceReport {
  return { status: "not_configured", syncedAt: new Date().toISOString(), error: reason };
}

/** Accumulate a value onto a VA's metric bucket. */
export function bump(
  byVa: Map<string, MetricValues>,
  vaId: string,
  key: MetricKey,
  amount: number,
): void {
  const bucket = byVa.get(vaId) || {};
  bucket[key] = (bucket[key] ?? 0) + amount;
  byVa.set(vaId, bucket);
}

export function setValue(
  byVa: Map<string, MetricValues>,
  vaId: string,
  key: MetricKey,
  value: number | null,
): void {
  const bucket = byVa.get(vaId) || {};
  bucket[key] = value;
  byVa.set(vaId, bucket);
}
