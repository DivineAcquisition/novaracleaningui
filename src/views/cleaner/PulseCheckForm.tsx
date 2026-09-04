"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  RiCalendarLine,
  RiCheckLine,
  RiLoader4Line,
  RiMapPin2Line,
  RiMoneyDollarCircleLine,
  RiTimeLine,
} from "@remixicon/react";

import { TokenPageShell, TokenPanel } from "@/components/token/TokenPageShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EMPTY_PULSE_DRAFT,
  PULSE_ABILITY_OPTIONS,
  PULSE_DAYS,
  PULSE_STATUS_OPTIONS,
  PULSE_TIME_AWAY_OPTIONS,
  pulseDraftComplete,
  rosterActionFromDraft,
  type PulseDraft,
} from "@/lib/pulse-check/answers";
import { formatAvgWeeklyPay } from "@/lib/pulse-check/earnings";
import type { PulseJobCard } from "@/lib/pulse-check/jobs";
import { formatRosterDate } from "@/lib/pulse-check/roster";

type Payload = {
  ok: true;
  submitted: boolean;
  outcome: string;
  expiresAt: string | null;
  cleaner: { firstName: string; name: string; status?: string | null };
  draft: PulseDraft;
  onFile: { preferredWorkDays: string[]; noWorkAfter: string; noWorkBefore: string };
  claimedJobIds: string[];
  jobs: PulseJobCard[];
  avgWeeklyPayCents?: number | null;
  respondWithinDays?: number | null;
  rosterAction?: string | null;
  inactiveUntil?: string | null;
  reapplyEligibleAt?: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Payload }
  | { kind: "blocked"; message: string };

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function doneCopy(args: {
  outcome: string | null;
  rosterAction: string | null;
  inactiveUntil: string | null;
  reapplyEligibleAt: string | null;
}): { title: string; body: string } {
  if (args.rosterAction === "terminate") {
    const until = formatRosterDate(args.reapplyEligibleAt);
    return {
      title: "Your contractor account is closed",
      body: until
        ? `You chose to leave the active roster. Your Novara contractor account is terminated as of today. You can apply again after ${until}.`
        : "You chose to leave the active roster. Your Novara contractor account is terminated as of today. You can apply again in 3 months.",
    };
  }
  if (args.rosterAction === "inactive") {
    const until = formatRosterDate(args.inactiveUntil);
    return {
      title: "You're on pause",
      body: until
        ? `We've set you inactive until ${until}. You won't be offered new jobs during that window. The office can turn you back on when you're ready.`
        : "We've set you inactive. You won't be offered new jobs until the office reactivates you.",
    };
  }
  if (args.outcome === "needs_review") {
    return {
      title: "Thanks — we'll be in touch",
      body: "Someone from the office will follow up. Your roster status was not changed from this answer.",
    };
  }
  return {
    title: "Great — you're all set",
    body: "You're still on the Novara roster. If you claimed a job below, it's on your schedule.",
  };
}

export default function PulseCheckForm() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState<PulseDraft>(EMPTY_PULSE_DRAFT);
  const [jobs, setJobs] = useState<PulseJobCard[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [submittedOutcome, setSubmittedOutcome] = useState<string | null>(null);
  const [submittedRoster, setSubmittedRoster] = useState<string | null>(null);
  const [submittedInactiveUntil, setSubmittedInactiveUntil] = useState<string | null>(null);
  const [submittedReapply, setSubmittedReapply] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "This link isn't valid." });
      return;
    }
    try {
      const res = await fetch(`/api/cleaner/pulse/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || "This link isn't valid.");
      }
      const data = json as Payload;
      setState({ kind: "ready", data });
      setDraft(data.draft);
      setJobs(data.jobs || []);
      if (data.submitted) {
        setSubmittedOutcome(data.outcome);
        setSubmittedRoster(data.rosterAction || null);
        setSubmittedInactiveUntil(data.inactiveUntil || null);
        setSubmittedReapply(data.reapplyEligibleAt || null);
      }
    } catch (e) {
      setState({ kind: "blocked", message: e instanceof Error ? e.message : "This link isn't valid." });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (next: PulseDraft) => {
      if (!token || submittedOutcome) return;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/cleaner/pulse/${encodeURIComponent(token)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: next }),
        });
        if (!res.ok) throw new Error("save failed");
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch {
        setSaveState("error");
      }
    },
    [token, submittedOutcome],
  );

  const updateDraft = (patch: Partial<PulseDraft>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if (patch.status && patch.status !== prev.status) {
        next.acknowledged = false;
        if (patch.status !== "step_away") next.timeAway = "";
        if (patch.status !== "still_active") {
          next.ability = "";
          next.abilityNote = "";
        }
      }
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(next), 400);
      return next;
    });
  };

  const submit = async () => {
    if (!pulseDraftComplete(draft) || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cleaner/pulse/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", draft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(json?.error || "Could not submit.");
      setSubmittedOutcome(String(json.outcome || "completed"));
      setSubmittedRoster(json.rosterAction || rosterActionFromDraft(draft));
      setSubmittedInactiveUntil(json.inactiveUntil || null);
      setSubmittedReapply(json.reapplyEligibleAt || null);
      if (json.rosterAction === "terminate" || json.rosterAction === "inactive") {
        setJobs([]);
      }
    } catch (e) {
      setClaimNotice(e instanceof Error ? e.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  const claim = async (job: PulseJobCard) => {
    if (!job.bookingId || claimingId) return;
    setClaimingId(job.bookingId);
    setClaimNotice(null);
    try {
      const res = await fetch(`/api/cleaner/pulse/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "claim", bookingId: job.bookingId }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.taken || json?.ok === false) {
        setJobs((prev) => prev.filter((j) => j.bookingId !== job.bookingId));
        setClaimNotice(json?.message || "That job was just claimed by someone else. It's been removed from your list.");
        return;
      }
      if (!res.ok) throw new Error(json?.error || json?.message || "Could not claim this job.");
      setJobs((prev) => prev.filter((j) => j.bookingId !== job.bookingId));
      setClaimNotice(json?.message || "It's yours — this job is now on your schedule.");
    } catch (e) {
      setClaimNotice(e instanceof Error ? e.message : "Could not claim this job.");
    } finally {
      setClaimingId(null);
    }
  };

  if (state.kind === "loading") {
    return (
      <TokenPageShell eyebrow="Pulse check" title="Just a moment">
        <TokenPanel>
          <p className="flex items-center justify-center gap-2 text-sm text-slate-600">
            <RiLoader4Line className="h-4 w-4 animate-spin" /> Opening your check-in…
          </p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <TokenPageShell eyebrow="Pulse check" title="This link isn't available">
        <TokenPanel>
          <p className="text-sm text-slate-700">{state.message}</p>
        </TokenPanel>
      </TokenPageShell>
    );
  }

  const first = state.data.cleaner.firstName || "there";
  const done = Boolean(submittedOutcome);
  const staying = draft.status === "still_active";
  const pausing = draft.status === "step_away";
  const leaving = draft.status === "leave";
  const monthAway = pausing && draft.timeAway === "1_month";
  const terminatePath = leaving || monthAway;
  const showJobs = staying && !done && jobs.length > 0;
  const earningsLine = formatAvgWeeklyPay(state.data.avgWeeklyPayCents ?? null);
  const respondDays = state.data.respondWithinDays && state.data.respondWithinDays > 0
    ? state.data.respondWithinDays
    : 3;
  const finished = doneCopy({
    outcome: submittedOutcome,
    rosterAction: submittedRoster,
    inactiveUntil: submittedInactiveUntil,
    reapplyEligibleAt: submittedReapply,
  });

  let submitLabel = "Submit";
  if (leaving || monthAway) submitLabel = "I understand — close my account";
  else if (pausing) submitLabel = "Set me inactive";

  return (
    <TokenPageShell
      eyebrow="Pulse check"
      title={`Hi ${first}`}
      subtitle={`Are you still willing to be a Novara contractor? Submit within ${respondDays} days or we close the account.`}
    >
      {done ? (
        <TokenPanel>
          <p className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <RiCheckLine className="h-5 w-5 text-emerald-600" />
            {finished.title}
          </p>
          <p className="mt-2 text-sm text-slate-600">{finished.body}</p>
        </TokenPanel>
      ) : (
        <TokenPanel>
          <div className="space-y-6">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-slate-900">
                Are you still willing to be a contractor for Novara Cleaning?
              </legend>
              <p className="text-xs text-slate-500">
                If you don&apos;t submit this form within {respondDays} days, we close your contractor
                account. You cannot reapply for 3 months. We keep the roster for active, reliable
                contractors.
              </p>
              {PULSE_STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm",
                    draft.status === opt.value
                      ? "border-primary bg-primary/[0.04]"
                      : "border-slate-200 bg-white",
                  )}
                >
                  <input
                    type="radio"
                    name="status"
                    className="mt-1"
                    checked={draft.status === opt.value}
                    onChange={() => updateDraft({ status: opt.value })}
                  />
                  <span>
                    <span className="font-medium text-slate-900">{opt.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {staying ? (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                Great — you stay on the roster and can keep taking jobs.
              </p>
            ) : null}

            {pausing ? (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="text-sm text-amber-950">
                  We keep the Novara roster for contractors who are <strong>active and reliable</strong> —
                  customers need a crew that can actually take jobs. A short pause is OK: we&apos;ll set
                  you inactive so you don&apos;t get new offers. If you need a full month away, we close
                  the contractor account.
                </p>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-900">How long do you need away?</legend>
                  {PULSE_TIME_AWAY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm",
                        draft.timeAway === opt.value
                          ? "border-amber-400 bg-white"
                          : "border-amber-200 bg-white",
                      )}
                    >
                      <input
                        type="radio"
                        name="timeAway"
                        className="mt-1"
                        checked={draft.timeAway === opt.value}
                        onChange={() => updateDraft({ timeAway: opt.value, acknowledged: false })}
                      />
                      <span>
                        <span className="font-medium text-slate-900">{opt.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {opt.value === "1_month"
                            ? "This will terminate your contractor account"
                            : `We'll set you inactive for ${opt.label}`}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {draft.timeAway === "1_week" || draft.timeAway === "2_weeks" ? (
                  <p className="text-xs text-amber-900">
                    Submitting sets you <strong>inactive</strong> for {draft.timeAway === "1_week" ? "1 week" : "2 weeks"}.
                    You won&apos;t be offered new jobs until the office turns you back on.
                  </p>
                ) : null}
                {monthAway ? (
                  <>
                    <p className="text-sm text-amber-950">{earningsLine}</p>
                    <p className="text-sm text-amber-950">
                      A full month away <strong>terminates</strong> your contractor account today. You
                      cannot reapply for 3 months.
                    </p>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-950">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={draft.acknowledged}
                        onChange={(e) => updateDraft({ acknowledged: e.target.checked })}
                      />
                      <span>
                        I understand a month away <strong>terminates</strong> my Novara contractor account
                        because we need people who can stay active, and I cannot reapply for 3 months.
                      </span>
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}

            {leaving ? (
              <div className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
                <p className="text-sm font-semibold text-rose-950">Before you go</p>
                <p className="text-sm text-rose-950">{earningsLine}</p>
                <p className="text-sm text-rose-950">
                  If you continue, your contractor account is <strong>terminated today</strong>. That
                  means no new jobs, and you <strong>cannot reapply for 3 months</strong>.
                </p>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-rose-950">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.acknowledged}
                    onChange={(e) => updateDraft({ acknowledged: e.target.checked })}
                  />
                  <span>
                    I understand this will terminate my Novara contractor account, and I cannot reapply
                    for 3 months.
                  </span>
                </label>
              </div>
            ) : null}

            {staying ? (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-900">
                    Is there anything currently preventing you from taking jobs?
                  </legend>
                  {PULSE_ABILITY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm",
                        draft.ability === opt.value
                          ? "border-primary bg-primary/[0.04]"
                          : "border-slate-200 bg-white",
                      )}
                    >
                      <input
                        type="radio"
                        name="ability"
                        className="mt-1"
                        checked={draft.ability === opt.value}
                        onChange={() => updateDraft({ ability: opt.value })}
                      />
                      <span className="font-medium text-slate-900">{opt.label}</span>
                    </label>
                  ))}
                  {draft.ability === "blocked" ? (
                    <Textarea
                      value={draft.abilityNote}
                      onChange={(e) => updateDraft({ abilityNote: e.target.value })}
                      placeholder="Brief note — what's in the way?"
                      className="mt-1"
                      rows={3}
                    />
                  ) : null}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-900">
                    What&apos;s your current availability?
                  </legend>
                  <p className="text-xs text-slate-500">Pre-filled from what&apos;s on file. Confirm or correct it.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PULSE_DAYS.map((d) => {
                      const on = draft.preferredWorkDays.includes(d.value);
                      return (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() =>
                            updateDraft({
                              preferredWorkDays: on
                                ? draft.preferredWorkDays.filter((x) => x !== d.value)
                                : [...draft.preferredWorkDays, d.value],
                            })
                          }
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold",
                            on
                              ? "border-primary bg-primary text-white"
                              : "border-slate-200 bg-white text-slate-700",
                          )}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="text-xs text-slate-600">
                      No work before
                      <input
                        value={draft.noWorkBefore}
                        onChange={(e) => updateDraft({ noWorkBefore: e.target.value })}
                        placeholder="e.g. 9am"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-xs text-slate-600">
                      No work after
                      <input
                        value={draft.noWorkAfter}
                        onChange={(e) => updateDraft({ noWorkAfter: e.target.value })}
                        placeholder="e.g. 3pm"
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                </fieldset>
              </>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-400">
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "saved"
                    ? "Saved"
                    : saveState === "error"
                      ? "Couldn't save — keep this tab open"
                      : "Progress saves automatically"}
              </p>
              <Button
                type="button"
                onClick={() => void submit()}
                disabled={!pulseDraftComplete(draft) || submitting}
                className={cn("min-w-[140px]", terminatePath && "bg-rose-700 hover:bg-rose-800")}
              >
                {submitting ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : submitLabel}
              </Button>
            </div>
          </div>
        </TokenPanel>
      )}

      {claimNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {claimNotice}
        </div>
      ) : null}

      {showJobs ? (
        <div className="space-y-3">
          <h2 className="text-center text-sm font-semibold text-slate-900">Jobs you can take</h2>
          {jobs.map((job) => (
            <TokenPanel key={job.bookingId || job.jobId || job.dateLabel}>
              <div className="space-y-2">
                <p className="font-semibold text-slate-900">{job.serviceLabel}</p>
                <p className="flex items-center gap-1.5 text-sm text-slate-600">
                  <RiCalendarLine className="h-4 w-4 shrink-0" /> {job.dateLabel}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-slate-600">
                  <RiTimeLine className="h-4 w-4 shrink-0" /> {job.timeLabel}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-slate-600">
                  <RiMapPin2Line className="h-4 w-4 shrink-0" /> {job.zoneLabel}
                </p>
                <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                  <RiMoneyDollarCircleLine className="h-4 w-4 shrink-0" />
                  {dollars(job.payCents)}
                  <span className="font-normal text-slate-500"> · {job.payLabel}</span>
                </p>
                {job.bookingId ? (
                  <Button
                    type="button"
                    className="mt-2 w-full"
                    disabled={claimingId !== null}
                    onClick={() => void claim(job)}
                  >
                    {claimingId === job.bookingId ? (
                      <RiLoader4Line className="h-4 w-4 animate-spin" />
                    ) : (
                      `Claim · ${dollars(job.payCents)}`
                    )}
                  </Button>
                ) : null}
              </div>
            </TokenPanel>
          ))}
        </div>
      ) : null}
    </TokenPageShell>
  );
}
