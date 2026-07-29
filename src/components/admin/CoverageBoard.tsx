"use client";

// ─── Coverage board ───────────────────────────────────────────────────────────
//
// Every job that lost its cleaner and what is being done about it.
//
// The order of the page is the order of the priorities. Uncovered jobs sit at
// the top because nobody is coming to those and the customer needs a reschedule
// today, not an ETA. Then the live searches, urgent ones first. Then the bench:
// which days have nobody on call, and which days keep failing — because a
// pattern of uncovered jobs is a hiring problem, not a cleaner problem, and the
// only way that ever gets fixed is by being visible as one.
//
// Two things this screen is careful never to imply:
//   * a decline is not a black mark. Every declined offer is shown with that
//     said out loud, because the moment dispatchers read declines as disloyalty
//     they start force-assigning and cleaners start ignoring the texts.
//   * an uncovered job is not the cleaner's failure. It is ours.

import {
  RiAlarmWarningLine,
  RiCheckLine,
  RiFlashlightLine,
  RiHotelLine,
  RiLifebuoyLine,
  RiLoader4Line,
  RiSendPlaneLine,
  RiUserSharedLine,
} from "@remixicon/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callScheduleRisk } from "@/lib/schedule-risk-client";
import {
  COVERAGE_TRIGGER_LABELS,
  coverageHeadline,
  noticeLabel,
  type CoverageGapRow,
  type CoverageHealthRow,
  type CoverageOffer,
  type CoverageRow,
} from "@/lib/schedule-risk";
import { cn } from "@/lib/utils";

function clock(tz: string, iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

function day(tz: string, value: string | null | undefined): string {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
}

function minutesUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function customerName(row: CoverageRow): string {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Customer";
}

const OFFER_TONE: Record<CoverageOffer["status"], string> = {
  offered: "text-indigo-700",
  accepted: "text-emerald-700",
  declined: "text-slate-500",
  expired: "text-slate-400",
  withdrawn: "text-slate-400",
  failed: "text-orange-700",
};

const OFFER_LABEL: Record<CoverageOffer["status"], string> = {
  offered: "waiting",
  accepted: "accepted",
  declined: "passed",
  expired: "no answer",
  withdrawn: "withdrawn",
  failed: "couldn't reach",
};

// ─── One coverage search ──────────────────────────────────────────────────────

function CoverageCard({
  row,
  tz,
  onChanged,
}: {
  row: CoverageRow;
  tz: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [goodwill, setGoodwill] = useState(String((row.goodwill_credit_cents || 0) / 100));

  const live = row.status === "sourcing" || row.status === "offered";
  const deadlineIn = minutesUntil(row.hard_deadline_at);
  const giveUpIn = minutesUntil(row.give_up_at);
  const nextExpiryIn = minutesUntil(row.next_expiry_at);
  const candidates = row.candidates_snapshot || [];
  const untried = candidates.filter(
    (c) => !(row.offers || []).some((o) => o.cleaner_id === c.cleaner_id),
  );

  const sendOffers = async () => {
    setBusy("offer");
    const { ok, data } = await callScheduleRisk<{ offersSent: number }>({
      action: "offer_coverage",
      coverageRequestId: row.coverage_request_id,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not send offers.");
    if (!data.offersSent) {
      return void toast.warning(
        "Nobody left to ask — everybody who clears this job's window and zone has already been offered it.",
      );
    }
    toast.success(`${data.offersSent} offer${data.offersSent === 1 ? "" : "s"} out with a ${row.offer_window_minutes}-min window.`);
    onChanged();
  };

  const directAssign = async (cleanerId: string, name: string | null, bufferOk: boolean) => {
    const reason = window.prompt(
      `Assign ${row.booking_ref} straight to ${name} without waiting for them to accept. Why? (logged)`,
      `${COVERAGE_TRIGGER_LABELS[row.trigger]} on ${row.booking_ref} — covering to protect the customer's window.`,
    );
    if (!reason?.trim()) return;

    const urgency = window.prompt(
      "Skipping the offer cycle needs its reason on the record — what makes this window too tight to ask?",
      row.urgency_reason ||
        (row.is_str_turnover ? "STR turnover with a guest check-in deadline." : "Job is starting imminently."),
    );
    if (!urgency?.trim()) return;

    let bufferOverrideReason: string | undefined;
    if (!bufferOk) {
      const forced = window.prompt(
        `${name}'s own day has no buffer around this job. Forcing it is logged as an override — why is it the right call?`,
      );
      if (!forced?.trim()) return;
      bufferOverrideReason = forced.trim();
    }

    setBusy("assign");
    const { ok, data } = await callScheduleRisk({
      action: "direct_assign",
      bookingId: row.booking_id,
      toCleanerId: cleanerId,
      coverageRequestId: row.coverage_request_id,
      riskFlagId: row.risk_flag_id,
      delayEventId: row.delay_event_id,
      reason: reason.trim(),
      urgencyReason: urgency.trim(),
      bufferOverrideReason,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Direct assignment failed.");
    toast.success(`${row.booking_ref} assigned to ${name} — their portal has the full job.`);
    setAssigning(false);
    onChanged();
  };

  const markUncovered = async () => {
    const reason = window.prompt(
      `Mark ${row.booking_ref} as UNCOVERED?\n\nThis tells the customer we can't staff the visit and opens the reschedule with a goodwill credit. It's logged as a coverage gap on us, not against any cleaner.\n\nAnything to add?`,
      "",
    );
    if (reason === null) return;
    setBusy("uncovered");
    const { ok, data } = await callScheduleRisk({
      action: "mark_uncovered",
      coverageRequestId: row.coverage_request_id,
      reason: reason.trim() || undefined,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not mark it uncovered.");
    toast.success("Marked uncovered. The reschedule message is drafted on the at-risk board and admin is alerted.");
    onChanged();
  };

  const applyGoodwill = async () => {
    const cents = Math.round(Number(goodwill) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return void toast.error("Set an amount first.");
    setBusy("goodwill");
    const { ok, data } = await callScheduleRisk({
      action: "apply_goodwill",
      coverageRequestId: row.coverage_request_id,
      amountCents: cents,
    });
    setBusy(null);
    if (!ok) return void toast.error(data.error || "Could not apply the credit.");
    toast.success(`$${(cents / 100).toFixed(2)} credited to ${customerName(row)} — funded from margin.`);
    onChanged();
  };

  return (
    <Card
      className={cn(
        "border-l-4",
        row.status === "uncovered"
          ? "border-l-red-600 bg-red-50/50"
          : row.is_urgent && live
          ? "border-l-orange-500 bg-orange-50/40"
          : row.status === "covered"
          ? "border-l-emerald-500"
          : "border-l-indigo-400 bg-indigo-50/20",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.booking_ref}</span>
              <span className="font-normal text-slate-500">{customerName(row)}</span>
              <Badge variant={row.status === "uncovered" ? "destructive" : "secondary"}>
                {COVERAGE_TRIGGER_LABELS[row.trigger]}
              </Badge>
              {row.is_str_turnover ? (
                <Badge className="gap-1 bg-violet-600 hover:bg-violet-600">
                  <RiHotelLine className="w-3 h-3" /> STR turnover
                </Badge>
              ) : null}
              {row.is_urgent && live ? (
                <Badge variant="destructive" className="gap-1">
                  <RiFlashlightLine className="w-3 h-3" /> Urgent
                </Badge>
              ) : null}
              {row.status === "uncovered" ? <Badge variant="destructive">UNCOVERED</Badge> : null}
              {row.status === "covered" ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Covered</Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="mt-1 text-slate-700">{coverageHeadline(row)}</CardDescription>
          </div>
          <div className="shrink-0 text-right text-xs text-slate-600">
            <div>
              {day(tz, row.service_date)} · {clock(tz, row.scheduled_start_at)}
            </div>
            {row.notice_minutes != null ? (
              <div className="text-slate-500">{noticeLabel(row.notice_minutes)}</div>
            ) : null}
            {deadlineIn != null && live ? (
              <div className={cn("font-semibold", deadlineIn < 120 ? "text-red-700" : "text-slate-700")}>
                Deadline {clock(tz, row.hard_deadline_at)}
                {deadlineIn > 0 ? ` · in ${deadlineIn} min` : " · passed"}
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            Was: <span className="font-medium text-slate-800">{row.from_cleaner_name || "unassigned"}</span>
          </div>
          <div>{row.address ? `${row.address}, ${row.city || ""}` : "Address unavailable"}</div>
          {row.urgency_reason && live ? (
            <div className="text-orange-800 sm:col-span-2">{row.urgency_reason}</div>
          ) : null}
          {row.qc_issue_id ? (
            <div className="text-red-700">
              QC reliability case open against {row.from_cleaner_name || "the cleaner"} — a human decides the
              consequence
            </div>
          ) : null}
        </div>

        {/* The offer trail: who was asked, in what order, and why. */}
        {(row.offers || []).length > 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              Offers · designated backups first
            </p>
            <div className="space-y-1.5">
              {(row.offers || []).map((o) => {
                const expiresIn = minutesUntil(o.expires_at);
                return (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5 last:border-0 last:pb-0"
                  >
                    <div className="text-xs">
                      <span className="text-slate-400">{o.rank_position}.</span>{" "}
                      <span className="font-medium text-slate-900">{o.cleaner_name || "Cleaner"}</span>
                      {o.was_designated_backup ? (
                        <Badge className="ml-1.5 bg-indigo-600 text-[10px] hover:bg-indigo-600">On call</Badge>
                      ) : null}
                      {o.rank_reason ? (
                        <span className="ml-1.5 text-slate-500">{o.rank_reason}</span>
                      ) : null}
                      {o.status === "declined" ? (
                        <span className="ml-1.5 text-slate-500">
                          — passed{o.decline_reason ? `: ${o.decline_reason}` : ""}. Not a reliability penalty.
                        </span>
                      ) : null}
                    </div>
                    <span className={cn("text-[11px] font-medium", OFFER_TONE[o.status])}>
                      {OFFER_LABEL[o.status]}
                      {o.status === "offered" && expiresIn != null
                        ? expiresIn > 0
                          ? ` · ${expiresIn} min left`
                          : " · window closing"
                        : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {live ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={sendOffers} disabled={busy !== null || untried.length === 0}>
              {busy === "offer" ? (
                <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RiSendPlaneLine className="mr-1.5 h-4 w-4" />
              )}
              {untried.length === 0 ? "Everybody asked" : `Offer next ${Math.min(row.offers_per_round, untried.length)}`}
            </Button>
            <Button
              size="sm"
              variant={row.is_urgent ? "default" : "outline"}
              onClick={() => setAssigning((v) => !v)}
              disabled={busy !== null}
            >
              <RiFlashlightLine className="mr-1.5 h-4 w-4" />
              Assign now, skip the offer
            </Button>
            <Button size="sm" variant="ghost" className="text-red-700" onClick={markUncovered} disabled={busy !== null}>
              {busy === "uncovered" ? (
                <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <RiAlarmWarningLine className="mr-1.5 h-4 w-4" />
              )}
              Nobody can cover this
            </Button>
            {giveUpIn != null ? (
              <span className="self-center text-[11px] text-slate-500">
                {giveUpIn > 0
                  ? `Auto-marked uncovered in ${giveUpIn} min if nobody accepts`
                  : "Past the give-up point — the next cycle will mark it uncovered"}
                {nextExpiryIn != null && nextExpiryIn > 0 ? ` · next window closes in ${nextExpiryIn} min` : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Direct assignment: the urgent override, always with a written reason. */}
        {assigning && live ? (
          <div className="rounded-md border border-orange-200 bg-orange-50/60 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-orange-900">
              Direct-assign — skips the accept window, logged with its reason
            </p>
            {candidates.length === 0 ? (
              <p className="text-xs text-slate-600">
                Nobody clears this job&apos;s window, zone and stated limits. Reschedule with the customer rather
                than sending someone who can&apos;t finish it.
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
                        <Badge className="ml-1.5 bg-indigo-600 text-[10px] hover:bg-indigo-600">On call</Badge>
                      ) : null}
                      <span className="ml-1.5 text-slate-500">{c.rank_reason}</span>
                      {c.availability_note ? (
                        <span className="ml-1.5 text-slate-500">· {c.availability_note}</span>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant={c.buffer_ok ? "default" : "outline"}
                      onClick={() => directAssign(c.cleaner_id, c.name, c.buffer_ok)}
                      disabled={busy !== null}
                    >
                      {busy === "assign" ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : "Assign"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Uncovered: the reschedule and the goodwill gesture. */}
        {row.status === "uncovered" ? (
          <div className="rounded-md border border-red-200 bg-white p-3 space-y-2">
            <p className="text-xs text-slate-700">
              The reschedule message is drafted on the <span className="font-medium">At risk</span> tab. Cleaner pay
              is unaffected by this — the credit comes out of margin.
            </p>
            {row.goodwill_applied_at ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                <RiCheckLine className="h-4 w-4" />${(row.goodwill_credit_cents / 100).toFixed(2)} credit applied{" "}
                {clock(tz, row.goodwill_applied_at)}
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Goodwill credit ($)</Label>
                  <Input
                    value={goodwill}
                    onChange={(e) => setGoodwill(e.target.value)}
                    className="h-9 w-28 text-sm"
                    inputMode="decimal"
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={applyGoodwill} disabled={busy !== null}>
                  {busy === "goodwill" ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Credit the customer
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Bench depth ──────────────────────────────────────────────────────────────

function BenchDepth({
  health,
  gaps,
  tz,
  today,
  onPickDay,
}: {
  health: CoverageHealthRow[];
  gaps: CoverageGapRow[];
  tz: string;
  today: string;
  onPickDay: (date: string) => void;
}) {
  const upcoming = health.filter((h) => h.service_date >= today).slice(0, 21);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Bench depth by day</CardTitle>
          <CardDescription className="text-xs">
            A day with jobs and nobody on call is one oversleep away from a lost customer. Days carrying STR
            turnovers are called out separately — a guest check-in deadline is the least forgiving thing we run.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">Nothing on the books in the next three weeks.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Day</th>
                    <th className="px-3 py-2 text-right font-medium">Jobs</th>
                    <th className="px-3 py-2 text-right font-medium">STR</th>
                    <th className="px-3 py-2 text-right font-medium">On call</th>
                    <th className="px-4 py-2 text-left font-medium">Cover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {upcoming.map((h) => (
                    <tr
                      key={h.service_date}
                      className={cn(
                        h.str_day_exposed ? "bg-red-50/60" : h.uncovered_day ? "bg-amber-50/50" : undefined,
                      )}
                    >
                      <td className="px-4 py-2">{day(tz, h.service_date)}</td>
                      <td className="px-3 py-2 text-right">{h.jobs}</td>
                      <td className="px-3 py-2 text-right">{h.str_turnovers || "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {h.backups}
                        {h.backups_activated ? (
                          <span className="text-slate-400"> ({h.backups_activated} used)</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        {h.str_day_exposed ? (
                          <button
                            onClick={() => onPickDay(h.service_date)}
                            className="font-semibold text-red-700 underline decoration-dotted"
                          >
                            STR day with no bench — cover it
                          </button>
                        ) : h.uncovered_day ? (
                          <button
                            onClick={() => onPickDay(h.service_date)}
                            className="font-medium text-amber-800 underline decoration-dotted"
                          >
                            No backup — designate one
                          </button>
                        ) : (
                          <span className="text-emerald-700">Covered</span>
                        )}
                        {h.uncovered_jobs ? (
                          <span className="ml-1.5 text-red-700">
                            · {h.uncovered_jobs} uncovered job{h.uncovered_jobs === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Coverage gaps</CardTitle>
          <CardDescription className="text-xs">
            Jobs nobody could take, grouped by the day and job type that keep failing. This is a{" "}
            <span className="font-medium">bench-depth problem to hire against</span> — not a cleaner to discipline.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {gaps.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-600">
              No uncovered jobs on record. Every job that lost its cleaner found another one.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {gaps.map((g) => (
                <div key={`${g.service_date}:${g.client_type}:${g.service_type}`} className="px-4 py-2 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {day(tz, g.service_date)} · {g.weekday.trim()} · {g.service_type}
                      {g.client_type !== "residential" ? ` (${g.client_type})` : ""}
                    </span>
                    <span className="text-red-700">
                      {g.uncovered_jobs} uncovered
                      {g.uncovered_str_turnovers ? ` · ${g.uncovered_str_turnovers} STR` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 text-slate-600">
                    {g.backups_that_day} backup{g.backups_that_day === 1 ? "" : "s"} on call ·{" "}
                    {g.avg_candidates_available ?? 0} eligible cleaner
                    {Number(g.avg_candidates_available) === 1 ? "" : "s"} on average ·{" "}
                    {g.from_no_show ? `${g.from_no_show} from a no-show` : ""}
                    {g.from_no_show && g.from_cancellation ? ", " : ""}
                    {g.from_cancellation ? `${g.from_cancellation} from a cancellation` : ""}
                    {g.goodwill_cents ? ` · $${(g.goodwill_cents / 100).toFixed(2)} in goodwill` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── The tab ──────────────────────────────────────────────────────────────────

export default function CoverageBoard({
  coverage,
  health,
  gaps,
  tz,
  today,
  onChanged,
  onPickDay,
}: {
  coverage: CoverageRow[];
  health: CoverageHealthRow[];
  gaps: CoverageGapRow[];
  tz: string;
  today: string;
  onChanged: () => void;
  onPickDay: (date: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const uncovered = coverage.filter((r) => r.status === "uncovered" && !r.goodwill_applied_at);
  const live = coverage
    .filter((r) => r.status === "sourcing" || r.status === "offered")
    .sort((a, b) => Number(b.is_urgent) - Number(a.is_urgent));
  const closed = coverage.filter(
    (r) => r.status === "covered" || r.status === "cancelled" || (r.status === "uncovered" && r.goodwill_applied_at),
  );

  const runCycle = async () => {
    setBusy(true);
    const { ok, data } = await callScheduleRisk<{ result: Record<string, number> }>({
      action: "run_coverage_cycle",
    });
    setBusy(false);
    if (!ok) return void toast.error(data.error || "Could not run the cycle.");
    const r = data.result || {};
    toast.success(
      `${r.offers_sent ?? 0} offer(s) sent, ${r.offers_expired ?? 0} window(s) closed, ` +
        `${r.marked_uncovered ?? 0} marked uncovered.`,
    );
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-xs text-slate-600">
          Every job that lost its cleaner. Offers roll to the next candidate on their own every minute — this page is
          for the calls a person has to make: when to stop asking and assign, and when to admit nobody is coming and
          give the customer their day back.
        </p>
        <Button size="sm" variant="outline" onClick={runCycle} disabled={busy}>
          {busy ? (
            <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RiLifebuoyLine className="mr-1.5 h-4 w-4" />
          )}
          Roll the cycle now
        </Button>
      </div>

      {uncovered.length > 0 ? (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-red-800">Uncovered — nobody is coming</h2>
            <p className="text-xs text-slate-500">
              The highest-severity thing in this product. Reschedule the customer and credit them; the event is
              logged against our bench, not against a cleaner.
            </p>
          </div>
          {uncovered.map((r) => (
            <CoverageCard key={r.coverage_request_id} row={r} tz={tz} onChanged={onChanged} />
          ))}
        </div>
      ) : null}

      {live.length > 0 ? (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Looking for cover</h2>
            <p className="text-xs text-slate-500">
              Designated backups are asked first. A pass is recorded and rolled on — it never counts against the
              cleaner who answered honestly.
            </p>
          </div>
          {live.map((r) => (
            <CoverageCard key={r.coverage_request_id} row={r} tz={tz} onChanged={onChanged} />
          ))}
        </div>
      ) : uncovered.length === 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-8 text-center">
            <RiUserSharedLine className="mx-auto mb-2 h-8 w-8 text-emerald-600" />
            <p className="text-sm font-medium text-emerald-900">Every job on the schedule has a cleaner.</p>
            <p className="mt-1 text-xs text-emerald-800/80">
              A no-show or a cancellation opens a search here automatically.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <BenchDepth health={health} gaps={gaps} tz={tz} today={today} onPickDay={onPickDay} />

      {closed.length > 0 ? (
        <div className="space-y-2">
          <button
            onClick={() => setShowClosed((v) => !v)}
            className="text-xs font-medium text-slate-600 underline decoration-dotted"
          >
            {showClosed ? "Hide" : "Show"} {closed.length} closed coverage move
            {closed.length === 1 ? "" : "s"}
          </button>
          {showClosed
            ? closed.map((r) => (
                <CoverageCard key={r.coverage_request_id} row={r} tz={tz} onChanged={onChanged} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
