"use client";

// ─── /cleaner/job-offers — list of pending job offers ────────────────
//
// Replaces the older `JobOffers.tsx` and `MobileJobOffers.tsx` views
// that bypassed `accept-job-offer` and queried the wrong status
// literals. This page is intentionally thin: it lists assignments
// where status='Offered' for the signed-in cleaner and deep-links each
// row to `/cleaner/job-offer/[token]` — the canonical accept/decline
// surface that already handles auth, overlap checks, and flipping
// bookings.cleaner_id for the Lead role.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCalendarLine,
  RiLoader4Line,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiNotification3Line,
  RiTimeLine,
} from "@remixicon/react";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { resolveCleanerAuth } from "@/lib/cleaner-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RecleanBadge, RecleanContractorNote, notesLookLikeReclean } from "@/components/reclean/RecleanCallout";

interface OfferRow {
  id: string;
  role: string | null;
  status: string;
  distance_miles: number | null;
  estimated_pay_cents: number | null;
  pay_percentage_snapshot: number | null;
  crew_size_snapshot: number | null;
  response_token: string | null;
  assigned_at: string | null;
  jobs: {
    id: string;
    service_type: string;
    address: string;
    city: string;
    state: string;
    start_datetime: string;
    duration_est_hours: number;
    sq_ft: number | null;
    notes?: string | null;
  } | null;
}

const formatMoney = (cents: number | null | undefined) => {
  const n = cents ?? 0;
  return `$${(n / 100).toFixed(2)}`;
};

export default function JobOffersList() {
  const router = useRouter();
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const auth = await resolveCleanerAuth();
      if (!auth?.cleaner?.id) {
        router.replace("/cleaner/auth");
        return;
      }
      const { data } = await supabase
        .from("job_assignments")
        .select(
          "id, role, status, distance_miles, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot, response_token, assigned_at, jobs (id, service_type, address, city, state, start_datetime, duration_est_hours, sq_ft, notes)",
        )
        .eq("cleaner_id", auth.cleaner.id)
        .ilike("status", "offered")
        .order("assigned_at", { ascending: false });
      const rows = (data || []) as unknown as OfferRow[];

      // Deep link from a Discord/SMS "Open & claim this job" link
      // (/cleaner/job-offers?job=<job_id>): jump straight to THIS cleaner's
      // tokenized accept/decline page for that job, resolving their personal
      // response_token client-side.
      const focusJob =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("job")
          : null;
      if (focusJob) {
        const match = rows.find((o) => o.jobs?.id === focusJob && o.response_token);
        if (match?.response_token) {
          router.replace(`/cleaner/job-offer/${match.response_token}`);
          return;
        }
      }

      setOffers(rows);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="container max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/cleaner/dashboard")}
            className="-ml-2"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" />
            Dashboard
          </Button>
          <div className="flex items-center gap-2 ml-2">
            <RiNotification3Line className="w-4 h-4 text-emerald-700" />
            <h1 className="font-jakarta text-base font-bold text-slate-900 tracking-tight">
              Active job offers
            </h1>
          </div>
        </div>
      </header>

      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-3">
        {loading ? (
          <>
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </>
        ) : offers.length === 0 ? (
          <Card className="border-dashed border-2 border-slate-200">
            <CardContent className="py-12 text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
                <RiNotification3Line className="w-6 h-6 text-slate-400" />
              </div>
              <p className="font-semibold text-slate-900">
                No active offers right now
              </p>
              <p className="text-sm text-slate-500 mt-1">
                You&apos;ll get a text + push notification the moment a new
                job opens up in your area.
              </p>
            </CardContent>
          </Card>
        ) : (
          offers.map((o) => {
            const start = o.jobs?.start_datetime
              ? new Date(o.jobs.start_datetime)
              : null;
            const dateLabel = start
              ? format(start, "EEE, MMM d · h:mm a")
              : "—";
            return (
              <Card
                key={o.id}
                className="border border-slate-200 shadow-sm rounded-2xl"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="capitalize">
                          {(o.jobs?.service_type || "cleaning").replaceAll(
                            "_",
                            " ",
                          )}
                        </span>
                        {o.role?.toLowerCase() === "lead" && (
                          <Badge className="bg-emerald-100 text-emerald-700 border-0 hover:bg-emerald-100 text-[10px]">
                            Lead
                          </Badge>
                        )}
                        {notesLookLikeReclean(o.jobs?.notes) && (
                          <RecleanBadge className="text-[10px]" />
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Offered{" "}
                        {o.assigned_at
                          ? format(new Date(o.assigned_at), "MMM d, h:mm a")
                          : "—"}
                      </CardDescription>
                    </div>
                    <Badge className="bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-50">
                      Awaiting response
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {notesLookLikeReclean(o.jobs?.notes) && (
                    <RecleanContractorNote compact reliabilityNeutral />
                  )}
                  <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                    <span className="text-slate-500 inline-flex items-center gap-1.5">
                      <RiCalendarLine className="w-3.5 h-3.5" /> Date
                    </span>
                    <span className="text-right text-slate-900 tabular-nums">
                      {dateLabel}
                    </span>
                    <span className="text-slate-500 inline-flex items-center gap-1.5">
                      <RiMapPinLine className="w-3.5 h-3.5" /> Where
                    </span>
                    <span className="text-right text-slate-900 truncate">
                      {o.jobs?.city || "—"}
                      {o.jobs?.state ? `, ${o.jobs.state}` : ""}
                    </span>
                    <span className="text-slate-500 inline-flex items-center gap-1.5">
                      <RiTimeLine className="w-3.5 h-3.5" /> Duration
                    </span>
                    <span className="text-right text-slate-900 tabular-nums">
                      {o.jobs?.duration_est_hours
                        ? `${o.jobs.duration_est_hours} hr`
                        : "—"}
                    </span>
                    <span className="text-slate-500 inline-flex items-center gap-1.5">
                      <RiMoneyDollarCircleLine className="w-3.5 h-3.5" /> Pay
                    </span>
                    <span className="text-right text-emerald-700 font-bold tabular-nums">
                      {formatMoney(o.estimated_pay_cents)}
                      {o.pay_percentage_snapshot != null ? (
                        <span className="block text-[10px] font-semibold text-emerald-600/80">
                          {(o.crew_size_snapshot ?? 1) > 1
                            ? `Crew of ${o.crew_size_snapshot} · ${o.pay_percentage_snapshot}% (crew pool)`
                            : `Solo · ${o.pay_percentage_snapshot}%`}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {o.response_token ? (
                    <Button
                      asChild
                      size="lg"
                      className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Link href={`/cleaner/job-offer/${o.response_token}`}>
                        Review & respond
                        <RiArrowRightLine className="w-4 h-4 ml-1.5" />
                      </Link>
                    </Button>
                  ) : (
                    <p className="text-xs text-amber-700 mt-2">
                      Offer link expired — text 911 to support.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
