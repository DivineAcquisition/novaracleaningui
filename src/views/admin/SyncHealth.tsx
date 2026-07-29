"use client";

// ─── Admin · Sync Health (/admin/sync) ───────────────────────────────────
//
// One screen that answers "is the Airtable sync alive?" for every flow:
//   • per-flow cards: last successful sync, pending changes in the queue,
//     consecutive failures, last error;
//   • the inbound (Airtable → workspace) channel: webhook registered or
//     poll fallback, expiry, last remote change seen;
//   • Needs Review: unmapped fields, both-sides conflicts, identity-key
//     issues, remote deletions, dead queue items — the sync never guesses,
//     it flags, and admins resolve here;
//   • recent errors, plus actions: full re-sync, re-sync one flow, revive
//     dead items, pull remote changes now, reconnect the webhook.
//
// Auto-refreshes every 30s (visible tab only).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RiAlarmWarningLine,
  RiArrowLeftRightLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiFlagLine,
  RiLoader4Line,
  RiPlugLine,
  RiRefreshLine,
  RiTimeLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import GhlTagHygiene from "@/components/admin/GhlTagHygiene";

// ─── API types (mirrors /api/admin/airtable-health) ──────────────────────

interface FlowState {
  flow: string;
  display_name: string;
  direction: "outbound" | "inbound";
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  last_remote_change_at?: string | null;
}

interface QueueBucket {
  pending: number;
  processing: number;
  dead: number;
  done24h: number;
  oldestPending: string | null;
}

interface RunRow {
  id: number;
  flow: string;
  direction: string;
  trigger_source: string;
  status: "success" | "error" | "skipped";
  records_synced: number | null;
  error: string | null;
  started_at: string;
  duration_ms: number | null;
}

interface FlagRow {
  id: string;
  flow: string;
  reason: string;
  record_ref: string | null;
  airtable_table: string | null;
  field_ref: string | null;
  message: string;
  seen_count: number;
  last_seen_at: string;
}

interface InboundInfo {
  mode: "webhook" | "poll";
  webhookId: string | null;
  expirationTime: string | null;
  lastPingAt: string | null;
  lastPayloadAt: string | null;
}

interface HealthSnapshot {
  now: string;
  flows: FlowState[];
  queueByFlow: Record<string, QueueBucket>;
  runs: RunRow[];
  flags: FlagRow[];
  inbound: InboundInfo;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type FlowHealth = "failing" | "degraded" | "ok";

function flowHealth(flow: FlowState, queue: QueueBucket | undefined): FlowHealth {
  if (flow.consecutive_failures >= 3 || (queue?.dead || 0) > 0) return "failing";
  if (flow.consecutive_failures > 0) return "degraded";
  if (queue?.oldestPending && Date.now() - new Date(queue.oldestPending).getTime() > 45 * 60_000) {
    return "degraded"; // backlog isn't moving
  }
  return "ok";
}

const HEALTH_STYLE: Record<FlowHealth, { dot: string; label: string; badge: string }> = {
  ok: { dot: "bg-emerald-500", label: "Healthy", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  degraded: { dot: "bg-amber-500", label: "Degraded", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  failing: { dot: "bg-red-500", label: "Failing", badge: "bg-red-50 text-red-700 border-red-200" },
};

const REASON_LABEL: Record<string, string> = {
  unmapped_field: "Unmapped field",
  conflict: "Conflict",
  identity: "Identity",
  unknown_option: "Unknown option",
  deletion: "Deleted in Airtable",
  error: "Sync gave up",
};

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

// ─── View ─────────────────────────────────────────────────────────────────

export default function SyncHealth() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const body = (await api("/api/admin/airtable-health")) as HealthSnapshot & { ok: boolean };
      setSnapshot(body);
    } catch (err) {
      if (!silent) toast.error((err as Error).message || "Couldn't load sync health");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 30_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const runAction = async (action: string, extra: Record<string, unknown> = {}, successMsg?: string) => {
    const key = `${action}:${JSON.stringify(extra)}`;
    setBusyAction(key);
    try {
      await api("/api/admin/airtable-health", {
        method: "POST",
        body: JSON.stringify({ action, ...extra }),
      });
      if (successMsg) toast.success(successMsg);
      await load(true);
    } catch (err) {
      toast.error((err as Error).message || "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <RiLoader4Line className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="py-24 text-center text-sm text-slate-500">
        Couldn&apos;t load sync health.{" "}
        <button className="text-[#5C0FFE] underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const outboundFlows = snapshot.flows.filter((f) => f.direction === "outbound");
  const inboundFlow = snapshot.flows.find((f) => f.flow === "inbound") || null;
  const totalPending = Object.values(snapshot.queueByFlow).reduce((s, q) => s + q.pending + q.processing, 0);
  const totalDead = Object.values(snapshot.queueByFlow).reduce((s, q) => s + q.dead, 0);
  const failingCount = outboundFlows.filter((f) => flowHealth(f, snapshot.queueByFlow[f.flow]) === "failing").length;
  const recentErrors = snapshot.runs.filter((r) => r.status === "error").slice(0, 12);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Overview ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={failingCount === 0 ? RiCheckboxCircleLine : RiAlarmWarningLine}
          tone={failingCount === 0 ? "ok" : "bad"}
          label="Flows"
          value={failingCount === 0 ? "All healthy" : `${failingCount} failing`}
          sub={`${outboundFlows.length} outbound + inbound`}
        />
        <StatCard
          icon={RiTimeLine}
          tone={totalPending > 0 ? "warn" : "ok"}
          label="Pending changes"
          value={String(totalPending)}
          sub={totalDead > 0 ? `${totalDead} gave up — revive below` : "queue is draining"}
        />
        <StatCard
          icon={RiFlagLine}
          tone={snapshot.flags.length > 0 ? "warn" : "ok"}
          label="Needs review"
          value={String(snapshot.flags.length)}
          sub="conflicts · unmapped · identity"
        />
        <StatCard
          icon={RiPlugLine}
          tone={snapshot.inbound.mode === "webhook" ? "ok" : "warn"}
          label="Airtable → workspace"
          value={snapshot.inbound.mode === "webhook" ? "Webhook live" : "Polling (5 min)"}
          sub={
            inboundFlow?.last_remote_change_at
              ? `last remote change ${timeAgo(inboundFlow.last_remote_change_at)}`
              : "no remote changes seen yet"
          }
        />
      </div>

      {/* ── Global actions ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() =>
            void runAction("reconcile", {}, "Full re-sync queued — the worker drains it under the rate limit.")
          }
        >
          <RiRefreshLine className="w-4 h-4" /> Run full re-sync
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() => void runAction("poll_inbound", {}, "Pulled remote changes from Airtable.")}
        >
          <RiArrowLeftRightLine className="w-4 h-4" /> Pull remote changes now
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busyAction !== null}
          onClick={() => void runAction("ensure_webhook", {}, "Inbound webhook checked/registered.")}
        >
          <RiPlugLine className="w-4 h-4" /> Reconnect webhook
        </Button>
        {totalDead > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 border-red-200 text-red-700 hover:bg-red-50"
            disabled={busyAction !== null}
            onClick={() => void runAction("retry_dead", {}, "Dead items re-queued.")}
          >
            <RiRefreshLine className="w-4 h-4" /> Revive {totalDead} dead item{totalDead === 1 ? "" : "s"}
          </Button>
        )}
        <span className="ml-auto text-[11px] text-slate-400">
          auto-refreshes every 30s · updated {timeAgo(snapshot.now)}
        </span>
      </div>

      {/* ── GHL tag hygiene ────────────────────────────────────────── */}
      <GhlTagHygiene />

      {/* ── Per-flow cards ─────────────────────────────────────────── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {outboundFlows.map((flow) => {
          const queue = snapshot.queueByFlow[flow.flow];
          const health = flowHealth(flow, queue);
          const style = HEALTH_STYLE[health];
          const retriable = ["payroll_runs", "qc_issues_all", "partner", "contractors", "vas", "commercial"];
          const retryFlow = flow.flow === "qc_issue" ? "qc_issues_all" : flow.flow;
          return (
            <Card key={flow.flow} className="border-slate-200">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", style.dot)} />
                  <p className="text-sm font-semibold text-slate-900 truncate flex-1">{flow.display_name}</p>
                  <Badge variant="outline" className={cn("text-[10px]", style.badge)}>
                    {style.label}
                  </Badge>
                </div>
                <div className="text-xs text-slate-500 space-y-1">
                  <p>
                    Last synced: <span className="text-slate-700 font-medium">{timeAgo(flow.last_success_at)}</span>
                  </p>
                  <p>
                    Pending: <span className="text-slate-700 font-medium">{(queue?.pending || 0) + (queue?.processing || 0)}</span>
                    {" · "}Synced 24h: <span className="text-slate-700 font-medium">{queue?.done24h || 0}</span>
                    {(queue?.dead || 0) > 0 && (
                      <>
                        {" · "}
                        <span className="text-red-600 font-medium">{queue?.dead} dead</span>
                      </>
                    )}
                  </p>
                  {flow.consecutive_failures > 0 && (
                    <p className="text-red-600">
                      {flow.consecutive_failures} consecutive failure{flow.consecutive_failures === 1 ? "" : "s"}
                      {flow.last_error ? ` — ${flow.last_error.slice(0, 90)}` : ""}
                    </p>
                  )}
                </div>
                {retriable.includes(retryFlow) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-900"
                    disabled={busyAction !== null}
                    onClick={() => void runAction("retry_flow", { flow: retryFlow }, `Re-sync of ${flow.display_name} queued.`)}
                  >
                    <RiRefreshLine className="w-3.5 h-3.5 mr-1" /> Re-sync now
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Inbound card */}
        {inboundFlow && (
          <Card className="border-slate-200">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    inboundFlow.consecutive_failures >= 3 ? "bg-red-500" : "bg-emerald-500",
                  )}
                />
                <p className="text-sm font-semibold text-slate-900 truncate flex-1">{inboundFlow.display_name}</p>
                <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600 border-slate-200">
                  {snapshot.inbound.mode === "webhook" ? "webhook" : "poll"}
                </Badge>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>
                  Last checked: <span className="text-slate-700 font-medium">{timeAgo(inboundFlow.last_success_at)}</span>
                </p>
                <p>
                  Last remote change:{" "}
                  <span className="text-slate-700 font-medium">{timeAgo(inboundFlow.last_remote_change_at)}</span>
                </p>
                {snapshot.inbound.mode === "webhook" && snapshot.inbound.expirationTime && (
                  <p>
                    Webhook expires:{" "}
                    <span className="text-slate-700 font-medium">
                      {new Date(snapshot.inbound.expirationTime).toLocaleString()}
                    </span>{" "}
                    (auto-renewed)
                  </p>
                )}
                {inboundFlow.consecutive_failures > 0 && (
                  <p className="text-red-600">
                    {inboundFlow.consecutive_failures} consecutive failure{inboundFlow.consecutive_failures === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Needs review ───────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <RiFlagLine className="w-4 h-4 text-amber-600" />
          Needs review
          {snapshot.flags.length > 0 && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
              {snapshot.flags.length}
            </Badge>
          )}
        </h2>
        {snapshot.flags.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nothing flagged — no conflicts, unmapped fields, or identity issues outstanding.
          </p>
        ) : (
          <Card className="border-slate-200">
            <CardContent className="p-0 divide-y divide-slate-100">
              {snapshot.flags.map((flag) => (
                <div key={flag.id} className="flex items-start gap-3 p-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] shrink-0 mt-0.5",
                      flag.reason === "conflict" || flag.reason === "identity"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200",
                    )}
                  >
                    {REASON_LABEL[flag.reason] || flag.reason}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 leading-snug">{flag.message}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {[flag.airtable_table, flag.field_ref, flag.record_ref].filter(Boolean).join(" · ")}
                      {" · "}seen {flag.seen_count}× · last {timeAgo(flag.last_seen_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px] text-slate-500 hover:text-emerald-700 shrink-0"
                    disabled={busyAction !== null}
                    onClick={() => void runAction("resolve_flag", { id: flag.id }, "Flag resolved.")}
                  >
                    <RiCheckLine className="w-3.5 h-3.5 mr-1" /> Resolve
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Recent errors ──────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <RiErrorWarningLine className="w-4 h-4 text-red-500" />
          Recent errors
        </h2>
        {recentErrors.length === 0 ? (
          <p className="text-xs text-slate-400">No sync errors in the recent runs.</p>
        ) : (
          <Card className="border-slate-200">
            <CardContent className="p-0 divide-y divide-slate-100">
              {recentErrors.map((run) => (
                <div key={run.id} className="flex items-start gap-3 p-3 text-xs">
                  <span className="text-slate-400 shrink-0 w-16">{timeAgo(run.started_at)}</span>
                  <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600 border-slate-200 shrink-0">
                    {run.flow}
                  </Badge>
                  <span className="text-slate-600 flex-1 min-w-0 truncate">{run.error}</span>
                  <span className="text-slate-400 shrink-0">{run.trigger_source}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Recent activity ────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Recent sync activity</h2>
        <Card className="border-slate-200">
          <CardContent className="p-0 divide-y divide-slate-100 max-h-80 overflow-auto">
            {snapshot.runs.slice(0, 40).map((run) => (
              <div key={run.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    run.status === "success" ? "bg-emerald-500" : run.status === "skipped" ? "bg-slate-300" : "bg-red-500",
                  )}
                />
                <span className="text-slate-400 shrink-0 w-16">{timeAgo(run.started_at)}</span>
                <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600 border-slate-200 shrink-0">
                  {run.flow}
                </Badge>
                <span className="text-slate-500 shrink-0">{run.direction === "inbound" ? "←" : "→"}</span>
                <span className="text-slate-600 flex-1 min-w-0 truncate">
                  {run.status === "error"
                    ? run.error
                    : `${run.records_synced ?? 0} record${(run.records_synced ?? 0) === 1 ? "" : "s"} · ${run.trigger_source}`}
                </span>
                {run.duration_ms != null && <span className="text-slate-400 shrink-0">{Math.round(run.duration_ms / 100) / 10}s</span>}
              </div>
            ))}
            {snapshot.runs.length === 0 && (
              <p className="p-3 text-xs text-slate-400">No sync runs recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ─── Small pieces ──────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: typeof RiCheckboxCircleLine;
  tone: "ok" | "warn" | "bad";
  label: string;
  value: string;
  sub: string;
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 bg-emerald-50" : tone === "warn" ? "text-amber-600 bg-amber-50" : "text-red-600 bg-red-50";
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 flex items-start gap-3">
        <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", toneCls)}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{label}</p>
          <p className="text-sm font-semibold text-slate-900 truncate">{value}</p>
          <p className="text-[11px] text-slate-400 truncate">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}
