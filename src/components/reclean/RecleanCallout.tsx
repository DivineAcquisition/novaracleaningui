"use client";

// Shared Spotless Guarantee labeling — admin bookings list, booking sheet,
// contractor dashboard, and the job-offer page all need the same "this is a
// paid re-clean, customer is not charged" signal.

import { RiShieldCheckLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function RecleanBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        "border-0 bg-violet-100 text-violet-900 font-semibold",
        className,
      )}
    >
      Re-clean · Spotless Guarantee
    </Badge>
  );
}

export function RecleanContractorNote({
  scope,
  areas,
  payCents,
  reliabilityNeutral,
  compact,
}: {
  scope?: string | null;
  areas?: string[] | null;
  payCents?: number | null;
  reliabilityNeutral?: boolean;
  compact?: boolean;
}) {
  const pay =
    payCents != null && payCents > 0
      ? `$${(payCents / 100).toFixed(2)}`
      : null;
  const areaLabel = (areas || []).filter(Boolean).join(", ");
  return (
    <div
      className={cn(
        "rounded-lg border border-violet-200 bg-violet-50 text-violet-950",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <p className={cn("font-semibold flex items-center gap-1.5", compact ? "text-xs" : "text-sm")}>
        <RiShieldCheckLine className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
        Paid re-clean — Spotless Guarantee
      </p>
      <p className={cn("mt-1 text-violet-800", compact ? "text-[11px]" : "text-xs")}>
        The customer is not charged. You are paid at your normal tier rate
        {pay ? ` (${pay} on this scope)` : " on the assessed scope"}.
        {reliabilityNeutral
          ? " Declining this offer does not affect your Novara Score."
          : ""}
      </p>
      {scope === "full" ? (
        <p className={cn("mt-1 text-violet-800", compact ? "text-[11px]" : "text-xs")}>
          Scope: full re-service of the original job.
        </p>
      ) : areaLabel ? (
        <p className={cn("mt-1 text-violet-800", compact ? "text-[11px]" : "text-xs")}>
          Scope: {areaLabel} only — do not expand to a whole-home clean.
        </p>
      ) : (
        <p className={cn("mt-1 text-violet-800", compact ? "text-[11px]" : "text-xs")}>
          Scope: targeted follow-up of the areas named on the job notes.
        </p>
      )}
    </div>
  );
}

export function notesLookLikeReclean(notes?: string | null): boolean {
  return /RE-CLEAN|Spotless Guarantee/i.test(String(notes || ""));
}

export function isRecleanBooking(row?: {
  is_reclean?: boolean | null;
  booking_channel?: string | null;
  team_notes?: string | null;
  notes?: string | null;
} | null): boolean {
  if (!row) return false;
  return (
    row.is_reclean === true ||
    row.booking_channel === "reclean" ||
    notesLookLikeReclean(row.team_notes) ||
    notesLookLikeReclean(row.notes)
  );
}

export interface RecleanPortalOffer {
  token: string;
  serviceType?: string | null;
  serviceDate?: string | null;
  timeSlot?: string | null;
  city?: string | null;
  state?: string | null;
  estimatedPayCents?: number | null;
  recleanScope?: string | null;
  isReclean?: boolean;
}

export function RecleanOfferBanner({ offers }: { offers: RecleanPortalOffer[] }) {
  const recleans = (offers || []).filter((o) => o.isReclean && o.token);
  if (!recleans.length) return null;
  return (
    <div className="space-y-2">
      {recleans.map((o) => (
        <div
          key={o.token}
          className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-2"
        >
          <RecleanBadge />
          <p className="text-sm font-semibold text-violet-950">
            Paid Spotless Guarantee re-clean
          </p>
          <p className="text-xs text-violet-800">
            {o.serviceDate || "Date TBD"}
            {o.timeSlot ? ` · ${o.timeSlot}` : ""}
            {o.city ? ` · ${o.city}${o.state ? `, ${o.state}` : ""}` : ""}
            {o.estimatedPayCents != null
              ? ` · $${(o.estimatedPayCents / 100).toFixed(2)} pay`
              : ""}
          </p>
          <RecleanContractorNote
            compact
            scope={o.recleanScope}
            payCents={o.estimatedPayCents}
            reliabilityNeutral
          />
          <a
            href={`/cleaner/job-offer/${o.token}`}
            className="inline-flex w-full items-center justify-center rounded-lg bg-violet-700 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-violet-800"
          >
            Review &amp; respond
          </a>
        </div>
      ))}
    </div>
  );
}
