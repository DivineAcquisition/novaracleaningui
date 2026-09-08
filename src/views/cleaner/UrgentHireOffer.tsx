"use client";

// Tokenized Urgent Hire offer. Recipients finish remaining onboarding
// (supply checklist, agreement, payout — not background check) and the
// first to accept wins. Losers see a clear "no longer available" message
// and keep whatever progress they made.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiCircleLine,
  RiFlashlightLine,
  RiLoader4Line,
  RiMapPin2Line,
  RiTimeLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface OfferPayload {
  ok: boolean;
  error?: string;
  code?: string;
  taken?: boolean;
  takenMessage?: string | null;
  canAccept?: boolean;
  remaining?: string[];
  backgroundCheckRequired?: boolean;
  portalUrl?: string;
  job?: {
    serviceType: string;
    dateLabel: string;
    timeWindow: string;
    zone: string;
    payCents: number;
    firstJobNote: string;
  };
  broadcast?: {
    status: string;
    fillDeadlineAt: string;
    payPercent: number;
    firstJobOnly: boolean;
  };
  steps?: {
    supplies: string | null;
    agreement: string | null;
    payout: string | null;
  };
  checklist?: { valid: boolean; ready: boolean; fresh: boolean; percent: number };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: OfferPayload }
  | { kind: "claimed"; data: OfferPayload }
  | { kind: "blocked"; message: string };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Novara Cleaning</p>
          <p className="text-xs text-slate-500">Urgent Hire</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
  );
}

function money(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

async function invoke(body: Record<string, unknown>): Promise<OfferPayload> {
  const { data, error } = await supabase.functions.invoke("urgent-hire", { body });
  if (error) {
    let message = error.message || "Request failed.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = (await ctx.json()) as OfferPayload;
        if (parsed?.error) return parsed;
      }
    } catch {
      /* keep */
    }
    return { ok: false, error: message };
  }
  return (data || { ok: false, error: "Empty response" }) as OfferPayload;
}

function StepRow({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string | null;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="flex items-start gap-2 text-sm text-slate-800">
        {done ? (
          <RiCheckboxCircleFill className="mt-0.5 h-4 w-4 text-emerald-600" />
        ) : (
          <RiCircleLine className="mt-0.5 h-4 w-4 text-slate-300" />
        )}
        {label}
      </span>
      {!done && href ? (
        <a href={href} className="text-xs font-semibold text-violet-700 hover:underline shrink-0">
          Complete
        </a>
      ) : null}
    </li>
  );
}

export default function UrgentHireOffer() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: "blocked", message: "That link isn't valid." });
      return;
    }
    const data = await invoke({ action: "get", token });
    if (data.taken || data.code === "taken" || data.code === "expired") {
      setState({ kind: "ready", data: { ...data, taken: true } });
      return;
    }
    if (!data.ok) {
      setState({ kind: "blocked", message: data.error || "That link isn't valid." });
      return;
    }
    setState({ kind: "ready", data });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    setAccepting(true);
    const data = await invoke({ action: "accept", token });
    setAccepting(false);
    if (data.ok && (data.code === "claimed" || data.code === "already_yours")) {
      setState({ kind: "claimed", data });
      return;
    }
    if (data.taken || data.code === "taken" || data.code === "expired") {
      setState({ kind: "ready", data: { ...data, taken: true } });
      return;
    }
    setState({ kind: "ready", data });
  };

  if (state.kind === "loading") {
    return (
      <Shell>
        <Card>
          <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
            <RiLoader4Line className="h-5 w-5 animate-spin" />
            Loading offer…
          </div>
        </Card>
      </Shell>
    );
  }

  if (state.kind === "blocked") {
    return (
      <Shell>
        <Card>
          <p className="text-sm font-medium text-slate-900">Link unavailable</p>
          <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        </Card>
      </Shell>
    );
  }

  const data = state.data;
  const job = data.job;

  if (state.kind === "claimed") {
    return (
      <Shell>
        <Card>
          <div className="flex items-start gap-3">
            <RiCheckboxCircleFill className="mt-0.5 h-6 w-6 text-emerald-600" />
            <div>
              <p className="text-lg font-semibold text-slate-900">It&apos;s yours</p>
              <p className="mt-1 text-sm text-slate-600">
                The full job — address, access, checklist, and your pay — is in your portal now.
              </p>
              {job ? (
                <p className="mt-3 text-sm text-slate-700">
                  {job.serviceType} · {job.dateLabel} · {money(job.payCents)}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-violet-800">{job?.firstJobNote}</p>
              <Button asChild className="mt-4 bg-violet-700 hover:bg-violet-800">
                <a href={data.portalUrl || "https://contractor.novaracleaning.com/cleaner/mobile-dashboard"}>
                  Open the job
                </a>
              </Button>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  if (data.taken) {
    return (
      <Shell>
        <Card>
          <div className="flex items-start gap-3">
            <RiAlertLine className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-slate-900">This job is no longer available</p>
              <p className="mt-2 text-sm text-slate-600">
                {data.takenMessage ||
                  "Someone else finished first. Your onboarding progress is saved — you're still in the pipeline."}
              </p>
            </div>
          </div>
        </Card>
      </Shell>
    );
  }

  const remaining = new Set(data.remaining || []);
  const steps = data.steps || { supplies: null, agreement: null, payout: null };

  return (
    <Shell>
      <Card>
        <div className="flex items-start gap-2">
          <RiFlashlightLine className="mt-0.5 h-5 w-5 text-violet-700" />
          <div>
            <p className="text-lg font-semibold text-slate-900">{job?.serviceType || "Cleaning"}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
              <RiTimeLine className="h-3.5 w-3.5" />
              {job?.dateLabel}
              {job?.timeWindow ? ` · ${job.timeWindow}` : ""}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
              <RiMapPin2Line className="h-3.5 w-3.5" />
              {job?.zone} <span className="text-slate-400">· exact address after you&apos;re assigned</span>
            </p>
            <p className="mt-3 text-2xl font-extrabold text-violet-800">
              {money(job?.payCents || 0)}
              <span className="ml-2 text-sm font-semibold text-violet-600">
                {data.broadcast?.payPercent}% of job value
              </span>
            </p>
            <p className="mt-1 text-xs text-violet-800">{job?.firstJobNote}</p>
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold text-slate-900">Finish remaining steps, then accept</p>
        <p className="mt-1 text-xs text-slate-500">
          The job goes to whoever finishes and accepts soonest. Background check is not required
          for this Urgent Hire.
        </p>
        <ul className="mt-4 space-y-2.5">
          <StepRow
            done={!remaining.has("supplies")}
            label={
              data.checklist && !data.checklist.fresh && data.checklist.ready
                ? "Re-confirm your supply checklist (it went stale)"
                : "Supply / equipment checklist"
            }
            href={steps.supplies}
          />
          <StepRow done={!remaining.has("agreement")} label="Sign contractor agreement" href={steps.agreement} />
          <StepRow done={!remaining.has("payout")} label="Payout setup (W-9 / payment method)" href={steps.payout} />
        </ul>
        {data.error && data.code === "steps_remaining" ? (
          <p className="mt-3 text-sm text-amber-800">{data.error}</p>
        ) : null}
        <Button
          className="mt-5 w-full bg-violet-700 hover:bg-violet-800"
          disabled={accepting || remaining.size > 0 || data.canAccept === false}
          onClick={() => void accept()}
        >
          {accepting ? (
            <>
              <RiLoader4Line className="mr-2 h-4 w-4 animate-spin" />
              Claiming…
            </>
          ) : remaining.size > 0 ? (
            "Finish the steps above to accept"
          ) : data.canAccept === false ? (
            "This offer isn't open"
          ) : (
            "Accept this job"
          )}
        </Button>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          If someone else claims it first, you&apos;ll keep everything you already completed.
        </p>
      </Card>
    </Shell>
  );
}
