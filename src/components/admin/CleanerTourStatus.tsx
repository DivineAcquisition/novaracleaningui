"use client";

// ─── Walkthrough status, for one contractor ──────────────────────────────────
//
// Context for a conversation, and nothing else. The use case that justifies
// storing this at all: a contractor says they didn't know photos were required
// before completion, and somebody needs to know whether they were ever shown.
// That's it.
//
// So this panel deliberately does not:
//   · show a percentage or a score (a number invites a target, and a target
//     turns "did they see it?" into something people manage)
//   · offer a way to nag, assign, or require anything
//   · treat a skip as a failure — skipping is an answer, and the panel says
//     "Skipped" rather than colouring it red
//
// It reads straight from cleaner_tour_progress under the admin RLS policy.
// The standing rules (including "completed, but the screen has changed since")
// live in src/lib/tours/progress.ts so this panel and the contractor's own
// launcher can never disagree about where someone stands.

import { useEffect, useState } from "react";
import { RiInformationLine, RiLoader4Line } from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  STANDING_LABEL,
  standingRows,
  standingSummary,
  type TourProgressRecord,
  type TourStanding,
} from "@/lib/tours/progress";
import { cn } from "@/lib/utils";

const STANDING_STYLE: Record<TourStanding, string> = {
  never: "bg-slate-100 text-slate-500",
  in_progress: "bg-amber-50 text-amber-700",
  skipped: "bg-slate-100 text-slate-600",
  completed: "bg-emerald-50 text-emerald-700",
  outdated: "bg-sky-50 text-sky-700",
};

interface ProgressRow {
  tour_id: string;
  version: number;
  status: string;
  last_step_index: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

function shortDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

export function CleanerTourStatus({ cleanerId }: { cleanerId: string }) {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<TourProgressRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // `as any`: cleaner_tour_progress postdates the generated types, same
        // as the other post-schema tables in the admin views.
        const { data, error: queryError } = await (supabase as any)
          .from("cleaner_tour_progress")
          .select(
            "tour_id, version, status, last_step_index, started_at, completed_at, updated_at",
          )
          .eq("cleaner_id", cleanerId);

        if (queryError) throw queryError;
        if (cancelled) return;

        setRecords(
          ((data || []) as ProgressRow[]).map((row) => ({
            tourId: row.tour_id,
            version: Number(row.version) || 1,
            status: row.status as TourProgressRecord["status"],
            lastStepIndex: Number(row.last_step_index) || 0,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            updatedAt: row.updated_at,
          })),
        );
      } catch (err) {
        console.error("[CleanerTourStatus] load error", err);
        // No rows and a failed read are different things, and conflating them
        // would show "not started" for all seven when the truth is unknown.
        if (!cancelled) setError("Could not load walkthrough history.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  const rows = standingRows(records);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-slate-900">Dashboard walkthroughs</h4>
        {loading ? (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
            Loading…
          </p>
        ) : error ? (
          <p className="text-xs text-rose-600">{error}</p>
        ) : (
          <p className="text-xs text-slate-500">{standingSummary(rows)}</p>
        )}
      </div>

      {!loading && !error && (
        <>
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {rows.map((row) => (
              <div
                key={row.tourId}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">{row.title}</p>
                  {row.standing === "outdated" && (
                    <p className="text-[10px] text-slate-500">
                      Saw v{row.seenVersion} · now v{row.currentVersion}
                    </p>
                  )}
                  {row.standing === "completed" && row.completedAt && (
                    <p className="text-[10px] text-slate-500">{shortDate(row.completedAt)}</p>
                  )}
                  {row.standing === "in_progress" && row.updatedAt && (
                    <p className="text-[10px] text-slate-500">
                      Last opened {shortDate(row.updatedAt)}
                    </p>
                  )}
                </div>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] px-1.5 py-0 border-0 flex-shrink-0",
                    STANDING_STYLE[row.standing],
                  )}
                >
                  {STANDING_LABEL[row.standing]}
                </Badge>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <RiInformationLine className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-slate-500 leading-snug">
              Context only. Walkthroughs are always skippable, this does not feed
              the Novara Score, and nothing here triggers any automatic action.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
