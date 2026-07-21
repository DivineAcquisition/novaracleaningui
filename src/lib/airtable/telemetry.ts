// ─── Airtable sync telemetry ──────────────────────────────────────────────────
//
// Every sync pass — live, reconcile, manual, inbound — reports here so the
// admin Sync Health view (/admin/sync) always answers: when did each flow last
// succeed, what's failing, and which records need a human decision.
//
//   • logSyncRun     → airtable_sync_runs + per-flow state (consecutive
//     failures, last success). Crossing the failure threshold emits an
//     'airtable.sync.failing' event on the existing events bus, which the
//     Discord routing trigger already delivers — silent breakage is the
//     failure mode this eliminates. Recovery emits 'airtable.sync.recovered'.
//   • flagForReview  → airtable_review_flags. The sync NEVER guesses: unknown
//     select options, unmapped fields, both-sides conflicts, identity
//     ambiguities and remote deletions land here for admin review instead of
//     being silently written or dropped.
//   • remote-change marker → lets Airtable-reading views (partner admin) know
//     the base changed so they refresh instead of serving a stale snapshot.
//
// Everything is best-effort: telemetry must never take a sync down.

import { getAdminSupabase } from "./sources/admin-client";
import { setUnknownOptionReporter } from "./client";

export type SyncDirection = "outbound" | "inbound";
export type SyncTrigger = "live" | "reconcile" | "manual" | "external" | "webhook" | "poll";
export type SyncStatus = "success" | "error" | "skipped";

const FAILURE_ALERT_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Queue flows that report under a shared health flow. */
const STATE_FLOW_ALIAS: Record<string, string> = {
  qc_issues_all: "qc_issue",
};

export function toStateFlow(flow: string): string {
  return STATE_FLOW_ALIAS[flow] || flow;
}

const warn = (msg: string, err?: unknown) =>
  // eslint-disable-next-line no-console
  console.warn(`[airtable-telemetry] ${msg}${err ? ` — ${(err as Error).message}` : ""}`);

export interface SyncRunLog {
  flow: string;
  direction?: SyncDirection;
  trigger?: SyncTrigger;
  status: SyncStatus;
  records?: number;
  error?: string;
  detail?: Record<string, unknown>;
  /** Date.now() captured when the pass started. */
  startedAt: number;
}

/** Record one sync pass and roll the per-flow health state forward. */
export async function logSyncRun(run: SyncRunLog): Promise<void> {
  const finished = Date.now();
  const flow = toStateFlow(run.flow);
  try {
    const supabase = getAdminSupabase();

    await supabase.from("airtable_sync_runs").insert({
      flow,
      direction: run.direction || "outbound",
      trigger_source: run.trigger || "live",
      status: run.status,
      records_synced: run.records ?? null,
      error: run.error ? run.error.slice(0, 2000) : null,
      detail: run.detail ?? null,
      started_at: new Date(run.startedAt).toISOString(),
      finished_at: new Date(finished).toISOString(),
      duration_ms: Math.max(0, finished - run.startedAt),
    });

    // Skipped passes (e.g. source row vanished) don't move health either way.
    if (run.status === "skipped") return;

    const { data: state } = await supabase
      .from("airtable_sync_flow_state")
      .select("flow, display_name, consecutive_failures, alerted_at")
      .eq("flow", flow)
      .maybeSingle();

    const prevFailures = Number(state?.consecutive_failures || 0);
    const displayName = String(state?.display_name || flow);
    const nowIso = new Date(finished).toISOString();

    if (run.status === "success") {
      await supabase
        .from("airtable_sync_flow_state")
        .upsert(
          {
            flow,
            display_name: displayName,
            direction: run.direction || "outbound",
            last_success_at: nowIso,
            consecutive_failures: 0,
            updated_at: nowIso,
          },
          { onConflict: "flow" },
        );
      if (prevFailures >= FAILURE_ALERT_THRESHOLD) {
        await emitSyncEvent(
          "airtable.sync.recovered",
          `Airtable sync flow "${displayName}" recovered after ${prevFailures} consecutive failures.`,
          { flow },
        );
      }
      return;
    }

    // Failure path.
    const failures = prevFailures + 1;
    const alertedAt = state?.alerted_at ? new Date(String(state.alerted_at)).getTime() : 0;
    const shouldAlert =
      failures >= FAILURE_ALERT_THRESHOLD && finished - alertedAt > ALERT_COOLDOWN_MS;

    await supabase
      .from("airtable_sync_flow_state")
      .upsert(
        {
          flow,
          display_name: displayName,
          direction: run.direction || "outbound",
          last_error_at: nowIso,
          last_error: (run.error || "unknown error").slice(0, 2000),
          consecutive_failures: failures,
          ...(shouldAlert ? { alerted_at: nowIso } : {}),
          updated_at: nowIso,
        },
        { onConflict: "flow" },
      );

    if (shouldAlert) {
      await emitSyncEvent(
        "airtable.sync.failing",
        `Airtable sync flow "${displayName}" has failed ${failures} times in a row: ${(run.error || "unknown error").slice(0, 300)}. Review at /admin/sync.`,
        { flow, consecutiveFailures: failures },
      );
    }
  } catch (err) {
    warn("logSyncRun failed", err);
  }
}

/** Emit onto the existing events bus (Discord routing trigger delivers it). */
async function emitSyncEvent(
  eventType: string,
  summary: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    await supabase.from("events").insert({
      event_type: eventType,
      source: "airtable-sync",
      summary: summary.slice(0, 1800),
      data,
    });
  } catch (err) {
    warn("emitSyncEvent failed", err);
  }
}

// ─── Review flags ─────────────────────────────────────────────────────────────

export type ReviewReason =
  | "unmapped_field"
  | "conflict"
  | "identity"
  | "unknown_option"
  | "deletion"
  | "error";

export interface ReviewFlagInput {
  flow: string;
  reason: ReviewReason;
  message: string;
  recordRef?: string;
  airtableTable?: string;
  fieldRef?: string;
  detail?: Record<string, unknown>;
}

/**
 * Surface a record/field for admin review. Deduped — a recurring condition
 * bumps the existing flag (and re-opens it if it was resolved but recurred).
 */
export async function flagForReview(input: ReviewFlagInput): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    const dedupeKey = [
      input.flow,
      input.reason,
      input.airtableTable || "",
      input.recordRef || "",
      input.fieldRef || "",
    ].join("|");

    const { data: existing } = await supabase
      .from("airtable_review_flags")
      .select("id, seen_count")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    if (existing?.id) {
      await supabase
        .from("airtable_review_flags")
        .update({
          message: input.message.slice(0, 1000),
          detail: input.detail ?? null,
          seen_count: Number(existing.seen_count || 0) + 1,
          last_seen_at: nowIso,
          status: "open",
          resolved_by: null,
          resolved_at: null,
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("airtable_review_flags").insert({
        flow: toStateFlow(input.flow),
        reason: input.reason,
        record_ref: input.recordRef || null,
        airtable_table: input.airtableTable || null,
        field_ref: input.fieldRef || null,
        message: input.message.slice(0, 1000),
        detail: input.detail ?? null,
        dedupe_key: dedupeKey,
      });
    }
  } catch (err) {
    warn("flagForReview failed", err);
  }
}

// ─── Remote-change marker (Airtable → workspace freshness) ───────────────────

/** Note that Airtable-side content changed (webhook payload / poll detection). */
export async function bumpRemoteChangeMarker(): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    await supabase
      .from("airtable_sync_flow_state")
      .update({ last_remote_change_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("flow", "inbound");
  } catch (err) {
    warn("bumpRemoteChangeMarker failed", err);
  }
}

/** Stamp when the inbound check last ran (poll cutoff bookkeeping). */
export async function stampInboundChecked(): Promise<void> {
  try {
    const supabase = getAdminSupabase();
    await supabase
      .from("airtable_sync_flow_state")
      .update({ last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("flow", "inbound");
  } catch (err) {
    warn("stampInboundChecked failed", err);
  }
}

export async function getInboundState(): Promise<{
  lastCheckedAt: number | null;
  lastRemoteChangeAt: number | null;
}> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("airtable_sync_flow_state")
      .select("last_checked_at, last_remote_change_at")
      .eq("flow", "inbound")
      .maybeSingle();
    return {
      lastCheckedAt: data?.last_checked_at ? new Date(String(data.last_checked_at)).getTime() : null,
      lastRemoteChangeAt: data?.last_remote_change_at
        ? new Date(String(data.last_remote_change_at)).getTime()
        : null,
    };
  } catch {
    return { lastCheckedAt: null, lastRemoteChangeAt: null };
  }
}

/**
 * Millisecond timestamp of the last KNOWN Airtable-side change, or null.
 * Airtable-reading snapshots compare against this to self-invalidate.
 */
export async function getRemoteChangeMarkerMs(): Promise<number | null> {
  const { lastRemoteChangeAt } = await getInboundState();
  return lastRemoteChangeAt;
}

// ─── Review hooks into the low-level Airtable client ──────────────────────────

let hooksInstalled = false;

/**
 * Wire the Airtable client's "select value outside the known vocabulary"
 * detection into the review queue. Idempotent — call from any sync entry point.
 */
export function installAirtableReviewHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  setUnknownOptionReporter(({ tableId, fieldId, value }) => {
    void flagForReview({
      flow: "outbound",
      reason: "unknown_option",
      airtableTable: tableId,
      fieldRef: fieldId,
      recordRef: value,
      message: `Wrote select value "${value}" that is outside the known vocabulary for field ${fieldId} (typecast created it in Airtable). Confirm the new option or fix the source value.`,
    });
  });
}
