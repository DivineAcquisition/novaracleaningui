"use client";

import { useState } from "react";
import { RiFlashlightLine, RiLoader4Line, RiMapPin2Line } from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asErrorMessage } from "@/lib/edge-invoke";
import { callUrgentHire } from "@/lib/urgent-hire-client";

export interface UrgentHirePreview {
  jobId: string;
  serviceType: string;
  dateLabel: string;
  timeWindow: string;
  zone: string;
  jobValueCents: number;
  payCents: number;
  mileageRateCents?: number;
  settings: {
    radius_miles: number;
    pay_percent: number;
    first_job_only: boolean;
    fill_window_minutes: number;
  };
  eligibleCount: number;
  skippedNoLocation: number;
  unknownMileage?: number;
  skippedTooFar?: number;
  inRadiusCount?: number;
  fartherCount?: number;
  canAcceptNow: number;
  needChecklist: number;
  openBroadcast: { id: string; status: string; reached_count: number } | null;
  applicants: Array<{
    applicantId: string;
    name: string;
    stage: string;
    miles: number | null;
    payCents?: number;
    mileageCents?: number;
    hadValidChecklist: boolean;
    remaining: string[];
  }>;
}

function applicantMilesLabel(
  miles: number | null | undefined,
  payCents?: number,
): string {
  const mi =
    miles == null || !Number.isFinite(Number(miles))
      ? "mileage unknown"
      : `${Number(miles).toFixed(1)} mi`;
  if (payCents != null) return `${mi} · $${(Math.max(0, payCents) / 100).toFixed(2)}`;
  return mi;
}

function money(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export function UrgentHireDialog({
  open,
  onOpenChange,
  preview,
  loading,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: UrgentHirePreview | null;
  loading: boolean;
  onSent?: () => void;
}) {
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!preview) return;
    setSending(true);
    const { ok, data } = await callUrgentHire<{
      reached?: number;
      eligibleCount?: number;
      fillDeadlineAt?: string;
    }>({ action: "send", jobId: preview.jobId });
    setSending(false);
    if (!ok) return void toast.error(asErrorMessage(data.error, "Could not send Urgent Hire."));
    toast.success(
      `Urgent Hire sent to ${data.reached ?? 0} of ${data.eligibleCount ?? 0} eligible applicant(s). First to finish and accept wins.`,
    );
    onOpenChange(false);
    onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RiFlashlightLine className="h-5 w-5 text-violet-700" />
            Urgent Hire
          </DialogTitle>
          <DialogDescription>
            Last-resort broadcast to qualified pipeline applicants within the max-miles
            window (45–55). Valid photo ID and own vehicle, Screening-Passed or later,
            not rejected, not Active. Payout is the first-job share plus mileage at 70¢/mi,
            and company take stays at least 40%. First to finish remaining steps and
            accept gets the job.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <RiLoader4Line className="h-4 w-4 animate-spin" />
            Finding eligible applicants…
          </div>
        ) : !preview ? (
          <p className="text-sm text-slate-600">Could not load a preview for this job.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{preview.serviceType}</p>
              <p className="text-slate-600">
                {preview.dateLabel}
                {preview.timeWindow ? ` · ${preview.timeWindow}` : ""}
              </p>
              <p className="flex items-center gap-1 text-slate-600">
                <RiMapPin2Line className="h-3.5 w-3.5" />
                {preview.zone}{" "}
                <span className="text-slate-400">(zone only — not the exact address)</span>
              </p>
              <p className="mt-2 font-semibold text-violet-800">
                {money(preview.payCents)} job share ({preview.settings.pay_percent}% of {money(preview.jobValueCents)})
                {" "}+ 70¢/mi
              </p>
              <p className="text-xs text-violet-700 mt-1">
                Each SMS shows that person&apos;s total (job share + mileage). Company take stays at least 40%.
                {preview.settings.first_job_only
                  ? " The job-share rate is first-job only; standard tiers apply after."
                  : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{preview.eligibleCount} qualified</Badge>
              <Badge variant="secondary">{preview.canAcceptNow} can accept now</Badge>
              <Badge variant="secondary">{preview.needChecklist} still need supply checklist</Badge>
              {(preview.fartherCount ?? preview.skippedTooFar ?? 0) > 0 ? (
                <Badge variant="outline">{preview.fartherCount ?? preview.skippedTooFar} farther than {preview.settings.radius_miles} mi</Badge>
              ) : null}
              {(preview.unknownMileage ?? preview.skippedNoLocation) > 0 ? (
                <Badge variant="outline">
                  {preview.unknownMileage ?? preview.skippedNoLocation} skipped — no location
                </Badge>
              ) : null}
              <Badge variant="outline">{preview.settings.radius_miles} mi · {preview.settings.fill_window_minutes} min window</Badge>
            </div>

            {preview.openBroadcast ? (
              <p className="text-sm text-amber-800">
                A broadcast is already open for this job ({preview.openBroadcast.reached_count} reached).
              </p>
            ) : preview.eligibleCount === 0 ? (
              <p className="text-sm text-rose-700">
                Nobody qualified is within {preview.settings.radius_miles} miles (ID + vehicle,
                Screening-Passed or later, not rejected, not Active).
              </p>
            ) : (
              <ul className="max-h-40 overflow-auto rounded-md border border-slate-200 divide-y text-xs">
                {preview.applicants.slice(0, 12).map((a) => (
                  <li key={a.applicantId} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="font-medium text-slate-800">{a.name}</span>
                    <span className="text-slate-500">
                      {applicantMilesLabel(a.miles, a.payCents)}
                      {a.hadValidChecklist ? "" : " · needs checklist"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                className="bg-violet-700 hover:bg-violet-800"
                disabled={
                  sending ||
                  loading ||
                  !preview ||
                  preview.eligibleCount === 0 ||
                  Boolean(preview.openBroadcast)
                }
                onClick={() => void send()}
              >
                {sending ? (
                  <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RiFlashlightLine className="mr-1.5 h-4 w-4" />
                )}
                Send to {preview.eligibleCount} applicant{preview.eligibleCount === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useUrgentHireLaunch() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<UrgentHirePreview | null>(null);

  const launch = async (jobId: string) => {
    if (!jobId) {
      toast.error("This coverage row has no job yet — dispatch it first.");
      return;
    }
    setOpen(true);
    setLoading(true);
    setPreview(null);
    const { ok, data } = await callUrgentHire<UrgentHirePreview>({ action: "preview", jobId });
    setLoading(false);
    if (!ok) {
      toast.error(asErrorMessage(data.error, "Could not preview Urgent Hire."));
      setOpen(false);
      return;
    }
    setPreview(data);
  };

  return { open, setOpen, loading, preview, launch };
}
