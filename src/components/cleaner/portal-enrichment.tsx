"use client";

// Shared helpers for surfacing a contractor's ENRICHED job data — the
// customer's name, the customer-provided + internal job details, and the
// ACTUAL pay (paid / pending) from manual_payouts — across the cleaner
// dashboards. All of it comes from the get-cleaner-portal edge function
// (manual_payouts is admin-only RLS, so the client can't read real pay itself).

import { useState } from "react";
import { RiInformationLine, RiArrowDownSLine, RiUser3Line, RiToolsLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export interface EnrichedPay {
  actualCents: number | null;
  baseCents?: number | null;
  extrasCents?: number;
  estimateCents: number | null;
  displayCents: number | null;
  isActual: boolean;
  status: "paid" | "pending" | null;
  pctPaid: number | null;
}
export interface EnrichedCustomerDetails {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  dwellingType: string | null;
  flooringType: string | null;
  pets: string | null;
  addOns: string[];
  frequency: string | null;
  accessNotes: string | null;
}
export interface EnrichedInternalDetails {
  jobValueCents: number | null;
  estimateCents: number | null;
  payoutStatus: string | null;
  payoutNote: string | null;
  dispatchNotes: string | null;
  teamNotes: string | null;
  issuesFlag: boolean;
  issuesNotes: string | null;
}
export interface PortalJob {
  id: string;
  bookingId: string;
  jobId: string | null;
  customerName: string;
  serviceType: string;
  homeSizeId: string | null;
  phone: string;
  pay: EnrichedPay;
  customerDetails: EnrichedCustomerDetails | null;
  internalDetails: EnrichedInternalDetails | null;
}

export interface CleanerPortalData {
  jobs: PortalJob[];
  summary: { lifetimePaidCents: number; pendingCents: number; paidJobs: number } | null;
  byJobId: Map<string, PortalJob>;
  byBooking: Map<string, PortalJob>;
}

// Fetch the signed-in cleaner's enriched portal data (JWT is sent automatically
// by supabase-js). Never throws — returns empty maps on failure so callers can
// fall back to their existing estimate display.
export async function fetchCleanerPortal(cleanerId?: string): Promise<CleanerPortalData> {
  const empty: CleanerPortalData = { jobs: [], summary: null, byJobId: new Map(), byBooking: new Map() };
  try {
    const { data, error } = await supabase.functions.invoke("get-cleaner-portal", {
      body: cleanerId ? { cleanerId } : {},
    });
    if (error) return empty;
    const res = data as { ok?: boolean; jobs?: PortalJob[]; summary?: CleanerPortalData["summary"] };
    if (!res?.ok || !Array.isArray(res.jobs)) return empty;
    const byJobId = new Map<string, PortalJob>();
    const byBooking = new Map<string, PortalJob>();
    for (const j of res.jobs) {
      if (j.jobId) byJobId.set(j.jobId, j);
      if (j.bookingId) byBooking.set(j.bookingId, j);
    }
    return { jobs: res.jobs, summary: res.summary || null, byJobId, byBooking };
  } catch {
    return empty;
  }
}

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toFixed(2)}`;

export const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ADDON_LABELS: Record<string, string> = {
  deepBathroomDetail: "Deep bathroom detail",
  trashHaul: "Trash haul",
  petHair: "Heavy pet-hair removal",
  basement: "Basement clean",
  insideFridge: "Inside fridge",
  insideOven: "Inside oven",
  insideCabinets: "Inside cabinets",
  interiorWindows: "Interior windows",
  laundry: "Laundry",
  dishes: "Dishes",
};
export const addonLabel = (id: string) => ADDON_LABELS[id] || titleCase(id);

// Compact "Paid / Payout pending / Estimate" pay chip.
export function PayChip({ pay, align = "end" }: { pay: EnrichedPay; align?: "end" | "start" }) {
  const amt = money(pay.displayCents);
  const tone = pay.isActual && pay.status === "paid"
    ? "text-emerald-600"
    : pay.isActual && pay.status === "pending"
      ? "text-amber-600"
      : "text-primary";
  const label = pay.isActual && pay.status === "paid"
    ? "Paid"
    : pay.isActual && pay.status === "pending"
      ? "Payout pending"
      : "Estimate";
  return (
    <span className={cn("inline-flex flex-col", align === "end" ? "items-end" : "items-start")}>
      <span className={cn("font-bold text-base", tone)}>{amt}</span>
      <span className={cn("text-[10px] font-medium", tone === "text-primary" ? "text-muted-foreground" : tone)}>{label}</span>
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium text-right">{value}</span>
    </div>
  );
}

// Expandable customer + internal details panel for a job.
export function JobDetails({ job }: { job: PortalJob }) {
  const [open, setOpen] = useState(false);
  const cd = job.customerDetails;
  const id = job.internalDetails;
  if (!cd && !id) return null;

  const homeBits = [
    cd?.bedrooms != null ? `${cd.bedrooms} bd` : null,
    cd?.bathrooms != null ? `${cd.bathrooms} ba` : null,
    cd?.sqft != null ? `${cd.sqft} sqft` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
      >
        <span className="flex items-center gap-1.5">
          <RiInformationLine className="w-3.5 h-3.5 text-primary" /> View job details
        </span>
        <RiArrowDownSLine className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          {cd && (
            <div className="rounded-lg bg-background border border-border/50 p-2.5">
              <p className="text-[11px] font-semibold text-slate-900 flex items-center gap-1 mb-1">
                <RiUser3Line className="w-3.5 h-3.5 text-primary" /> Customer details
              </p>
              <DetailRow label="Service" value={titleCase(job.serviceType)} />
              <DetailRow label="Home" value={homeBits || (job.homeSizeId ? titleCase(job.homeSizeId) : null)} />
              <DetailRow label="Dwelling" value={cd.dwellingType ? titleCase(cd.dwellingType) : null} />
              <DetailRow label="Flooring" value={cd.flooringType ? titleCase(cd.flooringType) : null} />
              <DetailRow label="Pets" value={cd.pets ? titleCase(cd.pets) : null} />
              <DetailRow label="Frequency" value={cd.frequency ? titleCase(cd.frequency) : null} />
              <DetailRow label="Add-ons" value={cd.addOns.length ? cd.addOns.map(addonLabel).join(", ") : null} />
              <DetailRow label="Access notes" value={cd.accessNotes} />
              {job.phone && (
                <DetailRow label="Contact" value={<a href={`tel:${job.phone}`} className="text-primary hover:underline">{job.phone}</a>} />
              )}
            </div>
          )}
          {id && (
            <div className="rounded-lg bg-background border border-border/50 p-2.5">
              <p className="text-[11px] font-semibold text-slate-900 flex items-center gap-1 mb-1">
                <RiToolsLine className="w-3.5 h-3.5 text-primary" /> Internal / office
              </p>
              <DetailRow label="Job value" value={money(id.jobValueCents)} />
              <DetailRow
                label="Your pay"
                value={
                  <span className={cn(job.pay.status === "paid" ? "text-emerald-600" : job.pay.status === "pending" ? "text-amber-600" : "")}>
                    {money(job.pay.displayCents)}
                    {job.pay.isActual ? (job.pay.status === "paid" ? " · paid" : " · pending") : " · estimate"}
                    {job.pay.pctPaid != null ? ` (${job.pay.pctPaid}%)` : ""}
                  </span>
                }
              />
              {!!job.pay.extrasCents && job.pay.extrasCents > 0 && (
                <>
                  <DetailRow label="— Base cut" value={money(job.pay.baseCents ?? job.pay.estimateCents)} />
                  <DetailRow label="— Extras (supplies/mileage/etc.)" value={money(job.pay.extrasCents)} />
                </>
              )}
              <DetailRow label="Dispatch notes" value={id.dispatchNotes} />
              <DetailRow label="Office notes" value={id.teamNotes} />
              {id.issuesFlag && <DetailRow label="Issue flagged" value={id.issuesNotes || "Yes"} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
