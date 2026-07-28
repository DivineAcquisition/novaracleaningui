"use client";

// ─── VA Performance ───────────────────────────────────────────────────────────
//
// Reads the verification layer and the EOD submissions side by side. The tab
// answers four questions:
//
//   Today        — who reported, who hasn't, what's flagged
//   Per VA       — verified vs self-reported, targets, trend, history
//   Discrepancies— the review queue, where a human decides
//   Review       — generate a period record for a documented conversation
//
// Every number that could not be verified renders as "unverified", never as a
// zero, because reading a source outage as a zero is how you end up in a
// performance conversation about nothing.

import {
  RiAlertLine,
  RiCheckboxCircleLine,
  RiCloudOffLine,
  RiExternalLinkLine,
  RiFileList3Line,
  RiLoader4Line,
  RiMailSendLine,
  RiRefreshLine,
  RiSettings3Line,
  RiTimeLine,
  RiUserSearchLine,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatMetric, METRICS, type MetricKey } from "@/lib/va-performance/metrics";

// ─── Types (mirrors of the admin API payloads) ────────────────────────────────

interface Va {
  id: string;
  name: string;
  email: string;
  status: string;
  performanceStatus: string;
  payType: string;
  rateCents: number | null;
  startDate: string | null;
  functionsAssigned: string[];
  apployeMemberId: string | null;
  ghlUserId: string | null;
  workspaceUserId: string | null;
  eodLinkLastSentAt: string | null;
  discordWebhookUrl: string | null;
}

interface Submission {
  id: string;
  vaId: string;
  workDate: string;
  status: string;
  metrics: Record<string, number>;
  selects: Record<string, string>;
  blockers: string | null;
  cleanerIssueNotes: string | null;
  pdfStatus: string;
  driveUrl: string | null;
  priorities: string | null;
  wins: string | null;
  escalations: string | null;
  submittedAt: string | null;
  submittedLate: boolean;
}

interface VerifiedDay {
  vaId: string;
  workDate: string;
  values: Partial<Record<MetricKey, number | null>>;
  provenance: Record<string, { source: string; syncedAt: string; status: string }>;
  lastSyncedAt: string | null;
}

interface TodayRow {
  va: Va;
  submission: Submission | null;
  verified: VerifiedDay | null;
  openFlags: number;
  status: "submitted_on_time" | "submitted_late" | "draft" | "missing";
}

interface Flag {
  id: string;
  va_id: string;
  work_date: string;
  metric_key: string;
  metric_label: string | null;
  self_reported: number | null;
  verified: number | null;
  variance: number | null;
  variance_pct: number | null;
  severity: string;
  status: string;
  va_explanation: string | null;
  review_note: string | null;
  reviewed_by_name: string | null;
  repeat_count: number;
}

interface Overview {
  today: {
    workDate: string;
    cutoffLocalTime: string;
    pastCutoff: boolean;
    rows: TodayRow[];
    openFlagTotal: number;
  };
  vas: Va[];
  settings: { timezone: string; backdateDays: number; cutoffLocalTime: string; lockAfterHours: number };
  thresholds: {
    base: { pct: number; abs: number };
    medium: { pct: number; abs: number };
    high: { pct: number; abs: number };
    repeat: { windowDays: number; count: number };
  };
}

type Tab = "today" | "va" | "queue" | "review" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "va", label: "Per VA" },
  { id: "queue", label: "Discrepancy queue" },
  { id: "review", label: "Weekly / monthly review" },
  { id: "settings", label: "Settings" },
];

// ─── API helper ───────────────────────────────────────────────────────────────

async function callAdmin<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const res = await fetch("/api/va/performance/admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, data: json };
}

async function callEodLink<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const res = await fetch("/api/va/eod/send-link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, data: json };
}

const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
        cents / 100,
      );

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function VaPerformance() {
  const [tab, setTab] = useState<Tab>("today");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sendingLinks, setSendingLinks] = useState(false);

  const sendAllLinks = async () => {
    setSendingLinks(true);
    const res = await callEodLink<{
      sent: { name: string }[];
      skipped: { name: string; skipped?: string }[];
    }>({ action: "send_all", force: true });
    setSendingLinks(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't send the links.");
      return;
    }
    const sent = res.data.sent?.length ?? 0;
    const skipped = res.data.skipped ?? [];
    if (sent === 0 && skipped.length) {
      toast.warning(`Nothing sent — ${skipped[0].skipped || "no delivery channel"}.`);
      return;
    }
    toast.success(
      `Sent ${sent} EOD link${sent === 1 ? "" : "s"}${skipped.length ? `, ${skipped.length} skipped` : ""}.`,
    );
    await load();
  };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await callAdmin<Overview>({ action: "overview" });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't load VA performance.");
      return;
    }
    setOverview(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/va/performance/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session?.access_token || ""}`,
        },
        body: JSON.stringify({ scope: "window" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        rowsWritten?: number;
        warnings?: string[];
      };
      if (!res.ok || json.ok === false) throw new Error(json.error || "Sync failed.");
      if (json.warnings?.length) {
        toast.warning(`Synced ${json.rowsWritten ?? 0} rows — ${json.warnings[0]}`);
      } else {
        toast.success(`Synced ${json.rowsWritten ?? 0} verified rows.`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="font-jakarta text-xl font-bold tracking-tight text-slate-900">
            VA Performance
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Verified actuals beside self-reported EOD. Flags ask for an explanation — you decide the
            outcome.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={sendAllLinks} disabled={sendingLinks}>
            <RiMailSendLine className={cn("mr-1.5 h-3.5 w-3.5", sendingLinks && "animate-pulse")} />
            Send EOD links
          </Button>
          <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            <RiRefreshLine className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
            Sync metrics
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
              tab === t.id
                ? "border-violet-600 text-violet-700"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
            {t.id === "queue" && overview?.today.openFlagTotal ? (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                {overview.today.openFlagTotal}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {loading && !overview ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !overview ? null : tab === "today" ? (
        <TodayTab overview={overview} />
      ) : tab === "va" ? (
        <PerVaTab vas={overview.vas} onSaved={load} />
      ) : tab === "queue" ? (
        <QueueTab vas={overview.vas} onChanged={load} />
      ) : tab === "review" ? (
        <ReviewTab vas={overview.vas} />
      ) : (
        <SettingsTab overview={overview} onSaved={load} />
      )}
    </div>
  );
}

// ─── Today ────────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TodayRow["status"], { label: string; cls: string }> = {
  submitted_on_time: { label: "Submitted", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  submitted_late: { label: "Late", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  draft: { label: "In progress", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  missing: { label: "Not submitted", cls: "border-slate-200 bg-slate-50 text-slate-600" },
};

function TodayTab({ overview }: { overview: Overview }) {
  const { rows, workDate, cutoffLocalTime, pastCutoff } = overview.today;
  const submitted = rows.filter((r) => r.status.startsWith("submitted")).length;
  const missing = rows.filter((r) => r.status === "missing");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Submitted"
          value={`${submitted} / ${rows.length}`}
          hint={`for ${workDate}`}
          icon={RiCheckboxCircleLine}
        />
        <StatCard
          label="Still outstanding"
          value={String(missing.length)}
          hint={pastCutoff ? `past the ${cutoffLocalTime} cutoff` : `cutoff ${cutoffLocalTime}`}
          icon={RiTimeLine}
          tone={pastCutoff && missing.length ? "warn" : "plain"}
        />
        <StatCard
          label="Open flags"
          value={String(overview.today.openFlagTotal)}
          hint="awaiting review"
          icon={RiAlertLine}
          tone={overview.today.openFlagTotal ? "warn" : "plain"}
        />
      </div>

      <Card className="border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">VA</th>
                <th className="px-4 py-2.5 text-left font-semibold">EOD</th>
                <th className="px-4 py-2.5 text-right font-semibold">Hours</th>
                <th className="px-4 py-2.5 text-right font-semibold">Calls</th>
                <th className="px-4 py-2.5 text-right font-semibold">Bookings</th>
                <th className="px-4 py-2.5 text-right font-semibold">Revenue booked</th>
                <th className="px-4 py-2.5 text-right font-semibold">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <RiUserSearchLine className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                    No approved VAs yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.va.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{row.va.name}</p>
                      <p className="text-xs text-slate-500">{row.va.email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={cn("text-[11px]", STATUS_BADGE[row.status].cls)}>
                        {STATUS_BADGE[row.status].label}
                      </Badge>
                    </td>
                    <MetricCell metric="hours_tracked" day={row.verified} />
                    <MetricCell metric="calls_placed" day={row.verified} />
                    <MetricCell metric="bookings_created" day={row.verified} />
                    <MetricCell metric="revenue_booked_cents" day={row.verified} />
                    <td className="px-4 py-2.5 text-right">
                      {row.openFlags ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                          {row.openFlags}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {missing.length > 0 && (
        <p className="text-xs text-slate-500">
          Outstanding: {missing.map((r) => r.va.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

function MetricCell({ metric, day }: { metric: MetricKey; day: VerifiedDay | null }) {
  const value = day?.values[metric];
  const status = day?.provenance?.[metric]?.status;
  const verified = value !== null && value !== undefined && (!status || status === "ok");
  return (
    <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
      {verified ? (
        <span className="text-slate-900">{formatMetric(metric, value as number)}</span>
      ) : (
        <span title="Unverified — the source wasn't reachable. Not a zero." className="text-amber-600">
          unverified
        </span>
      )}
    </td>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof RiAlertLine;
  tone?: "plain" | "warn";
}) {
  return (
    <Card
      className={cn(
        "flex items-center gap-3 border-slate-200 p-4",
        tone === "warn" && "border-amber-200 bg-amber-50/50",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <p className="font-mono text-lg font-semibold tabular-nums text-slate-900">{value}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
    </Card>
  );
}

// ─── Per VA ───────────────────────────────────────────────────────────────────

interface DetailPayload {
  va: Va;
  startDate: string;
  endDate: string;
  days: VerifiedDay[];
  submissions: Submission[];
  rollups: Partial<
    Record<MetricKey, { total: number | null; verifiedDays: number; unverifiedDays: number; average: number | null }>
  >;
  targets: {
    metricKey: string;
    label: string;
    target: number;
    actual: number | null;
    attainmentPct: number | null;
    met: boolean | null;
    unit: string | null;
  }[];
  compliance: {
    expectedDays: number;
    submittedDays: number;
    onTimeDays: number;
    lateDays: number;
    missedDates: string[];
    compliancePct: number | null;
  };
  revenue: {
    revenueAttributedCents: number | null;
    hours: number | null;
    perHourCents: number | null;
    partial: boolean;
  };
  flags: Flag[];
  coaching: Record<string, unknown>[];
  comparison: {
    workDate: string;
    metricKey: string;
    label: string;
    selfReported: number;
    verified: number | null;
    comparedTo: string;
  }[];
}

function PerVaTab({ vas, onSaved }: { vas: Va[]; onSaved: () => Promise<void> }) {
  const [vaId, setVaId] = useState(vas[0]?.id ?? "");
  const [days, setDays] = useState("30");
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!vaId) return;
    setLoading(true);
    const res = await callAdmin<DetailPayload>({ action: "va_detail", vaId, days: Number(days) });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't load this VA.");
      return;
    }
    setDetail(res.data);
  }, [vaId, days]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!vas.length) return <p className="text-sm text-slate-500">No VAs yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label className="text-xs text-slate-600">VA</Label>
          <Select value={vaId} onValueChange={setVaId}>
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {vas.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs text-slate-600">Window</Label>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="mt-1 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="ml-auto">
          <RiSettings3Line className="mr-1.5 h-3.5 w-3.5" />
          Verification links
        </Button>
      </div>

      {loading && !detail ? (
        <Skeleton className="h-64 w-full" />
      ) : !detail ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-slate-200 p-4">
              <p className="text-xs text-slate-500">Revenue per VA hour</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {detail.revenue.perHourCents === null ? "—" : money(detail.revenue.perHourCents)}
              </p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500">
                {detail.revenue.perHourCents === null ? (
                  "Not enough verified hours in this window to calculate."
                ) : (
                  <>
                    {money(detail.revenue.revenueAttributedCents)} attributed ÷{" "}
                    {detail.revenue.hours?.toFixed(1)} h
                    {detail.revenue.partial ? " · some days had no verified hours" : ""}
                  </>
                )}
              </p>
            </Card>
            <Card className="border-slate-200 p-4">
              <p className="text-xs text-slate-500">EOD compliance</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {detail.compliance.compliancePct === null ? "—" : `${detail.compliance.compliancePct}%`}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {detail.compliance.submittedDays}/{detail.compliance.expectedDays} weekdays ·{" "}
                {detail.compliance.lateDays} late
              </p>
            </Card>
            <Card className="border-slate-200 p-4">
              <p className="text-xs text-slate-500">Open flags</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {detail.flags.filter((f) => f.status === "open" || f.status === "explained").length}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{detail.flags.length} total on record</p>
            </Card>
          </div>

          <Card className="border-slate-200 p-4">
            <h3 className="font-jakarta text-sm font-bold text-slate-900">Target attainment</h3>
            <div className="mt-3 space-y-2">
              {detail.targets.length === 0 ? (
                <p className="text-xs text-slate-500">No targets apply to this VA yet.</p>
              ) : (
                detail.targets.map((t) => (
                  <div key={t.metricKey} className="flex items-center gap-3 text-sm">
                    <span className="w-52 shrink-0 truncate text-slate-700">{t.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          t.met === null ? "bg-slate-300" : t.met ? "bg-emerald-500" : "bg-amber-400",
                        )}
                        style={{ width: `${Math.min(100, t.attainmentPct ?? 0)}%` }}
                      />
                    </div>
                    <span className="w-36 shrink-0 text-right font-mono text-xs tabular-nums text-slate-600">
                      {t.attainmentPct === null ? (
                        <span className="text-amber-600">unverified</span>
                      ) : (
                        `${t.actual ?? 0} / ${Math.round(t.target)}`
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="border-slate-200 p-4">
            <h3 className="font-jakarta text-sm font-bold text-slate-900">
              Verified totals for this window
            </h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(detail.rollups) as MetricKey[])
                .filter((k) => detail.rollups[k]?.verifiedDays)
                .map((key) => {
                  const r = detail.rollups[key]!;
                  return (
                    <div key={key} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-[11px] text-slate-500">{METRICS[key].label}</p>
                      <p className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {formatMetric(key, r.total)}
                      </p>
                      {r.unverifiedDays > 0 && (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600">
                          <RiCloudOffLine className="h-3 w-3" />
                          {r.unverifiedDays} unverified day{r.unverifiedDays === 1 ? "" : "s"} excluded
                        </p>
                      )}
                    </div>
                  );
                })}
            </div>
          </Card>

          <Card className="border-slate-200 p-4">
            <h3 className="font-jakarta text-sm font-bold text-slate-900">
              Self-reported vs verified
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Only Tier 2 answers appear here — the ones the system can partially see.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-1.5 text-left font-semibold">Date</th>
                    <th className="py-1.5 text-left font-semibold">Metric</th>
                    <th className="py-1.5 text-right font-semibold">Reported</th>
                    <th className="py-1.5 text-right font-semibold">Observed</th>
                    <th className="py-1.5 text-left font-semibold">Compared against</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.comparison.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-slate-500">
                        Nothing self-reported in this window.
                      </td>
                    </tr>
                  ) : (
                    detail.comparison.map((c, i) => (
                      <tr key={`${c.workDate}-${c.metricKey}-${i}`}>
                        <td className="py-1.5 font-mono text-xs text-slate-500">{c.workDate}</td>
                        <td className="py-1.5 text-slate-700">{c.label}</td>
                        <td className="py-1.5 text-right font-mono text-xs tabular-nums">{c.selfReported}</td>
                        <td className="py-1.5 text-right font-mono text-xs tabular-nums">
                          {c.verified === null ? (
                            <span className="text-amber-600">unverified</span>
                          ) : (
                            c.verified
                          )}
                        </td>
                        <td className="py-1.5 text-[11px] text-slate-500">{c.comparedTo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="border-slate-200 p-4">
              <h3 className="font-jakarta text-sm font-bold text-slate-900">Recent EOD notes</h3>
              <p className="mt-0.5 text-xs text-slate-500">Never scored. Context only.</p>
              <div className="mt-3 space-y-3">
                {detail.submissions.filter((s) => s.status !== "draft").slice(0, 8).map((s) => (
                  <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="font-mono text-xs text-slate-500">
                      {s.workDate}
                      {s.submittedLate && <span className="ml-1.5 text-amber-600">late</span>}
                    </p>
                    {s.blockers && (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Blockers:</span> {s.blockers}
                      </p>
                    )}
                    {s.escalations && (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Escalation:</span> {s.escalations}
                      </p>
                    )}
                    {s.cleanerIssueNotes && (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Cleaner issue:</span> {s.cleanerIssueNotes}
                      </p>
                    )}
                    {s.driveUrl && (
                      <a
                        href={s.driveUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#5C0FFE] hover:underline"
                      >
                        <RiExternalLinkLine className="h-3 w-3" />
                        EOD report PDF
                      </a>
                    )}
                    {s.wins && (
                      <p className="mt-1 text-xs text-slate-700">
                        <span className="font-semibold">Wins:</span> {s.wins}
                      </p>
                    )}
                  </div>
                ))}
                {detail.submissions.filter((s) => s.status !== "draft").length === 0 && (
                  <p className="text-xs text-slate-500">No submissions in this window.</p>
                )}
              </div>
            </Card>

            <CoachingCard vaId={detail.va.id} entries={detail.coaching} onLogged={load} />
          </div>
        </>
      )}

      <VaLinksSheet
        open={editing}
        va={vas.find((v) => v.id === vaId) ?? null}
        onClose={() => setEditing(false)}
        onSaved={async () => {
          setEditing(false);
          await onSaved();
          await load();
        }}
      />
    </div>
  );
}

function CoachingCard({
  vaId,
  entries,
  onLogged,
}: {
  vaId: string;
  entries: Record<string, unknown>[];
  onLogged: () => Promise<void>;
}) {
  const [type, setType] = useState("coaching_note");
  const [summary, setSummary] = useState("");
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);

  const log = async () => {
    if (!summary.trim()) {
      toast.error("Write a summary — the record is the point.");
      return;
    }
    setBusy(true);
    const res = await callAdmin({
      action: "log_coaching",
      vaId,
      entryType: type,
      summary,
      actionAgreed: action,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't log that.");
      return;
    }
    toast.success("Logged.");
    setSummary("");
    setAction("");
    await onLogged();
  };

  return (
    <Card className="border-slate-200 p-4">
      <h3 className="font-jakarta text-sm font-bold text-slate-900">Coaching log</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
        Documented conversation, then formal warning. Never a pay consequence — these are 1099
        contractors.
      </p>

      <div className="mt-3 space-y-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="coaching_note">Coaching note</SelectItem>
            <SelectItem value="formal_warning">Formal warning</SelectItem>
            <SelectItem value="recognition">Recognition</SelectItem>
            <SelectItem value="performance_review">Performance review</SelectItem>
          </SelectContent>
        </Select>
        <Textarea
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What was discussed?"
          className="text-sm"
        />
        <Textarea
          rows={2}
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="What was agreed?"
          className="text-sm"
        />
        <Button size="sm" onClick={log} disabled={busy}>
          {busy && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Log entry
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {entries.slice(0, 6).map((e) => (
          <div key={String(e.id)} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-baseline gap-2">
              <Badge variant="outline" className="text-[10px]">
                {String(e.entry_type).replace("_", " ")}
              </Badge>
              <span className="font-mono text-xs text-slate-500">{String(e.entry_date)}</span>
            </div>
            <p className="mt-1 text-xs text-slate-700">{String(e.summary)}</p>
            {e.action_agreed ? (
              <p className="mt-1 text-xs text-slate-500">Agreed: {String(e.action_agreed)}</p>
            ) : null}
          </div>
        ))}
        {entries.length === 0 && <p className="text-xs text-slate-500">Nothing logged yet.</p>}
      </div>
    </Card>
  );
}

function VaLinksSheet({
  open,
  va,
  onClose,
  onSaved,
}: {
  open: boolean;
  va: Va | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [apploye, setApploye] = useState("");
  const [ghl, setGhl] = useState("");
  const [startDate, setStartDate] = useState("");
  const [rate, setRate] = useState("");
  const [status, setStatus] = useState("active");
  const [discordHook, setDiscordHook] = useState("");
  const [functions, setFunctions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);

  const linkApploye = async () => {
    if (!va) return;
    setLinking(true);
    const res = await callAdmin<{
      linked: { name: string; memberId: string }[];
      unmatched: string[];
    }>({ action: "link_apploye", vaId: va.id });
    setLinking(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't reach Apploye.");
      return;
    }
    const match = res.data.linked?.[0];
    if (match) {
      setApploye(match.memberId);
      toast.success(`Matched ${match.name} to their Apploye member.`);
      await onSaved();
      return;
    }
    toast.warning(
      `No Apploye member with ${va.email}. Invite them from the Apploye dashboard, then try again.`,
    );
  };

  useEffect(() => {
    if (!va) return;
    setApploye(va.apployeMemberId || "");
    setGhl(va.ghlUserId || "");
    setStartDate(va.startDate || "");
    setRate(va.rateCents === null ? "" : String(va.rateCents / 100));
    setStatus(va.performanceStatus || "active");
    setDiscordHook(va.discordWebhookUrl || "");
    setFunctions(va.functionsAssigned || []);
  }, [va]);

  const save = async () => {
    if (!va) return;
    setBusy(true);
    const res = await callAdmin({
      action: "save_va_profile",
      vaId: va.id,
      apployeMemberId: apploye,
      ghlUserId: ghl,
      startDate,
      rateCents: rate === "" ? null : Math.round(Number(rate) * 100),
      performanceStatus: status,
      functionsAssigned: functions,
      discordWebhookUrl: discordHook,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't save.");
      return;
    }
    toast.success("Saved.");
    await onSaved();
  };

  const toggleFn = (fn: string) =>
    setFunctions((list) => (list.includes(fn) ? list.filter((f) => f !== fn) : [...list, fn]));

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {va && (
          <>
            <SheetHeader>
              <SheetTitle>{va.name}</SheetTitle>
              <SheetDescription>
                Metrics are attributed through these IDs. An unlinked source reports as unverified
                rather than guessing by name.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">Apploye member ID</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={linkApploye}
                    disabled={linking}
                  >
                    {linking && <RiLoader4Line className="mr-1.5 h-3 w-3 animate-spin" />}
                    Match by email
                  </Button>
                </div>
                <Input value={apploye} onChange={(e) => setApploye(e.target.value)} placeholder="uuid" />
                <p className="text-[11px] text-slate-500">
                  Used for hours only. No activity or screenshot data is read. If the match fails, invite
                  them in Apploye first — the public API has no invite endpoint.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">GHL user ID</Label>
                <Input value={ghl} onChange={(e) => setGhl(e.target.value)} placeholder="ghl user id" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Workspace user</Label>
                <Input value={va.workspaceUserId || "not provisioned"} disabled className="bg-slate-50" />
                <p className="text-[11px] text-slate-500">
                  Optional. VAs reach their EOD through the personal link below, not a login.
                </p>
              </div>

              <EodLinkPanel va={va} onChanged={onSaved} />

              <div className="space-y-1.5">
                <Label className="text-sm">Private Discord webhook</Label>
                <Input
                  value={discordHook}
                  onChange={(e) => setDiscordHook(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                />
                <p className="text-[11px] leading-snug text-slate-500">
                  A channel only this VA can read. Their link is a credential, so it&apos;s never
                  posted to the shared ops channel — that one gets a reminder with no link in it.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Start date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Rate</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Functions</Label>
                <div className="flex flex-wrap gap-2">
                  {["operations", "sales", "recruiting"].map((fn) => (
                    <button
                      key={fn}
                      type="button"
                      onClick={() => toggleFn(fn)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs capitalize transition-colors",
                        functions.includes(fn)
                          ? "border-violet-500 bg-violet-50 font-semibold text-violet-700"
                          : "border-slate-200 text-slate-600",
                      )}
                    >
                      {fn}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Standing</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="probation">Probation</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="removed">Removed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={save} disabled={busy} className="w-full">
                {busy && <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The VA's personal EOD link. This is how they actually get to the form —
 * almost none of them have a workspace login, so the link is the access model,
 * not a convenience.
 */
function EodLinkPanel({ va, onChanged }: { va: Va; onChanged: () => Promise<void> }) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [linkDate, setLinkDate] = useState(today);

  const run = async (action: "send") => {
    setBusy(action);
    const res = await callEodLink<{
      url: string;
      emailed: boolean;
      discorded: boolean;
      expiresAt: string;
    }>({ action, vaId: va.id, workDate: linkDate });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't send the link.");
      return;
    }
    setUrl(res.data.url);
    const channels = [res.data.emailed ? "email" : null, res.data.discorded ? "Discord" : null]
      .filter(Boolean)
      .join(" and ");
    toast.success(`Link for ${linkDate} sent by ${channels}. Valid 24 hours.`);
    await onChanged();
  };

  const lastSent = va.eodLinkLastSentAt
    ? new Date(va.eodLinkLastSentAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">EOD link</Label>
        <span className="text-[11px] text-slate-500">
          {lastSent ? `last sent ${lastSent}` : "never sent"}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">
        One link per day, valid 24 hours. It opens that day only — a VA can&apos;t use it to file a
        different date.
      </p>
      <div className="mt-2">
        <Label className="text-[11px] text-slate-500">Day</Label>
        <Input
          type="date"
          value={linkDate}
          max={today}
          onChange={(e) => setLinkDate(e.target.value)}
          className="mt-1 h-8"
        />
        {linkDate !== today && (
          <p className="mt-1 text-[11px] text-amber-700">
            Backfilling {linkDate}. Recorded against your name — only admins can do this.
          </p>
        )}
      </div>

      {url && (
        <div className="mt-2 flex items-center gap-2">
          <Input value={url} readOnly className="h-8 bg-white font-mono text-[11px]" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => {
              void navigator.clipboard.writeText(url);
              toast.success("Copied.");
            }}
          >
            Copy
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => run("send")} disabled={!!busy}>
          {busy === "send" && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          <RiMailSendLine className="mr-1.5 h-3.5 w-3.5" />
          {linkDate === today ? "Send today's link" : `Send link for ${linkDate}`}
        </Button>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        Goes to their email, and to their private Discord channel if one is set. Sending again for the
        same day replaces the previous link. Offboarding a VA disables it immediately.
      </p>
    </div>
  );
}

// ─── Discrepancy queue ────────────────────────────────────────────────────────

function QueueTab({ vas, onChanged }: { vas: Va[]; onChanged: () => Promise<void> }) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettled, setShowSettled] = useState(false);

  const vaName = useMemo(() => new Map(vas.map((v) => [v.id, v.name])), [vas]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await callAdmin<{ flags: Flag[] }>({
      action: "flag_queue",
      statuses: showSettled ? ["open", "explained", "confirmed_issue", "dismissed"] : ["open", "explained"],
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't load the queue.");
      return;
    }
    setFlags(res.data.flags || []);
  }, [showSettled]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm leading-relaxed text-slate-600">
          A flag means a self-reported number didn&apos;t match what the system observed. That happens for
          legitimate reasons — work outside the logged tools, a call from a personal line, a source
          outage. Read the explanation, then decide. Nothing here changes anyone&apos;s pay.
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={showSettled}
          onChange={(e) => setShowSettled(e.target.checked)}
          className="rounded border-slate-300"
        />
        Include already-reviewed flags
      </label>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : flags.length === 0 ? (
        <Card className="border-slate-200 p-12 text-center">
          <RiCheckboxCircleLine className="mx-auto mb-2 h-7 w-7 text-emerald-400" />
          <p className="text-sm text-slate-600">Nothing waiting on review.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {flags.map((flag) => (
            <FlagReviewCard
              key={flag.id}
              flag={flag}
              vaName={vaName.get(flag.va_id) || "Unknown VA"}
              onReviewed={async () => {
                await load();
                await onChanged();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const SEVERITY_CLS: Record<string, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-slate-200 bg-slate-50 text-slate-600",
};

function FlagReviewCard({
  flag,
  vaName,
  onReviewed,
}: {
  flag: Flag;
  vaName: string;
  onReviewed: () => Promise<void>;
}) {
  const [note, setNote] = useState(flag.review_note || "");
  const [busy, setBusy] = useState<string | null>(null);
  const settled = flag.status === "confirmed_issue" || flag.status === "dismissed";

  const review = async (status: string) => {
    setBusy(status);
    const res = await callAdmin({ action: "review_flag", flagId: flag.id, status, reviewNote: note });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't record that.");
      return;
    }
    toast.success("Recorded.");
    await onReviewed();
  };

  return (
    <Card className="border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="font-semibold text-slate-900">{vaName}</p>
        <span className="font-mono text-xs text-slate-500">{flag.work_date}</span>
        <span className="text-sm text-slate-700">· {flag.metric_label || flag.metric_key}</span>
        <Badge variant="outline" className={cn("ml-auto text-[10px]", SEVERITY_CLS[flag.severity])}>
          {flag.severity}
        </Badge>
        <Badge variant="outline" className="text-[10px] capitalize">
          {flag.status.replace("_", " ")}
        </Badge>
      </div>

      <p className="mt-2 font-mono text-xs tabular-nums text-slate-600">
        reported {flag.self_reported} · observed {flag.verified} · variance {flag.variance} (
        {flag.variance_pct}%)
        {flag.repeat_count > 0 && (
          <span className="ml-2 text-amber-700">{flag.repeat_count} prior in the window</span>
        )}
      </p>

      <div className="mt-3 rounded-lg bg-slate-50 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          VA&apos;s explanation
        </p>
        <p className="mt-1 text-sm text-slate-700">
          {flag.va_explanation || <span className="text-slate-400">Not answered yet.</span>}
        </p>
      </div>

      {settled ? (
        <p className="mt-3 text-xs text-slate-500">
          Reviewed by {flag.reviewed_by_name || "admin"}
          {flag.review_note ? ` — "${flag.review_note}"` : ""}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Your note — required to confirm or dismiss."
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => review("explained")} disabled={!!busy}>
              {busy === "explained" && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Accept explanation
            </Button>
            <Button size="sm" variant="outline" onClick={() => review("dismissed")} disabled={!!busy}>
              {busy === "dismissed" && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Dismiss — not a real variance
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => review("confirmed_issue")}
              disabled={!!busy}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              {busy === "confirmed_issue" && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Confirm issue
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">
            Confirming records the finding for the coaching ladder. It never triggers a pay change.
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── Weekly / monthly review ──────────────────────────────────────────────────

interface Period {
  id: string;
  vaId: string;
  periodType: string;
  startDate: string;
  endDate: string;
  totalHours: number | null;
  targetAttainmentPct: number | null;
  revenueAttributedCents: number | null;
  revenuePerHourCents: number | null;
  compliance: { compliancePct: number | null; submittedDays: number; expectedDays: number; lateDays: number };
  discrepancyCount: number;
  status: string;
  overallRating: string | null;
  reviewNotes: string | null;
}

function ReviewTab({ vas }: { vas: Va[] }) {
  const [vaId, setVaId] = useState(vas[0]?.id ?? "");
  const [periodType, setPeriodType] = useState("weekly");
  const [anchor, setAnchor] = useState("");
  const [period, setPeriod] = useState<Period | null>(null);
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState("");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!vaId) return;
    setBusy(true);
    const res = await callAdmin<{ period: Period }>({
      action: "generate_period",
      vaId,
      periodType,
      anchorDate: anchor || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't generate that period.");
      return;
    }
    setPeriod(res.data.period);
    setNotes(res.data.period.reviewNotes || "");
    setRating(res.data.period.overallRating || "");
    toast.success("Period generated.");
  };

  const saveReview = async () => {
    if (!period) return;
    setBusy(true);
    const res = await callAdmin({
      action: "save_period_review",
      periodId: period.id,
      reviewNotes: notes,
      overallRating: rating || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't save.");
      return;
    }
    toast.success("Review saved.");
  };

  if (!vas.length) return <p className="text-sm text-slate-500">No VAs yet.</p>;

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <Label className="text-xs text-slate-600">VA</Label>
            <Select value={vaId} onValueChange={setVaId}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {vas.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label className="text-xs text-slate-600">Period</Label>
            <Select value={periodType} onValueChange={setPeriodType}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label className="text-xs text-slate-600">Any date inside it</Label>
            <Input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className="mt-1 h-9"
            />
          </div>
          <Button onClick={generate} disabled={busy} size="sm">
            {busy && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            <RiFileList3Line className="mr-1.5 h-3.5 w-3.5" />
            Generate
          </Button>
        </div>
      </Card>

      {period && (
        <Card className="border-slate-200 p-5">
          <h3 className="font-jakarta text-base font-bold text-slate-900">
            {period.periodType === "weekly" ? "Week" : "Month"} of {period.startDate} — {period.endDate}
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Metric label="Hours" value={period.totalHours === null ? "—" : `${period.totalHours} h`} />
            <Metric
              label="Revenue per hour"
              value={period.revenuePerHourCents === null ? "—" : money(period.revenuePerHourCents)}
            />
            <Metric
              label="Target attainment"
              value={period.targetAttainmentPct === null ? "—" : `${period.targetAttainmentPct}%`}
            />
            <Metric
              label="EOD compliance"
              value={
                period.compliance.compliancePct === null ? "—" : `${period.compliance.compliancePct}%`
              }
              hint={`${period.compliance.submittedDays}/${period.compliance.expectedDays} · ${period.compliance.lateDays} late`}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {period.discrepancyCount} discrepancy flag{period.discrepancyCount === 1 ? "" : "s"} in this
            window (dismissed ones excluded).
          </p>

          <div className="mt-5 space-y-3">
            <div className="w-56">
              <Label className="text-xs text-slate-600">Overall rating</Label>
              <Select value={rating} onValueChange={setRating}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exceeding">Exceeding</SelectItem>
                  <SelectItem value="on_track">On track</SelectItem>
                  <SelectItem value="needs_improvement">Needs improvement</SelectItem>
                  <SelectItem value="at_risk">At risk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Review notes</Label>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What you discussed, what was agreed."
                className="mt-1 text-sm"
              />
            </div>
            <Button onClick={saveReview} disabled={busy} size="sm">
              {busy && <RiLoader4Line className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save review
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="font-mono text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ overview, onSaved }: { overview: Overview; onSaved: () => Promise<void> }) {
  const [eod, setEod] = useState(overview.settings);
  const [th, setTh] = useState(overview.thresholds);
  const [busy, setBusy] = useState(false);
  const [syncingAirtable, setSyncingAirtable] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await callAdmin({ action: "save_settings", eodSettings: eod, thresholds: th });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.data.error || "Couldn't save.");
      return;
    }
    toast.success("Saved.");
    await onSaved();
  };

  const syncAirtable = async () => {
    setSyncingAirtable(true);
    const res = await callAdmin<{ baseId: string; baseCreated: boolean; warnings: string[] }>({
      action: "airtable_sync",
      days: 60,
    });
    setSyncingAirtable(false);
    if (!res.ok) {
      toast.error(res.data.error || "Airtable sync failed.");
      return;
    }
    toast.success(
      res.data.baseCreated
        ? "Created the Team Performance base and pushed the last 60 days."
        : "Pushed the last 60 days to the Team Performance base.",
    );
  };

  const band = (key: "base" | "medium" | "high", label: string, help: string) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{help}</p>
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <Label className="text-[11px] text-slate-500">Variance %</Label>
          <Input
            type="number"
            value={th[key].pct}
            onChange={(e) => setTh({ ...th, [key]: { ...th[key], pct: Number(e.target.value) } })}
            className="mt-1 h-9"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[11px] text-slate-500">Absolute</Label>
          <Input
            type="number"
            value={th[key].abs}
            onChange={(e) => setTh({ ...th, [key]: { ...th[key], abs: Number(e.target.value) } })}
            className="mt-1 h-9"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 p-5">
        <h3 className="font-jakarta text-sm font-bold text-slate-900">EOD window</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div>
            <Label className="text-xs text-slate-600">Timezone</Label>
            <Input
              value={eod.timezone}
              onChange={(e) => setEod({ ...eod, timezone: e.target.value })}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600">On-time cutoff</Label>
            <Input
              value={eod.cutoffLocalTime}
              onChange={(e) => setEod({ ...eod, cutoffLocalTime: e.target.value })}
              placeholder="17:30"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600">Backdate days</Label>
            <Input
              type="number"
              value={eod.backdateDays}
              onChange={(e) => setEod({ ...eod, backdateDays: Number(e.target.value) })}
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label className="text-xs text-slate-600">Lock after (hours)</Label>
            <Input
              type="number"
              value={eod.lockAfterHours}
              onChange={(e) => setEod({ ...eod, lockAfterHours: Number(e.target.value) })}
              className="mt-1 h-9"
            />
          </div>
        </div>
      </Card>

      <Card className="border-slate-200 p-5">
        <h3 className="font-jakarta text-sm font-bold text-slate-900">Discrepancy thresholds</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          A flag fires when the variance exceeds the greater of the percentage or the absolute figure.
          Flags are prompts for review — none of this auto-penalizes anyone.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {band("base", "Flag at", "Below this, nothing is raised at all.")}
          {band("medium", "Medium at", "Material enough to notify.")}
          {band("high", "High at", "Large variance — always notifies.")}
        </div>
        <div className="mt-3 flex gap-3">
          <div className="w-40">
            <Label className="text-xs text-slate-600">Repeat window (days)</Label>
            <Input
              type="number"
              value={th.repeat.windowDays}
              onChange={(e) => setTh({ ...th, repeat: { ...th.repeat, windowDays: Number(e.target.value) } })}
              className="mt-1 h-9"
            />
          </div>
          <div className="w-40">
            <Label className="text-xs text-slate-600">Repeats before High</Label>
            <Input
              type="number"
              value={th.repeat.count}
              onChange={(e) => setTh({ ...th, repeat: { ...th.repeat, count: Number(e.target.value) } })}
              className="mt-1 h-9"
            />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy}>
          {busy && <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />}
          Save settings
        </Button>
        <Button variant="outline" onClick={syncAirtable} disabled={syncingAirtable}>
          {syncingAirtable ? (
            <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RiExternalLinkLine className="mr-1.5 h-4 w-4" />
          )}
          Sync Airtable base
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Apploye supplies hours only. No screenshots, activity percentages, keystroke data or app-usage
        monitoring is requested, stored or shown anywhere in this system.
      </p>
    </div>
  );
}
