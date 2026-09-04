"use client";

import { RiLoader4Line, RiSendPlaneLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface HistoryRow {
  entry_id: string;
  cycle_started_at: string;
  outcome: string;
  submitted_at: string | null;
  claimed_job_count: number;
  answers: Record<string, unknown> | null;
  availability_updated: boolean;
  counts_toward_interval?: boolean | null;
}

function label(outcome: string, answers?: Record<string, unknown> | null) {
  const roster = String(answers?.rosterAction || answers?.roster_action || "");
  if (roster === "terminate") return "Terminated";
  if (roster === "inactive") return "Set inactive";
  if (outcome === "completed") return "Completed";
  if (outcome === "needs_review") return "Needs review";
  if (outcome === "no_response") return "No response";
  return "Pending";
}

export default function PulseCheckHistory({
  cleanerId,
  cleanerName,
  cleanerStatus,
}: {
  cleanerId: string;
  cleanerName?: string;
  cleanerStatus?: string | null;
}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await (supabase.from as any)("cleaner_pulse_status_v1")
      .select("entry_id, cycle_started_at, outcome, submitted_at, claimed_job_count, answers, availability_updated, counts_toward_interval")
      .eq("cleaner_id", cleanerId)
      .order("cycle_started_at", { ascending: false })
      .limit(24);
    setRows((data || []) as HistoryRow[]);
  }, [cleanerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const terminated = String(cleanerStatus || "").toLowerCase() === "terminated";
  const name = cleanerName?.trim() || "this contractor";

  const send = async () => {
    if (terminated) return;
    const ok = window.confirm(
      `Send a pulse-check SMS and email to ${name} now? If they choose to leave or take a month away, that will update their roster status.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const res = await fetch("/api/admin/pulse-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token || ""}`,
        },
        body: JSON.stringify({ action: "send_one", cleanerId }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        emailed?: boolean;
        smsSent?: boolean;
        reused?: boolean;
      };
      if (!res.ok) throw new Error(d.error || "Could not send pulse check");
      const bits = [
        d.emailed ? "email sent" : "email not sent",
        d.smsSent ? "SMS sent" : "SMS not sent",
        d.reused ? "existing link resent" : null,
      ].filter(Boolean);
      toast.success(`Pulse check: ${bits.join(" · ")}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send pulse check");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pulse check</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void send()}
          disabled={busy || terminated}
          title={terminated ? "Terminated contractors cannot receive a pulse check" : "Send SMS and email now"}
        >
          {busy ? (
            <RiLoader4Line className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RiSendPlaneLine className="mr-1 h-3.5 w-3.5" />
          )}
          Send pulse check
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Sends the same stay / pause / leave form plus claimable jobs. Does not wait for idle time and
        does not move the recurring cycle. Leaving or a month away will update their roster.
      </p>
      {rows && rows.length > 0 ? (
        rows.map((r) => (
          <div key={r.entry_id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
            <span className="font-semibold text-slate-800">
              {new Date(r.cycle_started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>{" "}
            <Badge variant="outline" className="ml-1 text-[9px] py-0">
            {label(r.outcome, r.answers)}
            </Badge>
            {r.counts_toward_interval === false ? (
              <Badge variant="outline" className="ml-1 text-[9px] py-0">
                one-off
              </Badge>
            ) : null}
            {r.claimed_job_count > 0 ? (
              <Badge className="ml-1 bg-emerald-100 text-emerald-800 text-[9px] py-0">
                claimed {r.claimed_job_count} job{r.claimed_job_count === 1 ? "" : "s"}
              </Badge>
            ) : r.outcome === "completed" ? (
              <span className="text-slate-500"> — status update</span>
            ) : null}
            {r.availability_updated ? <span className="text-slate-500"> · availability updated</span> : null}
          </div>
        ))
      ) : (
        <p className="text-[11px] text-slate-400">No pulse checks sent yet.</p>
      )}
    </div>
  );
}
