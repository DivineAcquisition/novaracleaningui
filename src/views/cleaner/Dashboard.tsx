"use client";

import {
  RiBankCardLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiMapPinLine,
  RiMoneyDollarCircleLine,
  RiSettings3Line,
  RiStarLine,
  RiTimeLine,
  RiUserLine
} from "@remixicon/react";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SEO } from "@/components/SEO";
import { format } from "date-fns";
import { useCapacitor } from "@/hooks/use-capacitor";
import { resolveCleanerAuth, isBlockedCleanerStatus } from "@/lib/cleaner-auth";
import SuspensionBanner from "@/components/cleaner/SuspensionBanner";
import {
  CoverageOfferBanner,
  fetchCleanerPortal,
  PayChip,
  JobDetails,
  type CleanerPortalData,
  type PortalJob,
} from "@/components/cleaner/portal-enrichment";
import { parseServiceDate } from "@/lib/service-date";
import { payExplanation, normalizePayTier } from "@/lib/crew-pay";
import {
  RecleanBadge,
  RecleanContractorNote,
  RecleanOfferBanner,
  notesLookLikeReclean,
} from "@/components/reclean/RecleanCallout";

interface CleanerProfile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  status: string;
  stripe_account_id: string | null;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
  total_earnings_cents?: number | null;
  completed_bookings?: number | null;
  average_rating?: number | null;
  total_ratings?: number | null;
  pay_tier?: string | null;
  pay_percentage?: number | null;
  suspended_until?: string | null;
  suspension_reason?: string | null;
}

type JobSource = "assignments" | "bookings";

interface UpcomingJob {
  id: string;
  assignmentId?: string;
  bookingId?: string;
  jobId?: string;
  checklistToken?: string | null;
  source: JobSource;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  zip_code?: string;
  start_datetime?: string;
  service_date?: string;
  time_slot?: string;
  duration_est_hours?: number;
  estimated_duration_hours?: number;
  estimated_pay_cents?: number | null;
  cleaner_payout_cents?: number | null;
  total_estimate_cents?: number;
  check_in_time?: string | null;
  status?: string;
  crew_size_snapshot?: number | null;
  pay_percentage_snapshot?: number | null;
  notes?: string | null;
  is_reclean?: boolean;
  reclean_scope?: string | null;
  reclean_assessed_value_cents?: number | null;
}

interface CompletedJob {
  id: string;
  jobId?: string;
  bookingId?: string;
  service_type: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  zip_code?: string;
  start_datetime?: string;
  service_date?: string;
  time_slot?: string;
  completed_at?: string | null;
  estimated_pay_cents?: number | null;
  cleaner_payout_cents?: number | null;
  crew_size_snapshot?: number | null;
  pay_percentage_snapshot?: number | null;
  is_reclean?: boolean;
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function getGoogleMapsUrl(address: string, city: string, state: string, zip: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address}, ${city}, ${state} ${zip}`)}`;
}

function getGoogleCalendarUrl(
  serviceType: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  startDatetime?: string,
  serviceDate?: string,
  timeSlot?: string,
  durationHours?: number
) {
  let start: Date;
  let end: Date;

  if (startDatetime) {
    start = new Date(startDatetime);
    end = new Date(start.getTime() + (durationHours || 2) * 60 * 60 * 1000);
  } else if (serviceDate && timeSlot) {
    const [startPart] = timeSlot.split(" - ");
    const timeMatch = startPart?.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/i);
    let hours = 9;
    let minutes = 0;
    if (timeMatch) {
      hours = parseInt(timeMatch[1] || "9");
      minutes = parseInt(timeMatch[2] || "0");
      if (timeMatch[3]?.toLowerCase() === "pm" && hours < 12) hours += 12;
      if (timeMatch[3]?.toLowerCase() === "am" && hours === 12) hours = 0;
    }
    start = parseServiceDate(serviceDate) || new Date();
    start.setHours(hours, minutes, 0, 0);
    end = new Date(start.getTime() + (durationHours || 2) * 60 * 60 * 1000);
  } else {
    start = new Date();
    end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  }

  const formatForGoogle = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const startStr = formatForGoogle(start);
  const endStr = formatForGoogle(end);
  const location = `${address}, ${city}, ${state} ${zip}`;

  return `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Cleaning - ${serviceType}`)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(`Address: ${address}, ${city}`)}&location=${encodeURIComponent(location)}`;
}

export default function CleanerDashboard() {
  const router = useRouter();
  const { isNative } = useCapacitor();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJob[]>([]);

  useEffect(() => {
    if (isNative) {
      router.replace("/cleaner/mobile-dashboard");
    }
  }, [isNative, router]);
  const [completedJobs, setCompletedJobs] = useState<CompletedJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Enriched jobs (customer name + ACTUAL pay + details) from get-cleaner-portal.
  const [portal, setPortal] = useState<CleanerPortalData | null>(null);

  const fetchJobs = useCallback(
    // payPercentage is passed explicitly because this callback is created
    // before `profile` state settles — reading profile from the closure
    // always saw null on first load (stale-closure gap).
    async (cleanerId: string, payPercentage?: number | null) => {
      setJobsLoading(true);
      try {
        const upcomingStatuses = [
          "assigned",
          "accepted",
          "Assigned",
          "Accepted",
          "Confirmed",
          "In Progress",
          // Offered recleans must appear here — desktop dashboard has no
          // separate offers tab, and bookings.cleaner_id is still null until accept.
          "Offered",
          "offered",
          "Broadcast",
        ];
        // Booking is the live source of truth. Assignment/job status often
        // lagged behind complete-booking / reassignment, which left finished
        // or withdrawn work on Upcoming.
        const notUpcomingBooking = new Set([
          "completed",
          "cancelled",
          "canceled",
          "pending_review",
        ]);

        const { data: assignments, error: assignmentsError } = await supabase
          .from("job_assignments")
          .select(
            `
            id,
            status,
            estimated_pay_cents,
            pay_percentage_snapshot,
            crew_size_snapshot,
            response_token,
            jobs (
              id,
              address,
              city,
              state,
              zip,
              service_type,
              start_datetime,
              duration_est_hours,
              check_in_time,
              status,
              notes
            )
          `
          )
          .eq("cleaner_id", cleanerId)
          .in("status", upcomingStatuses)
          .order("assigned_at", { ascending: true });

        if (!assignmentsError && assignments?.length) {
          const jobIds = assignments
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              return job?.id as string | undefined;
            })
            .filter(Boolean) as string[];
          const bookingByJob: Record<string, {
            status: string;
            id: string;
            is_reclean?: boolean;
            reclean_scope?: string | null;
            reclean_assessed_value_cents?: number | null;
            team_notes?: string | null;
          }> = {};
          if (jobIds.length > 0) {
            const { data: bookingRows } = await supabase
              .from("bookings")
              .select("id, job_id, status, is_reclean, reclean_scope, reclean_assessed_value_cents, team_notes")
              .in("job_id", jobIds);
            for (const b of bookingRows || []) {
              if (b.job_id) {
                bookingByJob[b.job_id] = {
                  id: b.id,
                  status: String(b.status || ""),
                  is_reclean: Boolean((b as { is_reclean?: boolean }).is_reclean),
                  reclean_scope: (b as { reclean_scope?: string | null }).reclean_scope ?? null,
                  reclean_assessed_value_cents: (b as { reclean_assessed_value_cents?: number | null }).reclean_assessed_value_cents ?? null,
                  team_notes: (b as { team_notes?: string | null }).team_notes ?? null,
                };
              }
            }
          }

          const formatted: UpcomingJob[] = assignments
            .filter((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              if (!job) return false;
              const bStatus = (bookingByJob[job.id]?.status || "").toLowerCase();
              if (bStatus && notUpcomingBooking.has(bStatus)) return false;
              const jStatus = String(job.status || "").toLowerCase();
              if (["completed", "cancelled", "canceled"].includes(jStatus)) return false;
              const offered = /^(offered|broadcast)$/i.test(String(a.status || ""));
              if (offered) {
                const bk = bookingByJob[job.id];
                return Boolean(bk?.is_reclean)
                  || notesLookLikeReclean(job.notes)
                  || notesLookLikeReclean(bk?.team_notes);
              }
              return true;
            })
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              const bk = job?.id ? bookingByJob[job.id] : undefined;
              return {
                id: a.id,
                assignmentId: a.id,
                jobId: job?.id,
                bookingId: bk?.id,
                checklistToken: a.response_token || null,
                source: "assignments" as JobSource,
                service_type: job?.service_type || "Cleaning",
                address: job?.address || "",
                city: job?.city || "",
                state: job?.state || "",
                zip: job?.zip || "",
                start_datetime: job?.start_datetime,
                duration_est_hours: job?.duration_est_hours,
                estimated_pay_cents: a.estimated_pay_cents,
                crew_size_snapshot: a.crew_size_snapshot,
                pay_percentage_snapshot: a.pay_percentage_snapshot,
                check_in_time: job?.check_in_time,
                status: a.status,
                notes: job?.notes || null,
                is_reclean: Boolean(bk?.is_reclean) || notesLookLikeReclean(job?.notes),
                reclean_scope: bk?.reclean_scope || null,
                reclean_assessed_value_cents: bk?.reclean_assessed_value_cents ?? null,
              };
            });
          setUpcomingJobs(formatted);
        } else {
          const { data: bookings, error: bookingsError } = await supabase
            .from("bookings")
            .select("*")
            .eq("cleaner_id", cleanerId)
            .in("status", ["confirmed", "assigned", "in_progress"])
            .order("service_date", { ascending: true });

          if (!bookingsError && bookings?.length) {
            const formatted: UpcomingJob[] = bookings.map((b: any) => ({
              id: b.id,
              bookingId: b.id,
              jobId: b.job_id,
              source: "bookings" as JobSource,
              service_type: b.service_type || "Cleaning",
              address: b.address || "",
              city: b.city || "",
              state: b.state || "",
              zip: b.zip_code || "",
              zip_code: b.zip_code,
              service_date: b.service_date,
              time_slot: b.time_slot,
              duration_est_hours: b.estimated_duration_hours,
              estimated_pay_cents: b.cleaner_payout_cents ?? (b.total_estimate_cents && payPercentage
                ? Math.floor((b.total_estimate_cents || 0) * payPercentage / 100)
                : null),
              cleaner_payout_cents: b.cleaner_payout_cents,
              total_estimate_cents: b.total_estimate_cents,
              check_in_time: b.check_in_time,
              status: b.status,
            }));
            setUpcomingJobs(formatted);
          } else {
            setUpcomingJobs([]);
          }
        }

        // Completed = assignment marked Completed OR the linked booking is
        // completed (covers historical rows that never flipped assignment status).
        const { data: completedAssignments } = await supabase
          .from("job_assignments")
          .select(
            `
            id,
            status,
            estimated_pay_cents,
            pay_percentage_snapshot,
            crew_size_snapshot,
            jobs (
              id,
              address,
              city,
              state,
              zip,
              service_type,
              start_datetime,
              check_out_time,
              status
            )
          `
          )
          .eq("cleaner_id", cleanerId)
          .not("status", "in", "(Withdrawn,withdrawn,Declined,declined,Expired,expired,Cancelled,cancelled)")
          .order("assigned_at", { ascending: false })
          .limit(40);

        let completedFormatted: CompletedJob[] = [];
        if (completedAssignments?.length) {
          const cJobIds = completedAssignments
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              return job?.id as string | undefined;
            })
            .filter(Boolean) as string[];
          const completedBookingJobs = new Set<string>();
          const completedAtByJob: Record<string, string | null> = {};
          if (cJobIds.length > 0) {
            const { data: doneBookings } = await supabase
              .from("bookings")
              .select("job_id, status, completed_at")
              .in("job_id", cJobIds)
              .in("status", ["completed", "pending_review"]);
            for (const b of doneBookings || []) {
              if (b.job_id) {
                completedBookingJobs.add(b.job_id);
                completedAtByJob[b.job_id] = b.completed_at || null;
              }
            }
          }
          completedFormatted = completedAssignments
            .filter((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              if (!job) return false;
              const aStatus = String(a.status || "").toLowerCase();
              if (aStatus === "completed") return true;
              if (completedBookingJobs.has(job.id)) return true;
              return String(job.status || "").toLowerCase() === "completed";
            })
            .slice(0, 10)
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              return {
                id: a.id,
                jobId: job?.id,
                service_type: job?.service_type || "Cleaning",
                address: job?.address || "",
                city: job?.city || "",
                state: job?.state || "",
                zip: job?.zip || "",
                start_datetime: job?.start_datetime,
                completed_at: completedAtByJob[job?.id] || job?.check_out_time,
                estimated_pay_cents: a.estimated_pay_cents,
                crew_size_snapshot: a.crew_size_snapshot,
                pay_percentage_snapshot: a.pay_percentage_snapshot,
              };
            });
        }

        if (completedFormatted.length) {
          setCompletedJobs(completedFormatted);
        } else {
          const { data: completedBookings } = await supabase
            .from("bookings")
            .select("*")
            .eq("cleaner_id", cleanerId)
            .eq("status", "completed")
            .order("service_date", { ascending: false })
            .limit(10);

          if (completedBookings?.length) {
            setCompletedJobs(
              completedBookings.map((b: any) => ({
                id: b.id,
                bookingId: b.id,
                service_type: b.service_type || "Cleaning",
                address: b.address || "",
                city: b.city || "",
                state: b.state || "",
                zip_code: b.zip_code,
                service_date: b.service_date,
                time_slot: b.time_slot,
                completed_at: b.completed_at,
                cleaner_payout_cents: b.cleaner_payout_cents,
                estimated_pay_cents: b.cleaner_payout_cents,
              }))
            );
          } else {
            setCompletedJobs([]);
          }
        }
        // Enrich with customer name + ACTUAL pay + job details (non-blocking).
        setPortal(await fetchCleanerPortal(cleanerId));
      } catch (err) {
        console.error("Error fetching jobs:", err);
        setUpcomingJobs([]);
        setCompletedJobs([]);
      } finally {
        setJobsLoading(false);
      }
    },
    []
  );

  // Resolve the enriched portal job for a displayed job (by real jobs.id or booking id).
  const enrichJob = useCallback(
    (job: { jobId?: string; bookingId?: string; id?: string }): PortalJob | undefined => {
      if (!portal) return undefined;
      return (
        (job.jobId ? portal.byJobId.get(job.jobId) : undefined) ||
        (job.bookingId ? portal.byBooking.get(job.bookingId) : undefined)
      );
    },
    [portal],
  );

  const checkAuthAndLoadProfile = useCallback(async () => {
    try {
      // Use the shared cleaner-auth resolver so admin-invited cleaners
      // (cleaner row exists but user_id IS NULL) get auto-linked by
      // email, and rows with onboarding basics filled but the
      // onboarding_complete flag stuck on false get auto-promoted —
      // both of which were producing the
      // dashboard → onboarding → dashboard loop.
      const { cleaner, routing } = await resolveCleanerAuth();

      if (routing === "auth") {
        router.replace("/cleaner/auth");
        return;
      }
      if (routing === "onboarding" || !cleaner) {
        router.replace("/cleaner/onboarding");
        return;
      }
      if (isBlockedCleanerStatus(cleaner.status)) {
        toast.error("Your account is not currently active. Contact support.");
        router.replace("/cleaner/auth");
        return;
      }

      // Re-fetch the FULL cleaner row (resolver only returns a subset).
      // The resolver guarantees user_id is now linked, so the standard
      // RLS-gated query works.
      const { data: full, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("id", cleaner.id)
        .maybeSingle();
      if (error) throw error;
      if (!full) {
        router.replace("/cleaner/onboarding");
        return;
      }

      setProfile(full as CleanerProfile);
      await fetchJobs(full.id, (full as CleanerProfile).pay_percentage);
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [router, fetchJobs]);

  useEffect(() => {
    checkAuthAndLoadProfile();
  }, [checkAuthAndLoadProfile]);

  // ─── Live updates ──────────────────────────────────────────────────────
  // The portal reflects dispatch as it happens: any change to this cleaner's
  // assignments or bookings (new offers, admin assignment, reschedules,
  // cancellations, checklist provisioning) triggers a refetch. A 60s poll
  // backstops environments where the realtime socket can't connect.
  useEffect(() => {
    if (!profile?.id) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => fetchJobs(profile.id, profile.pay_percentage), 400);
    };
    const channel = supabase
      .channel(`cleaner-portal-live-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_assignments", filter: `cleaner_id=eq.${profile.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `cleaner_id=eq.${profile.id}` }, refresh)
      // Pay ledgers + tips: payouts marked paid, extras added, tips received
      // must reflect immediately — the "no true live sync for pay" gap.
      .on("postgres_changes", { event: "*", schema: "public", table: "manual_payouts", filter: `cleaner_id=eq.${profile.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_extra_pay", filter: `cleaner_id=eq.${profile.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cleaner_tips", filter: `cleaner_id=eq.${profile.id}` }, refresh)
      .subscribe();
    const poll = setInterval(() => fetchJobs(profile.id, profile.pay_percentage), 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
    };
  }, [profile?.id, profile?.pay_percentage, fetchJobs]);

  const handleCheckIn = async (job: UpcomingJob) => {
    if (!profile || !job.assignmentId) {
      toast.error("Cannot check in for this job");
      return;
    }
    setActionLoading(`checkin-${job.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("job-check-in", {
        body: {
          jobAssignmentId: job.assignmentId,
          action: "check_in",
          cleanerId: profile.id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Checked in successfully!");
      await fetchJobs(profile.id, profile.pay_percentage);
    } catch (err: any) {
      toast.error(err?.message || "Failed to check in");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkComplete = async (job: UpcomingJob) => {
    if (!profile) return;
    let bookingId = job.bookingId;
    if (!bookingId && job.jobId) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id")
        .eq("job_id", job.jobId)
        .maybeSingle();
      bookingId = booking?.id;
    }
    if (!bookingId) {
      toast.error("Booking not found for this job");
      return;
    }
    setActionLoading(`complete-${job.id}`);
    try {
      // Cleaners submit the job for office review (cleaner-mark-complete) —
      // the full charge + payout flow runs when an admin finalizes it.
      const { data, error } = await supabase.functions.invoke("cleaner-mark-complete", {
        body: { bookingId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Marked complete — sent to the office. Upload your before & after photos to release your payout.");
      await fetchJobs(profile.id, profile.pay_percentage);
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark complete");
    } finally {
      setActionLoading(null);
    }
  };

  const openStripeConnect = async () => {
    if (!profile?.stripe_account_id) {
      setStripeLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "initiate-cleaner-stripe-connect"
        );
        if (error) throw error;
        if (data?.url) {
          window.location.href = data.url;
        }
      } catch (error: any) {
        toast.error("Failed to initiate Stripe setup");
        console.error(error);
      } finally {
        setStripeLoading(false);
      }
      return;
    }

    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-login-link",
        { body: { stripe_account_id: profile.stripe_account_id } }
      );
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        window.open("https://dashboard.stripe.com", "_blank");
      }
    } catch {
      window.open("https://connect.stripe.com/express_login", "_blank");
    } finally {
      setStripeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center space-y-4">
          <RiLoader4Line className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  const stripeStatus = profile.payouts_enabled
    ? "active"
    : profile.stripe_account_id
      ? "pending"
      : "not_setup";

  // Prefer the ACTUAL lifetime-paid total (sum of real payouts) over the
  // running cleaners.total_earnings_cents, which can drift from what was paid.
  const totalEarnings = portal?.summary?.lifetimePaidCents ?? (profile.total_earnings_cents ?? 0);
  const jobsCompleted = profile.completed_bookings ?? 0;
  const rating = profile.average_rating ?? 0;
  const totalRatings = profile.total_ratings ?? 0;
  const upcomingCount = upcomingJobs.length;

  const zipForJob = (j: UpcomingJob | CompletedJob) => j.zip || j.zip_code || "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SEO title="Contractor Dashboard" noindex />

      <div className="panel rounded-2xl p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="Avatar"
              className="w-11 h-11 rounded-xl object-cover ring-1 ring-primary/15"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center">
              <RiUserLine className="w-6 h-6 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-heading font-semibold text-base tracking-tight truncate">
              {profile.first_name} {profile.last_name}
            </p>
            <Badge
              variant="secondary"
              className={
                profile.status === "active"
                  ? "bg-emerald-500/15 text-emerald-700 border-0 text-xs"
                  : "text-xs"
              }
            >
              {profile.status === "active" ? "Active" : profile.status}
            </Badge>
          </div>
        </div>
      </div>

      <main className="space-y-6">
        {/* Suspension status — new assignments paused, pay unaffected. */}
        <SuspensionBanner status={profile.status} suspendedUntil={profile.suspended_until} />

        {/* Someone dropped a job and you're near the top of the list. Above
            the stats because the accept window is measured in minutes. */}
        <CoverageOfferBanner offers={portal?.coverageOffers || []} />
        <RecleanOfferBanner offers={portal?.offers || []} />

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-0 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Total Earnings
                  </p>
                  <p className="text-lg font-bold text-green-600">
                    {formatCurrency(totalEarnings)}
                  </p>
                </div>
                <div className="p-2 rounded-full bg-green-500/10">
                  <RiMoneyDollarCircleLine className="w-5 h-5 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Jobs Completed
                  </p>
                  <p className="text-lg font-bold">{jobsCompleted}</p>
                </div>
                <div className="p-2 rounded-full bg-blue-500/10">
                  <RiCheckboxCircleLine className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Rating</p>
                  <p className="text-lg font-bold">
                    {rating > 0 ? rating.toFixed(1) : "—"}
                  </p>
                  {totalRatings > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {totalRatings} reviews
                    </p>
                  )}
                </div>
                <div className="p-2 rounded-full bg-amber-500/10">
                  <RiStarLine className="w-5 h-5 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Upcoming
                  </p>
                  <p className="text-lg font-bold">{upcomingCount}</p>
                </div>
                <div className="p-2 rounded-full bg-primary/10">
                  <RiTimeLine className="w-5 h-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Jobs */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <RiTimeLine className="w-5 h-5 text-primary" />
              Upcoming Jobs
            </CardTitle>
            <CardDescription>Your scheduled cleaning appointments</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {jobsLoading ? (
              <div className="py-8 text-center">
                <RiLoader4Line className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Loading jobs...</p>
              </div>
            ) : upcomingJobs.length === 0 ? (
              <div className="py-8 text-center">
                <RiTimeLine className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No upcoming jobs scheduled
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  New assignments will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingJobs.map((job) => {
                  const dateTime = job.start_datetime
                    ? format(new Date(job.start_datetime), "EEEE, MMM d 'at' h:mm a")
                    : job.service_date && job.time_slot
                      ? `${format(parseServiceDate(job.service_date), "EEEE, MMM d")} at ${job.time_slot}`
                      : "—";
                  const sharePct = profile?.pay_percentage ?? 35;
                  const enriched = enrichJob(job);
                  const pay =
                    enriched?.pay?.displayCents ??
                    job.estimated_pay_cents ??
                    job.cleaner_payout_cents ??
                    (job.total_estimate_cents
                      ? Math.floor(job.total_estimate_cents * sharePct / 100)
                      : null);
                  const isCheckedIn = !!job.check_in_time;
                  const zip = zipForJob(job);
                  const mapsUrl = getGoogleMapsUrl(job.address, job.city, job.state, zip);
                  const calendarUrl = getGoogleCalendarUrl(
                    job.service_type,
                    job.address,
                    job.city,
                    job.state,
                    zip,
                    job.start_datetime,
                    job.service_date,
                    job.time_slot,
                    job.duration_est_hours
                  );

                  return (
                    <div
                      key={job.id}
                      className="rounded-lg border bg-card p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-base">
                            {enriched?.customerName || job.service_type}
                          </h3>
                          {(enriched?.isReclean || job.is_reclean || notesLookLikeReclean(job.notes)) && (
                            <div className="mt-1 space-y-1.5">
                              <RecleanBadge className="text-[10px]" />
                              <RecleanContractorNote
                                compact
                                scope={enriched?.recleanScope || job.reclean_scope}
                                payCents={
                                  enriched?.recleanAssessedValueCents
                                  ?? job.reclean_assessed_value_cents
                                  ?? job.estimated_pay_cents
                                }
                                reliabilityNeutral={/offered/i.test(String(job.status || ""))}
                              />
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground capitalize">
                            {String(job.service_type || "cleaning").replaceAll("_", " ")}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <RiTimeLine className="w-3.5 h-3.5" />
                            {dateTime}
                          </p>
                        </div>
                        {enriched ? (
                          <PayChip pay={enriched.pay} />
                        ) : pay != null ? (
                          <p className="font-semibold text-primary whitespace-nowrap">
                            {formatCurrency(pay)}
                          </p>
                        ) : null}
                      </div>
                      {(job.crew_size_snapshot != null && job.pay_percentage_snapshot != null && pay != null) && (
                        <p className="text-[11px] text-muted-foreground">
                          {payExplanation({
                            cleanerId: profile?.id || "",
                            payTier: normalizePayTier(profile?.pay_tier),
                            crewSize: job.crew_size_snapshot,
                            ratePercent: Number(job.pay_percentage_snapshot),
                            shareCents: pay,
                          })}
                        </p>
                      )}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RiMapPinLine className="w-4 h-4 flex-shrink-0" />
                        <span>
                          {job.address}, {job.city}, {job.state} {zip}
                        </span>
                      </div>
                      {enriched && <JobDetails job={enriched} />}
                      <div className="flex flex-wrap gap-2">
                        {job.checklistToken && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => router.push(`/cleaner/job-checklist/${job.checklistToken}`)}
                          >
                            <RiCheckboxCircleLine className="w-3.5 h-3.5 mr-1.5" />
                            Job Checklist
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(mapsUrl, "_blank")}
                        >
                          <RiMapPinLine className="w-3.5 h-3.5 mr-1.5" />
                          Get Directions
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(calendarUrl, "_blank")}
                        >
                          <RiCalendarLine className="w-3.5 h-3.5 mr-1.5" />
                          Add to Calendar
                        </Button>
                        {job.assignmentId && (
                          <Button
                            size="sm"
                            onClick={() => handleCheckIn(job)}
                            disabled={isCheckedIn || actionLoading === `checkin-${job.id}`}
                          >
                            {actionLoading === `checkin-${job.id}` ? (
                              <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1.5" />
                            ) : null}
                            {isCheckedIn ? "Checked In" : "Check In"}
                          </Button>
                        )}
                        {/* Mark Complete is shown:
                              - any time the cleaner has checked in, OR
                              - whenever a job has NO assignment row (admin
                                assigned the booking directly without going
                                through job_assignments). Without this the
                                booking-only path had no completion button. */}
                        {(isCheckedIn || !job.assignmentId) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleMarkComplete(job)}
                            disabled={actionLoading === `complete-${job.id}`}
                          >
                            {actionLoading === `complete-${job.id}` ? (
                              <RiLoader4Line className="w-3.5 h-3.5 animate-spin mr-1.5" />
                            ) : null}
                            Mark Complete
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed Jobs */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <RiCheckboxCircleLine className="w-5 h-5 text-primary" />
              Completed Jobs
            </CardTitle>
            <CardDescription>Your recent completed appointments</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {jobsLoading ? (
              <div className="py-6 text-center">
                <RiLoader4Line className="w-6 h-6 animate-spin text-primary mx-auto" />
              </div>
            ) : completedJobs.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No completed jobs yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {completedJobs.map((job) => {
                  const dateStr = job.start_datetime
                    ? format(new Date(job.start_datetime), "MMM d, yyyy")
                    : job.service_date
                      ? format(parseServiceDate(job.service_date), "MMM d, yyyy")
                      : "—";
                  const zip = zipForJob(job);
                  const enriched = enrichJob(job);
                  const pay =
                    enriched?.pay?.displayCents ??
                    job.estimated_pay_cents ??
                    job.cleaner_payout_cents ??
                    null;

                  return (
                    <div
                      key={job.id}
                      className="rounded-lg border bg-muted/30 p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{enriched?.customerName || job.service_type}</p>
                          {(enriched?.isReclean || job.is_reclean) && (
                            <RecleanBadge className="mt-0.5 text-[10px]" />
                          )}
                          <p className="text-xs text-muted-foreground">
                            {[job.city, job.state].filter(Boolean).join(", ")} · {dateStr}
                          </p>
                        </div>
                        {enriched ? (
                          <PayChip pay={enriched.pay} />
                        ) : pay != null ? (
                          <p className="font-semibold text-green-600 text-sm">
                            {formatCurrency(pay)}
                          </p>
                        ) : null}
                      </div>
                      {(job.crew_size_snapshot != null && job.pay_percentage_snapshot != null && pay != null) ? (
                        <p className="text-[11px] text-muted-foreground">
                          {payExplanation({
                            cleanerId: profile?.id || "",
                            payTier: normalizePayTier(profile?.pay_tier),
                            crewSize: job.crew_size_snapshot,
                            ratePercent: Number(job.pay_percentage_snapshot),
                            shareCents: pay,
                          })}
                        </p>
                      ) : enriched?.pay?.crewSize != null && enriched?.pay?.ratePercent != null ? (
                        <p className="text-[11px] text-muted-foreground">
                          {enriched.pay.crewSize > 1
                            ? `Crew of ${enriched.pay.crewSize} · ${enriched.pay.ratePercent}% (crew pool)`
                            : `Solo · ${enriched.pay.ratePercent}%`}
                        </p>
                      ) : null}
                      {enriched && <JobDetails job={enriched} />}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stripe / Payments */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <RiBankCardLine className="w-5 h-5 text-primary" />
                Payments & Earnings
              </CardTitle>
              {stripeStatus === "active" && (
                <Badge className="bg-green-500/10 text-green-600 border-0">
                  <RiCheckboxCircleLine className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              )}
              {stripeStatus === "pending" && (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/10 text-amber-600 border-0"
                >
                  <RiErrorWarningLine className="w-3 h-3 mr-1" />
                  Pending
                </Badge>
              )}
            </div>
            <CardDescription>
              {stripeStatus === "active"
                ? "View your earnings, payouts, and financial reports"
                : stripeStatus === "pending"
                  ? "Complete your Stripe setup to start receiving payouts"
                  : "Set up Stripe to receive payments for your work"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <Button
              onClick={openStripeConnect}
              disabled={stripeLoading}
              className="w-full h-12"
              variant={stripeStatus === "active" ? "default" : "outline"}
            >
              {stripeLoading ? (
                <>
                  <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : stripeStatus === "active" ? (
                <>
                  <RiMoneyDollarCircleLine className="w-4 h-4 mr-2" />
                  Open Stripe Dashboard
                  <RiExternalLinkLine className="w-4 h-4 ml-2" />
                </>
              ) : (
                <>
                  <RiSettings3Line className="w-4 h-4 mr-2" />
                  {stripeStatus === "pending" ? "Complete Setup" : "Set Up Payments"}
                </>
              )}
            </Button>
            {stripeStatus === "active" && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                Your Stripe dashboard shows earnings, payouts, tax info, and more
              </p>
            )}
          </CardContent>
        </Card>

        {/* Onboarding Portal */}
        <Card className="border-0 shadow-lg border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <RiCheckboxCircleLine className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Onboarding Portal</p>
                <p className="text-xs text-muted-foreground">
                  Complete your onboarding steps, training, and agreements
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/cleaner/ob-portal")}
              >
                Open
                <RiExternalLinkLine className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Turnover crew jobs */}
        <Card className="border-0 shadow-lg border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <RiMapPinLine className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Turnovers</p>
                <p className="text-xs text-muted-foreground">
                  Confirm, check in, and complete your Airbnb / STR turnovers
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/cleaner/turnovers")}
              >
                Open
                <RiExternalLinkLine className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Need help? Contact support@novaracleaning.com
        </p>
      </main>
    </div>
  );
}
