"use client";

import {
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiTimeLine,
  RiLoginCircleLine,
  RiCheckboxCircleLine,
  RiLoader4Line,
} from "@remixicon/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { format } from "date-fns";

// Prefer the booking's canonical date + arrival window (what the customer
// booked) over jobs.start_datetime, which is stored tz-naive and used to
// default to 09:00 — so the cleaner always sees the correct time.
const WINDOW_LABELS: Record<string, string> = {
  "8-12": "8:00 AM – 12:00 PM",
  "12-16": "12:00 PM – 4:00 PM",
  "16-20": "4:00 PM – 8:00 PM",
};
function jobWhenLabel(job: any): string {
  const date: string | null = job.booking_service_date || null;
  const slot: string | null = job.booking_time_slot || null;
  if (date) {
    const d = new Date(`${date}T12:00:00`);
    const dayLabel = Number.isNaN(d.getTime())
      ? date
      : format(d, "EEEE, MMMM d");
    const window = slot ? (WINDOW_LABELS[slot] || slot.replace(/\s*-\s*/, " – ")) : "";
    return window ? `${dayLabel} · ${window}` : dayLabel;
  }
  return job.start_datetime
    ? format(new Date(job.start_datetime), "EEEE, MMMM d 'at' h:mm a")
    : "—";
}

interface UpcomingJobsProps {
  jobs: any[];
  onCheckIn?: (job: any) => void;
  onComplete?: (job: any) => void;
  actionLoading?: string | null;
}

export function UpcomingJobs({ jobs, onCheckIn, onComplete, actionLoading }: UpcomingJobsProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-8">
        <RiTimeLine className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No upcoming jobs scheduled</p>
      </div>
    );
  }

  const getGoogleMapsUrl = (address: string, city: string, state: string, zip: string) => {
    const fullAddress = `${address}, ${city}, ${state} ${zip}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  };

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const checkedIn = Boolean(job.check_in_time);
        const inProgress = String(job.status || "").toLowerCase() === "in progress";
        return (
          <Card key={job.id} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-base capitalize">
                  {String(job.service_type || "cleaning").replaceAll("_", " ")}
                </h3>
                <p className="text-xs text-muted-foreground">{job.role}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-base text-primary">
                  ${((job.estimated_pay_cents || 0) / 100).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">estimated pay</p>
              </div>
            </div>

            <div className="space-y-1.5 mb-3">
              <div className="flex items-center gap-2 text-xs">
                <RiTimeLine className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{jobWhenLabel(job)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <RiMapPinLine className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{[job.address, job.city, job.state].filter(Boolean).join(", ")}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <RiMoneyDollarCircleLine className="w-3.5 h-3.5 text-muted-foreground" />
                <span>{job.duration_est_hours} hours estimated</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 min-w-[120px]"
                onClick={() =>
                  window.open(
                    getGoogleMapsUrl(job.address, job.city, job.state, job.zip),
                    "_blank",
                  )
                }
              >
                <RiMapPinLine className="mr-2 w-3.5 h-3.5" />
                Directions
              </Button>

              {onCheckIn && !checkedIn && (
                <Button
                  size="sm"
                  className="flex-1 min-w-[120px] bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={actionLoading === `checkin-${job.id}`}
                  onClick={() => onCheckIn(job)}
                >
                  {actionLoading === `checkin-${job.id}` ? (
                    <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <RiLoginCircleLine className="mr-2 w-3.5 h-3.5" />
                      Check in
                    </>
                  )}
                </Button>
              )}

              {onComplete && (checkedIn || inProgress) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 min-w-[120px] border-emerald-200 text-emerald-700"
                  disabled={actionLoading === `complete-${job.id}`}
                  onClick={() => onComplete(job)}
                >
                  {actionLoading === `complete-${job.id}` ? (
                    <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      <RiCheckboxCircleLine className="mr-2 w-3.5 h-3.5" />
                      Mark done
                    </>
                  )}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
