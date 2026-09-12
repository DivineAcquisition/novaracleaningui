"use client";

// ─── Recording freshness ─────────────────────────────────────────────────────
//
// The screen recordings are generated from the live app, which means they can
// fall behind it. This panel is the thing that stops that from happening
// quietly: it names every clip whose underlying screen has changed since the
// clip was captured, and every walkthrough that has no clip at all.
//
// Freshness comes from committed hashes, not from a filesystem check — see
// src/lib/tours/recordings.ts for why. Nothing here can repair a stale clip;
// re-recording is `npm run tours:record`, so the panel's whole job is to make
// sure somebody knows to run it.
//
// When every clip is current, this collapses to a single line. A panel that
// shouts on a good day gets ignored on a bad one.

import { useState } from "react";
import {
  RiAlertLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiVideoLine,
} from "@remixicon/react";

import { Badge } from "@/components/ui/badge";
import {
  manifestGeneratedAt,
  recordingRows,
} from "@/lib/tours/recordings";
import { cn } from "@/lib/utils";

function shortDate(value: string | null): string {
  if (!value) return "never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleDateString();
}

export function TourRecordingFreshness() {
  const rows = recordingRows();
  const stale = rows.filter((r) => r.recording && r.stale);
  const missing = rows.filter((r) => !r.recording);
  const needsAttention = stale.length + missing.length;

  // Open by default only when there's something to do about it.
  const [open, setOpen] = useState(needsAttention > 0);

  const headline =
    needsAttention === 0
      ? `All ${rows.length} recordings match the current screens`
      : [
          stale.length ? `${stale.length} out of date` : null,
          missing.length ? `${missing.length} not recorded` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div
      className={cn(
        "rounded-xl border bg-white",
        needsAttention > 0 ? "border-amber-300" : "border-slate-200",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        {needsAttention > 0 ? (
          <RiAlertLine className="w-4 h-4 text-amber-600 flex-shrink-0" />
        ) : (
          <RiVideoLine className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-800">
            Training recordings — {headline}
          </p>
          <p className="text-[10px] text-slate-500">
            Last generated {shortDate(manifestGeneratedAt())}
          </p>
        </div>
        {open ? (
          <RiArrowDownSLine className="w-4 h-4 text-slate-400 flex-shrink-0" />
        ) : (
          <RiArrowRightSLine className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-3 space-y-2">
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
            {rows.map((row) => {
              const recording = row.recording;
              return (
                <div
                  key={row.tourId}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">
                      {row.title}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {recording
                        ? `Recorded ${shortDate(recording.generatedAt)} · ${recording.durationSeconds}s`
                        : "No clip — the guided walkthrough still works"}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] px-1.5 py-0 border-0 flex-shrink-0",
                      !recording
                        ? "bg-slate-100 text-slate-500"
                        : row.stale
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700",
                    )}
                  >
                    {!recording ? "Missing" : row.stale ? "Out of date" : "Current"}
                  </Badge>
                </div>
              );
            })}
          </div>

          {needsAttention > 0 ? (
            <p className="text-[10px] text-slate-500 leading-snug">
              Regenerate with{" "}
              <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700">
                npm run tours:record
              </code>{" "}
              then{" "}
              <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700">
                npm run tours:publish
              </code>
              . Clips are captured against a demo account — no real client or
              contractor data goes into them.
            </p>
          ) : (
            <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
              <RiCheckLine className="w-3 h-3 text-emerald-600" />
              Nothing to do. The interactive walkthroughs run on the live UI and
              are current by definition.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
