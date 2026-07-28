"use client";

// ─── Tier 1 display: what the system already observed ─────────────────────────
//
// Read-only by construction — there is no input element here, so a VA cannot
// overwrite a verified metric even with the devtools open. The value the form
// sends on submit never includes these keys.
//
// A missing value renders as "Unverified" with the reason, never as 0. That
// distinction is the whole point: a source outage should look like a source
// outage, not like a VA who did nothing.

import { RiCheckboxCircleFill, RiInformationLine, RiWifiOffLine } from "@remixicon/react";

import { cn } from "@/lib/utils";
import {
  formatMetric,
  METRIC_SOURCES,
  METRICS,
  SOURCE_STATUS_LABEL,
  type MetricKey,
  type MetricProvenance,
  type MetricValues,
} from "@/lib/va-performance/metrics";

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "not synced yet";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "not synced yet";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function VerifiedField({
  metric,
  values,
  provenance,
  label,
  emphasis = false,
}: {
  metric: MetricKey;
  values: MetricValues;
  provenance: MetricProvenance;
  label?: string;
  emphasis?: boolean;
}) {
  const def = METRICS[metric];
  const value = values[metric];
  const meta = provenance[metric];
  const verified = value !== null && value !== undefined && (!meta || meta.status === "ok");

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        verified ? "border-slate-200 bg-slate-50/70" : "border-amber-200 bg-amber-50/50",
        emphasis && "sm:col-span-2",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600">{label || def.label}</p>
          <p
            className={cn(
              "mt-1 font-mono tabular-nums tracking-tight",
              emphasis ? "text-2xl font-semibold" : "text-lg font-semibold",
              verified ? "text-slate-900" : "text-amber-700",
            )}
          >
            {verified ? formatMetric(metric, value) : "Unverified"}
          </p>
        </div>
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            verified ? "text-emerald-600" : "text-amber-600",
          )}
          aria-hidden
        >
          {verified ? <RiCheckboxCircleFill className="h-4 w-4" /> : <RiWifiOffLine className="h-4 w-4" />}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        {verified ? (
          <>
            {METRIC_SOURCES[def.source]} · synced {relativeTime(meta?.syncedAt)}
          </>
        ) : (
          <>
            {METRIC_SOURCES[def.source]} — {SOURCE_STATUS_LABEL[meta?.status ?? "unavailable"]}. Left blank
            rather than counted as zero.
          </>
        )}
      </p>
    </div>
  );
}

/** The read-only explainer that heads every auto-filled group. */
export function AutoFilledNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-500">
      <RiInformationLine className="mt-px h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span>
        Recorded automatically. You can&apos;t edit these — if one looks wrong, say so in the notes and
        it&apos;ll get looked at.
      </span>
    </p>
  );
}
