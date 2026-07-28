"use client";

// ─── Needs Attention ──────────────────────────────────────────────────────────
//
// Where a delay stops being an incident and becomes a handled problem.
//
//   At risk    — every booking a delay has put in jeopardy, with the computed
//                new arrival ETA and the customer heads-up already drafted.
//                One tap sends it. One tap covers the job.
//   On call    — who is designated backup for a day, drawn from availability.
//   Projections— projected vs actual by service type × sqft band, so the
//                duration assumptions get corrected from reality.
//   Thresholds — buffer, late-start, no-show, and escalation timings.
//
// The whole tab is built around one belief: a customer may tolerate lateness,
// but no customer tolerates silence. So the drafted message is the primary
// action on every card, and anything left unsent turns red rather than fading
// quietly down the list.

import {
  RiAlarmWarningLine,
  RiAlertLine,
  RiCheckLine,
  RiCloseLine,
  RiLifebuoyLine,
  RiLoader4Line,
  RiMailSendLine,
  RiRefreshLine,
  RiRulerLine,
  RiSettings3Line,
  RiShieldCheckLine,
  RiTimeLine,
  RiUserSharedLine,
} from "@remixicon/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  DELAY_EVENT_LABELS,
  SCHEDULE_GUARD_DEFAULTS,
  varianceHeadline,
  type CoverageCandidate,
  type DurationVarianceRow,
  type LateStartOffenderRow,
  type RiskBoardRow,
  type ScheduleGuardSettings,
} from "@/lib/schedule-risk";

type Tab = "risk" | "backups" | "projections" | "settings";

interface BackupRow {
  id: string;
  cleaner_id: string;
  on_call_date: string;
  priority: number;
  zips: string[];
  notes: string | null;
  active: boolean;
  activated_booking_id: string | null;
  activated_at: string | null;
  designated_by_name: string | null;
  cleaners: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    novara_score: number | null;
    home_zip: string | null;
  } | null;
}

interface OverrideRow {
  id: string;
  booking_id: string;
  required_buffer_minutes: number;
  actual_gap_minutes: number | null;
  travel_minutes: number | null;
  reason: string;
  created_by_name: string | null;
  created_at: string;
  bookings: {
    booking_number: number | null;
    first_name: string | null;
    last_name: string | null;
    service_date: string | null;
    time_slot: string | null;
  } | null;
}

interface ReassignmentRow {
  id: string;
  booking_id: string;
  from_cleaner_name: string | null;
  to_cleaner_name: string | null;
  reason: string;
  was_designated_backup: boolean;
  created_by_name: string | null;
  created_at: string;
}

interface AssumptionRow {
  service_type: string;
  home_size_id: string;
  base_hours: number;
  learned_multiplier: number;
  learned_from_samples: number;
  learned_at: string | null;
}

interface BoardPayload {
  ok: boolean;
  onCallDate: string;
  settings: ScheduleGuardSettings;
  board: RiskBoardRow[];
  backups: BackupRow[];
  variance: DurationVarianceRow[];
  lateStartOffenders: LateStartOffenderRow[];
  overrides: OverrideRow[];
  reassignments: ReassignmentRow[];
  assumptions: AssumptionRow[];
  counts: {
    atRisk: number;
    unacknowledged: number;
    awaitingCustomerMessage: number;
    escalated: number;
    noShows: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function callApi<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: T & { error?: string; bufferConflict?: unknown } }> {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch("/api/admin/schedule-risk", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, data: json };
}

function clockIn(tz: string, iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayIn(tz: string, iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  });
}

function minutesSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function customerName(row: RiskBoardRow): string {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Customer";
}

// ─── At-risk card ─────────────────────────────────────────────────────────────

function RiskCard({
  row,
  tz,
  messageEscalateMinutes,
  onChanged,
}: {
  row: RiskBoardRow;
  tz: string;
  messageEscalateMinutes: number;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(row.draft_body || "");
  const [busy, setBusy] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [candidates, setCandidates] = useState<CoverageCandidate[] | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  useEffect(() => {
    setDraft(row.draft_body || "");
  }, [row.draft_body, row.message_id]);

  const awaitingSend = row.message_status === "pending";
  const overdueMinutes = awaitingSend ? minutesSince(row.message_prepared_at) : 0;
  const silenceIsOverdue = awaitingSend && overdueMinutes >= messageEscalateMinutes;

  const send = async () => {
    if (!row.message_id) return;
    setBusy("send");
    const { ok, data } = await callApi({ action: "send_message", messageId: row.message_id, body: draft });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not send the heads-up.");
    toast.success(`Heads-up sent to ${customerName(row)} — logged to the booking.`);
    onChanged();
  };

  const dismiss = async () => {
    if (!row.message_id) return;
    if (!dismissReason.trim()) return void toast.error("Say why the customer doesn't need this.");
    setBusy("dismiss");
    const { ok, data } = await callApi({
      action: "dismiss_message",
      messageId: row.message_id,
      reason: dismissReason.trim(),
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not dismiss.");
    setDismissing(false);
    setDismissReason("");
    onChanged();
  };

  const acknowledge = async () => {
    setBusy("ack");
    const { ok, data } = await callApi({ action: "acknowledge", riskFlagId: row.risk_flag_id });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not acknowledge.");
    onChanged();
  };

  const loadCoverage = async () => {
    setCoverageOpen(true);
    if (candidates) return;
    setBusy("coverage");
    const { ok, data } = await callApi<{ candidates: CoverageCandidate[] }>({
      action: "coverage",
      bookingId: row.booking_id,
      limit: 8,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not rank coverage.");
    setCandidates(data.candidates || []);
  };

  const reassign = async (candidate: CoverageCandidate) => {
    const reason = window.prompt(
      `Reassign ${row.booking_ref} to ${candidate.name}. Why? (logged against the delay)`,
      `${DELAY_EVENT_LABELS[row.delay_event_type]} on ${row.upstream_booking_ref || row.booking_ref} — covering to protect the customer's window.`,
    );
    if (!reason?.trim()) return;

    let bufferOverrideReason: string | undefined;
    if (!candidate.buffer_ok) {
      const forced = window.prompt(
        `${candidate.name}'s own day has no buffer around this job. Forcing it is logged as an override — why is it the right call?`,
      );
      if (!forced?.trim()) return;
      bufferOverrideReason = forced.trim();
    }

    setBusy("reassign");
    const { ok, data } = await callApi({
      action: "reassign",
      bookingId: row.booking_id,
      toCleanerId: candidate.cleaner_id,
      riskFlagId: row.risk_flag_id,
      delayEventId: row.delay_event_id,
      reason: reason.trim(),
      bufferOverrideReason,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Reassignment failed.");
    toast.success(`${row.booking_ref} moved to ${candidate.name} — their portal has the full job.`);
    onChanged();
  };

  return (
    <Card
      className={cn(
        "border-l-4",
        row.delay_event_type === "no_show"
          ? "border-l-red-500 bg-red-50/40"
          : silenceIsOverdue
          ? "border-l-orange-500 bg-orange-50/40"
          : row.status === "acknowledged"
          ? "border-l-slate-300"
          : "border-l-amber-400 bg-amber-50/30",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.booking_ref}</span>
              <span className="text-slate-500 font-normal">{customerName(row)}</span>
              <Badge variant={row.delay_event_type === "no_show" ? "destructive" : "secondary"}>
                {DELAY_EVENT_LABELS[row.delay_event_type]}
              </Badge>
              {row.status === "acknowledged" ? (
                <Badge variant="outline" className="text-slate-600">
                  Acknowledged{row.acknowledged_by_name ? ` · ${row.acknowledged_by_name}` : ""}
                </Badge>
              ) : null}
              {row.escalated_at ? (
                <Badge variant="destructive" className="gap-1">
                  <RiAlarmWarningLine className="w-3 h-3" /> Escalated
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="mt-1 text-slate-700">{row.reason}</CardDescription>
          </div>
          <div className="text-right text-xs text-slate-600 shrink-0">
            <div>
              Booked <span className="font-medium">{clockIn(tz, row.scheduled_start_at)}</span>
            </div>
            <div className="text-amber-700 font-semibold">
              Now ~{clockIn(tz, row.projected_arrival_at)}
            </div>
            <div>{row.delay_minutes} min late</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            Crew: <span className="font-medium text-slate-800">{row.cleaner_name || "unassigned"}</span>
            {row.cleaner_phone ? ` · ${row.cleaner_phone}` : ""}
          </div>
          <div>
            {row.address ? `${row.address}, ${row.city || ""}` : "Address unavailable"}
          </div>
          {row.upstream_booking_ref && row.upstream_booking_ref !== row.booking_ref ? (
            <div>
              Caused by {row.upstream_booking_ref} (projected end{" "}
              {clockIn(tz, row.upstream_projected_end_at)})
            </div>
          ) : null}
          {row.qc_issue_id ? <div className="text-red-700">QC reliability case opened</div> : null}
        </div>

        {/* The heads-up. Primary action on every card. */}
        {row.message_id && awaitingSend ? (
          <div
            className={cn(
              "rounded-md border p-3 space-y-2",
              silenceIsOverdue ? "border-orange-300 bg-white" : "border-slate-200 bg-white",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                Ready to send · {row.message_channel === "email" ? "email" : "SMS"}
              </p>
              <span className={cn("text-[11px]", silenceIsOverdue ? "text-orange-700 font-semibold" : "text-slate-500")}>
                {silenceIsOverdue
                  ? `Unsent for ${overdueMinutes} min — the customer still doesn't know`
                  : `Drafted ${overdueMinutes} min ago`}
              </span>
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={send} disabled={busy !== null}>
                {busy === "send" ? (
                  <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <RiMailSendLine className="w-4 h-4 mr-1.5" />
                )}
                Send to {row.first_name || "customer"}
              </Button>
              <Button size="sm" variant="outline" onClick={loadCoverage} disabled={busy !== null}>
                <RiUserSharedLine className="w-4 h-4 mr-1.5" />
                Find coverage
              </Button>
              {row.status === "open" ? (
                <Button size="sm" variant="ghost" onClick={acknowledge} disabled={busy !== null}>
                  <RiCheckLine className="w-4 h-4 mr-1.5" />
                  I&apos;m on it
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="text-slate-500"
                onClick={() => setDismissing((v) => !v)}
                disabled={busy !== null}
              >
                <RiCloseLine className="w-4 h-4 mr-1.5" />
                Not needed
              </Button>
            </div>
            {dismissing ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Input
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Why doesn't the customer need this? (logged)"
                  className="flex-1 min-w-[240px] text-sm"
                />
                <Button size="sm" variant="secondary" onClick={dismiss} disabled={busy !== null}>
                  Dismiss
                </Button>
              </div>
            ) : null}
          </div>
        ) : row.message_status === "sent" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <RiShieldCheckLine className="w-4 h-4" />
              Customer told at {clockIn(tz, row.sent_at)}
              {row.sent_by_name ? ` by ${row.sent_by_name}` : ""}
            </p>
            <p className="text-emerald-800/90">{row.sent_body || row.draft_body}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={loadCoverage} disabled={busy !== null}>
              <RiUserSharedLine className="w-4 h-4 mr-1.5" />
              Find coverage
            </Button>
            {row.status === "open" ? (
              <Button size="sm" variant="ghost" onClick={acknowledge} disabled={busy !== null}>
                <RiCheckLine className="w-4 h-4 mr-1.5" /> I&apos;m on it
              </Button>
            ) : null}
          </div>
        )}

        {/* Coverage: backups first, then the rest by score, zone and slack. */}
        {coverageOpen ? (
          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 mb-2">
              Coverage candidates — designated backups first
            </p>
            {candidates === null ? (
              <Skeleton className="h-16 w-full" />
            ) : candidates.length === 0 ? (
              <p className="text-xs text-slate-600">
                Nobody clears this job&apos;s window, zone and stated limits. Reschedule with the
                customer instead of sending someone who can&apos;t finish it.
              </p>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <div
                    key={c.cleaner_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5"
                  >
                    <div className="text-xs">
                      <span className="font-medium text-slate-900">{c.name}</span>
                      {c.is_designated_backup ? (
                        <Badge className="ml-1.5 bg-indigo-600 hover:bg-indigo-600 text-[10px]">
                          On call
                        </Badge>
                      ) : null}
                      <span className="ml-1.5 text-slate-500">
                        Novara {c.novara_score ?? "—"} · {c.zone_fit}
                        {c.distance_miles != null ? ` · ${c.distance_miles} mi` : ""} ·{" "}
                        {c.jobs_that_day} job{c.jobs_that_day === 1 ? "" : "s"} that day
                      </span>
                      {!c.buffer_ok ? (
                        <span className="ml-1.5 text-orange-700">· {c.buffer_note}</span>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant={c.buffer_ok ? "default" : "outline"}
                      onClick={() => reassign(c)}
                      disabled={busy !== null}
                    >
                      {busy === "reassign" ? (
                        <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        "Assign"
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NeedsAttention() {
  const [tab, setTab] = useState<Tab>("risk");
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [onCallDate, setOnCallDate] = useState<string>("");
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data: session } = await supabase.auth.getSession();
        const params = new URLSearchParams();
        if (onCallDate) params.set("date", onCallDate);
        if (showResolved) params.set("includeResolved", "1");
        const res = await fetch(`/api/admin/schedule-risk?${params.toString()}`, {
          headers: { Authorization: `Bearer ${session.session?.access_token || ""}` },
        });
        const json = (await res.json()) as BoardPayload & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error || "Could not load the board.");
        setPayload(json);
        if (!onCallDate) setOnCallDate(json.onCallDate);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [onCallDate, showResolved],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The sweep runs every five minutes server-side; refresh at the same cadence
  // so the board a VA is looking at is never more than a sweep behind.
  useEffect(() => {
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const tz = payload?.settings.timezone || SCHEDULE_GUARD_DEFAULTS.timezone;
  const counts = payload?.counts;

  const grouped = useMemo(() => {
    const rows = payload?.board || [];
    const live = rows.filter((r) => r.status === "open" || r.status === "acknowledged");
    return {
      noShow: live.filter((r) => r.delay_event_type === "no_show"),
      awaitingMessage: live.filter((r) => r.delay_event_type !== "no_show" && r.message_status === "pending"),
      handled: live.filter((r) => r.delay_event_type !== "no_show" && r.message_status !== "pending"),
      closed: rows.filter((r) => r.status !== "open" && r.status !== "acknowledged"),
    };
  }, [payload]);

  const runSweep = async () => {
    setSweeping(true);
    const { ok, data } = await callApi<{ result: Record<string, number> }>({ action: "run_sweep" });
    setSweeping(false);
    if (!ok) return void toast.error(data.error || "Sweep failed.");
    const r = data.result || {};
    toast.success(
      `Swept: ${r.late_starts ?? 0} late start(s), ${r.no_shows ?? 0} no-show(s), ` +
        `${r.overruns ?? 0} overrun(s), ${r.downstream_at_risk ?? 0} downstream at risk.`,
    );
    void load(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Needs Attention</h1>
          <p className="text-sm text-slate-600 mt-0.5 max-w-2xl">
            Bookings a delay has put at risk, with the customer message already written. One delay
            should cost minutes, not customers — so the fastest thing on this page is telling the
            customer.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={runSweep} disabled={sweeping}>
            {sweeping ? (
              <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <RiTimeLine className="w-4 h-4 mr-1.5" />
            )}
            Check now
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="At risk now" value={counts?.atRisk} tone={counts?.atRisk ? "warning" : "ok"} />
        <StatCard
          label="Customer not told yet"
          value={counts?.awaitingCustomerMessage}
          tone={counts?.awaitingCustomerMessage ? "danger" : "ok"}
        />
        <StatCard label="No-shows" value={counts?.noShows} tone={counts?.noShows ? "danger" : "ok"} />
        <StatCard
          label="Unacknowledged"
          value={counts?.unacknowledged}
          tone={counts?.unacknowledged ? "warning" : "ok"}
        />
        <StatCard label="Escalated to admin" value={counts?.escalated} tone={counts?.escalated ? "danger" : "ok"} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {(
          [
            ["risk", "At risk", RiAlertLine],
            ["backups", "On call", RiLifebuoyLine],
            ["projections", "Projections", RiRulerLine],
            ["settings", "Thresholds", RiSettings3Line],
          ] as [Tab, string, typeof RiAlertLine][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {loading && !payload ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : tab === "risk" ? (
        <div className="space-y-4">
          {grouped.noShow.length === 0 &&
          grouped.awaitingMessage.length === 0 &&
          grouped.handled.length === 0 ? (
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardContent className="py-8 text-center">
                <RiShieldCheckLine className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
                <p className="text-sm font-medium text-emerald-900">
                  Nothing at risk. Every crew is tracking to its projection.
                </p>
                <p className="text-xs text-emerald-800/80 mt-1">
                  The schedule is swept every 5 minutes against projected end times.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {grouped.noShow.length > 0 ? (
            <Section
              title="No-shows — contact these customers first"
              hint="Nobody has started. A QC reliability case is already open against the cleaner; the consequence is a human decision."
            >
              {grouped.noShow.map((row) => (
                <RiskCard
                  key={row.risk_flag_id}
                  row={row}
                  tz={tz}
                  messageEscalateMinutes={payload?.settings.customer_message_escalate_minutes ?? 20}
                  onChanged={() => void load(true)}
                />
              ))}
            </Section>
          ) : null}

          {grouped.awaitingMessage.length > 0 ? (
            <Section
              title="Customer hasn't heard from us"
              hint="The message is written and the new ETA is computed. Read it, adjust if you want, send it."
            >
              {grouped.awaitingMessage.map((row) => (
                <RiskCard
                  key={row.risk_flag_id}
                  row={row}
                  tz={tz}
                  messageEscalateMinutes={payload?.settings.customer_message_escalate_minutes ?? 20}
                  onChanged={() => void load(true)}
                />
              ))}
            </Section>
          ) : null}

          {grouped.handled.length > 0 ? (
            <Section title="Told, still at risk" hint="The customer knows. Cover the job or reschedule it.">
              {grouped.handled.map((row) => (
                <RiskCard
                  key={row.risk_flag_id}
                  row={row}
                  tz={tz}
                  messageEscalateMinutes={payload?.settings.customer_message_escalate_minutes ?? 20}
                  onChanged={() => void load(true)}
                />
              ))}
            </Section>
          ) : null}

          <div className="flex items-center gap-2 pt-2">
            <Switch id="show-resolved" checked={showResolved} onCheckedChange={setShowResolved} />
            <Label htmlFor="show-resolved" className="text-xs text-slate-600">
              Include the last 3 days of closed risks
            </Label>
          </div>

          {showResolved && grouped.closed.length > 0 ? (
            <Section title="Closed" hint="How the day recovered.">
              <Card>
                <CardContent className="p-0 divide-y divide-slate-100">
                  {grouped.closed.map((r) => (
                    <div key={r.risk_flag_id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-xs">
                      <span>
                        <span className="font-medium">{r.booking_ref}</span> · {customerName(r)} ·{" "}
                        {DELAY_EVENT_LABELS[r.delay_event_type]} · {dayIn(tz, r.scheduled_start_at)}
                      </span>
                      <span className="text-slate-500">
                        {r.status} — {r.resolution || "closed"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </Section>
          ) : null}

          <BufferTrail overrides={payload?.overrides || []} reassignments={payload?.reassignments || []} tz={tz} />
        </div>
      ) : tab === "backups" ? (
        <BackupsTab
          payload={payload}
          onCallDate={onCallDate}
          setOnCallDate={setOnCallDate}
          onChanged={() => void load(true)}
        />
      ) : tab === "projections" ? (
        <ProjectionsTab payload={payload} onChanged={() => void load(true)} />
      ) : (
        <SettingsTab payload={payload} onChanged={() => void load(true)} />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "ok" | "warning" | "danger";
}) {
  return (
    <Card
      className={cn(
        tone === "danger" && (value ?? 0) > 0
          ? "border-red-200 bg-red-50/50"
          : tone === "warning" && (value ?? 0) > 0
          ? "border-amber-200 bg-amber-50/50"
          : "border-slate-200",
      )}
    >
      <CardContent className="py-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-2xl font-semibold text-slate-900">{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ─── Buffer overrides + coverage moves ────────────────────────────────────────

function BufferTrail({
  overrides,
  reassignments,
  tz,
}: {
  overrides: OverrideRow[];
  reassignments: ReassignmentRow[];
  tz: string;
}) {
  if (overrides.length === 0 && reassignments.length === 0) return null;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {overrides.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Buffer overrides</CardTitle>
            <CardDescription className="text-xs">
              Bookings deliberately placed inside a crew&apos;s buffer. When a cascade happens,
              this is where it started.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-slate-100">
            {overrides.map((o) => (
              <div key={o.id} className="px-4 py-2 text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {o.bookings?.booking_number
                      ? `NVC-${String(o.bookings.booking_number).padStart(4, "0")}`
                      : o.booking_id.slice(0, 8)}{" "}
                    <span className="font-normal text-slate-600">
                      {o.bookings?.first_name} {o.bookings?.last_name}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    {o.actual_gap_minutes ?? "?"} of {o.required_buffer_minutes} min ·{" "}
                    {dayIn(tz, o.created_at)}
                  </span>
                </div>
                <p className="text-slate-600 mt-0.5">
                  {o.reason}
                  {o.created_by_name ? ` — ${o.created_by_name}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {reassignments.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Coverage moves</CardTitle>
            <CardDescription className="text-xs">
              Who took over, when, and why — linked to the delay that forced it.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-slate-100">
            {reassignments.map((r) => (
              <div key={r.id} className="px-4 py-2 text-xs">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-slate-900">
                    {r.from_cleaner_name || "unassigned"} → <span className="font-medium">{r.to_cleaner_name}</span>
                    {r.was_designated_backup ? (
                      <Badge className="ml-1.5 bg-indigo-600 hover:bg-indigo-600 text-[10px]">
                        Backup activated
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-slate-500">{dayIn(tz, r.created_at)}</span>
                </div>
                <p className="text-slate-600 mt-0.5">
                  {r.reason}
                  {r.created_by_name ? ` — ${r.created_by_name}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ─── On-call backups ──────────────────────────────────────────────────────────

function BackupsTab({
  payload,
  onCallDate,
  setOnCallDate,
  onChanged,
}: {
  payload: BoardPayload | null;
  onCallDate: string;
  setOnCallDate: (v: string) => void;
  onChanged: () => void;
}) {
  const [cleaners, setCleaners] = useState<
    { id: string; first_name: string | null; last_name: string | null; novara_score: number | null; home_zip: string | null }[]
  >([]);
  const [pick, setPick] = useState("");
  const [priority, setPriority] = useState("10");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      // Cast: novara_score post-dates the generated Supabase types.
      const { data } = await (supabase.from as any)("cleaners")
        .select("id, first_name, last_name, novara_score, home_zip")
        .eq("status", "active")
        .eq("approved", true)
        .eq("available_for_bookings", true)
        .order("novara_score", { ascending: false });
      setCleaners((data || []) as typeof cleaners);
    })();
  }, []);

  const designate = async () => {
    if (!pick) return void toast.error("Pick a cleaner.");
    setBusy(true);
    const { ok, data } = await callApi({
      action: "designate_backup",
      cleanerId: pick,
      onCallDate,
      priority: Number(priority) || 10,
      notes,
    });
    setBusy(false);
    if (!ok) return void toast.error(data.error || "Could not designate.");
    toast.success("On call for that day. Normal assignment, normal pay if activated.");
    setPick("");
    setNotes("");
    onChanged();
  };

  const release = async (id: string) => {
    const { ok, data } = await callApi({ action: "release_backup", id });
    if (!ok) return void toast.error(data.error || "Could not release.");
    onChanged();
  };

  const rows = (payload?.backups || []).filter((b) => b.active);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Designate backup cover</CardTitle>
          <CardDescription className="text-xs">
            Backups are ordinary contractors who told us they&apos;re available that day. Nothing
            changes about their pay — if a cascade or no-show activates them, they&apos;re simply
            assigned the job and paid normally for their tier.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Day</Label>
            <Input type="date" value={onCallDate} onChange={(e) => setOnCallDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cleaner</Label>
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger>
                <SelectValue placeholder="Pick from availability" />
              </SelectTrigger>
              <SelectContent>
                {cleaners.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                    {c.novara_score != null ? ` · ${c.novara_score}` : ""}
                    {c.home_zip ? ` · ${c.home_zip}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Order (lower first)</Label>
            <Input value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Note</Label>
            <div className="flex gap-2">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              <Button onClick={designate} disabled={busy}>
                {busy ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Add"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">On call for {onCallDate || "today"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">
              Nobody is on call. A day with no backup is a day where one oversleep costs a customer.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">
                      {b.cleaners?.first_name} {b.cleaners?.last_name}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      #{b.priority} · Novara {b.cleaners?.novara_score ?? "—"}
                      {b.cleaners?.home_zip ? ` · ${b.cleaners.home_zip}` : ""}
                      {b.zips.length ? ` · covering ${b.zips.join(", ")}` : ""}
                    </span>
                    {b.activated_at ? (
                      <Badge className="ml-2 bg-emerald-600 hover:bg-emerald-600 text-[10px]">
                        Activated
                      </Badge>
                    ) : null}
                    {b.notes ? <p className="text-xs text-slate-600 mt-0.5">{b.notes}</p> : null}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => void release(b.id)}>
                    Release
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Projections: the learning loop ───────────────────────────────────────────

function ProjectionsTab({
  payload,
  onChanged,
}: {
  payload: BoardPayload | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const variance = (payload?.variance || []).filter((v) => v.samples > 0);
  const chronic = variance.filter((v) => v.chronic);
  const offenders = payload?.lateStartOffenders || [];

  const apply = async (row: DurationVarianceRow) => {
    const key = `${row.service_type}:${row.home_size_id}`;
    const suggested = Number(row.suggested_multiplier ?? 1);
    if (
      !window.confirm(
        `Set the duration assumption for ${varianceHeadline(row)} to ×${suggested}?\n\n` +
          `This moves every projection built on it: buffers, at-risk ETAs, and the hours behind quotes.`,
      )
    ) {
      return;
    }
    setBusy(key);
    const { ok, data } = await callApi({
      action: "apply_duration_correction",
      serviceType: row.service_type,
      homeSizeId: row.home_size_id,
      multiplier: suggested,
      note: `Adopted from ${row.samples} measured jobs (${row.avg_variance_pct}% average variance).`,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not apply.");
    toast.success("Duration assumption corrected — projections updated.");
    onChanged();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Projected vs actual</CardTitle>
          <CardDescription className="text-xs">
            Measured on every completed job. A service type that chronically over-runs is a
            <span className="font-medium"> math problem</span> — correct the assumption and the
            buffers and prices built on it follow.
            {payload?.settings.variance_min_samples
              ? ` Flagged as chronic at ${payload.settings.variance_min_samples}+ jobs and 10%+ average variance.`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {variance.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">
              No completed jobs measured yet. Check-in and check-out times on finished jobs feed
              this automatically.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">Service × band</th>
                    <th className="text-right font-medium px-3 py-2">Jobs</th>
                    <th className="text-right font-medium px-3 py-2">Projected</th>
                    <th className="text-right font-medium px-3 py-2">Actual</th>
                    <th className="text-right font-medium px-3 py-2">Variance</th>
                    <th className="text-right font-medium px-3 py-2">Now</th>
                    <th className="text-right font-medium px-4 py-2">Correct to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {variance.map((v) => {
                    const key = `${v.service_type}:${v.home_size_id}`;
                    const pct = Number(v.avg_variance_pct ?? 0);
                    return (
                      <tr key={key} className={v.chronic ? "bg-amber-50/50" : undefined}>
                        <td className="px-4 py-2">
                          {varianceHeadline(v)}
                          {v.chronic ? (
                            <Badge variant="secondary" className="ml-1.5 text-[10px]">
                              chronic
                            </Badge>
                          ) : null}
                        </td>
                        <td className="text-right px-3 py-2">{v.samples}</td>
                        <td className="text-right px-3 py-2">{v.avg_projected_hours}h</td>
                        <td className="text-right px-3 py-2">{v.avg_actual_hours}h</td>
                        <td
                          className={cn(
                            "text-right px-3 py-2 font-medium",
                            pct > 10 ? "text-red-700" : pct < -10 ? "text-blue-700" : "text-slate-700",
                          )}
                        >
                          {pct > 0 ? "+" : ""}
                          {pct}%
                        </td>
                        <td className="text-right px-3 py-2 text-slate-500">
                          ×{Number(v.learned_multiplier ?? 1)}
                        </td>
                        <td className="text-right px-4 py-2">
                          {v.chronic &&
                          Number(v.suggested_multiplier) !== Number(v.learned_multiplier ?? 1) ? (
                            <Button size="sm" variant="outline" onClick={() => apply(v)} disabled={busy !== null}>
                              {busy === key ? (
                                <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                `×${v.suggested_multiplier}`
                              )}
                            </Button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Chronic late starts</CardTitle>
          <CardDescription className="text-xs">
            The other half of the diagnosis. A cleaner whose jobs habitually start late is a
            <span className="font-medium"> person problem</span> — a reliability signal that feeds
            the Novara Score, handled through the accountability ladder, not by padding durations.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {offenders.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">Nothing measured in the last 90 days.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {offenders.map((o) => (
                <div key={o.cleaner_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="font-medium text-slate-900">{o.cleaner_name}</span>
                  <span className="text-slate-600">
                    {o.late_starts}/{o.measured_jobs} jobs started late ({o.late_start_rate_pct}%) ·
                    avg {o.avg_late_minutes} min · {o.no_shows_90d} no-show(s) in 90d · Novara{" "}
                    {o.novara_score ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {chronic.length > 0 ? (
        <p className="text-xs text-slate-500">
          {chronic.length} service band{chronic.length === 1 ? "" : "s"} currently under-projected.
          Every correction is logged with the sample size it came from.
        </p>
      ) : null}
    </div>
  );
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

function SettingsTab({
  payload,
  onChanged,
}: {
  payload: BoardPayload | null;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleGuardSettings>(
    payload?.settings || SCHEDULE_GUARD_DEFAULTS,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (payload?.settings) setDraft(payload.settings);
  }, [payload?.settings]);

  const num = (key: keyof ScheduleGuardSettings, label: string, hint: string) => (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        value={String(draft[key] ?? "")}
        inputMode="numeric"
        onChange={(e) =>
          setDraft((d) => ({ ...d, [key]: Number(e.target.value.replace(/[^\d]/g, "")) || 0 }))
        }
      />
      <p className="text-[11px] text-slate-500">{hint}</p>
    </div>
  );

  const save = async () => {
    setBusy(true);
    const { ok, data } = await callApi({ action: "save_settings", settings: draft });
    setBusy(false);
    if (!ok) return void toast.error(data.error || "Could not save.");
    toast.success("Thresholds saved.");
    onChanged();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Buffer</CardTitle>
          <CardDescription className="text-xs">
            How much room a crew needs between consecutive jobs, measured from the earlier
            job&apos;s projected end. Travel time between the two addresses is added on top
            wherever both have been geocoded.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {num("buffer_minutes", "Required buffer (min)", "Default 60. Booking inside it is blocked unless an admin overrides with a reason.")}
          {num("travel_speed_mph", "Assumed drive speed (mph)", "Used to convert distance between two jobs into buffer minutes.")}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Switches</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.enforce_buffer_at_write}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, enforce_buffer_at_write: v }))}
              />
              <span className="text-xs text-slate-700">Block bookings that break the buffer</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.travel_time_enabled}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, travel_time_enabled: v }))}
              />
              <span className="text-xs text-slate-700">Include travel time</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Detection</CardTitle>
          <CardDescription className="text-xs">
            Measured against the arrival window and the projected end. The sweep runs every five
            minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {num("late_start_minutes", "Late start after (min)", "No en-route or check-in this far past the window raises a late-start event.")}
          {num("no_show_minutes", "No-show after (min)", "The firmer threshold: opens a QC reliability case and surfaces coverage. Must be later than the late-start alert.")}
          {num("overrun_grace_minutes", "Overrun grace (min)", "Slack past the projected end before an in-progress job counts as running over.")}
          {num("field_flag_overrun_minutes", "Assume on scope flag (min)", "Overrun assumed the moment a crew flags a job as bigger than scoped — no waiting for the clock.")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Customer contact</CardTitle>
          <CardDescription className="text-xs">
            The drafted heads-up appears the moment risk is detected. If nobody sends or dismisses
            it, admin gets pulled in — silence is treated as the failure, not the lateness.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {num("customer_message_escalate_minutes", "Escalate unsent after (min)", "How long a drafted heads-up may sit before admin is alerted.")}
          {num("risk_ack_escalate_minutes", "Escalate unacknowledged after (min)", "How long an at-risk booking may sit with nobody on it.")}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Auto-send</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.auto_send_initial_heads_up}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, auto_send_initial_heads_up: v }))}
              />
              <span className="text-xs text-slate-700">Send the first heads-up without a tap</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Off by default. Only ever applies to the initial heads-up; the reschedule
              conversation that follows is always a person&apos;s.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : null}
          Save thresholds
        </Button>
        <span className="text-xs text-slate-500">
          Operating timezone: {draft.timezone}. Duration assumptions are corrected from the
          Projections tab.
        </span>
      </div>
    </div>
  );
}
