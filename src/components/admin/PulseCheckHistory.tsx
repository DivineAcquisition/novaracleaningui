"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

interface HistoryRow {
  entry_id: string;
  cycle_started_at: string;
  outcome: string;
  submitted_at: string | null;
  claimed_job_count: number;
  answers: Record<string, unknown> | null;
  availability_updated: boolean;
}

function label(outcome: string) {
  if (outcome === "completed") return "Completed";
  if (outcome === "needs_review") return "Needs review";
  if (outcome === "no_response") return "No response";
  return "Pending";
}

export default function PulseCheckHistory({ cleanerId }: { cleanerId: string }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from as any)("cleaner_pulse_status_v1")
        .select("entry_id, cycle_started_at, outcome, submitted_at, claimed_job_count, answers, availability_updated")
        .eq("cleaner_id", cleanerId)
        .order("cycle_started_at", { ascending: false })
        .limit(24);
      if (!cancelled) setRows((data || []) as HistoryRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pulse check history</p>
      {rows.map((r) => (
        <div key={r.entry_id} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
          <span className="font-semibold text-slate-800">
            {new Date(r.cycle_started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>{" "}
          <Badge variant="outline" className="ml-1 text-[9px] py-0">
            {label(r.outcome)}
          </Badge>
          {r.claimed_job_count > 0 ? (
            <Badge className="ml-1 bg-emerald-100 text-emerald-800 text-[9px] py-0">
              claimed {r.claimed_job_count} job{r.claimed_job_count === 1 ? "" : "s"}
            </Badge>
          ) : r.outcome === "completed" ? (
            <span className="text-slate-500"> — status update</span>
          ) : null}
          {r.availability_updated ? <span className="text-slate-500"> · availability updated</span> : null}
        </div>
      ))}
    </div>
  );
}
