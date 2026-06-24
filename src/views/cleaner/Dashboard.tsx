"use client";

import {
  RiBankCardLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
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
}

type JobSource = "assignments" | "bookings";

interface EarningsRow {
  id: string;
  propertyName: string;
  date: string | null;
  payCents: number;
  status: string;
}

interface EarningsSummary {
  thisWeekCents: number;
  lifetimeCents: number;
  scheduledCents: number;
  completedCount: number;
  recent: EarningsRow[];
}

const TURNOVER_CLEANER_SHARE = 0.7;

interface UpcomingJob {
  id: string;
  assignmentId?: string;
  bookingId?: string;
  jobId?: string;
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
}

interface CompletedJob {
  id: string;
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
    start = new Date(serviceDate);
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
  const emptyEarnings: EarningsSummary = {
    thisWeekCents: 0,
    lifetimeCents: 0,
    scheduledCents: 0,
    completedCount: 0,
    recent: [],
  };
  const [turnoverPay, setTurnoverPay] = useState<EarningsSummary>(emptyEarnings);
  const [jobPay, setJobPay] = useState<EarningsSummary>(emptyEarnings);

  const fetchJobs = useCallback(
    async (cleanerId: string) => {
      setJobsLoading(true);
      try {
        const upcomingStatuses = [
          "assigned",
          "accepted",
          "Assigned",
          "Accepted",
          "Confirmed",
          "In Progress",
        ];

        const { data: assignments, error: assignmentsError } = await supabase
          .from("job_assignments")
          .select(
            `
            id,
            status,
            estimated_pay_cents,
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
              status
            )
          `
          )
          .eq("cleaner_id", cleanerId)
          .in("status", upcomingStatuses)
          .order("assigned_at", { ascending: true });

        if (!assignmentsError && assignments?.length) {
          const formatted: UpcomingJob[] = assignments
            .filter((a: any) => a.jobs)
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              return {
                id: a.id,
                assignmentId: a.id,
                jobId: job?.id,
                source: "assignments" as JobSource,
                service_type: job?.service_type || "Cleaning",
                address: job?.address || "",
                city: job?.city || "",
                state: job?.state || "",
                zip: job?.zip || "",
                start_datetime: job?.start_datetime,
                duration_est_hours: job?.duration_est_hours,
                estimated_pay_cents: a.estimated_pay_cents,
                check_in_time: job?.check_in_time,
                status: a.status,
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
              estimated_pay_cents: b.cleaner_payout_cents ?? (b.total_estimate_cents && profile?.pay_percentage
                ? Math.floor((b.total_estimate_cents || 0) * profile.pay_percentage / 100)
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

        const completedStatuses = ["Completed", "completed"];
        const { data: completedAssignments } = await supabase
          .from("job_assignments")
          .select(
            `
            id,
            estimated_pay_cents,
            jobs (
              id,
              address,
              city,
              state,
              zip,
              service_type,
              start_datetime,
              check_out_time
            )
          `
          )
          .eq("cleaner_id", cleanerId)
          .in("status", completedStatuses)
          .order("assigned_at", { ascending: false })
          .limit(10);

        if (completedAssignments?.length) {
          const formatted: CompletedJob[] = completedAssignments
            .filter((a: any) => a.jobs)
            .map((a: any) => {
              const job = Array.isArray(a.jobs) ? a.jobs[0] : a.jobs;
              return {
                id: a.id,
                service_type: job?.service_type || "Cleaning",
                address: job?.address || "",
                city: job?.city || "",
                state: job?.state || "",
                zip: job?.zip || "",
                start_datetime: job?.start_datetime,
                completed_at: job?.check_out_time,
                estimated_pay_cents: a.estimated_pay_cents,
              };
            });
          setCompletedJobs(formatted);
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

  // Turnover (STR) pay isn't part of cleaners.total_earnings_cents (that rollup
  // is residential bookings only), so cleaners couldn't see their turnover
  // earnings anywhere. Pull them straight from turnover_requests (RLS lets a
  // cleaner read their own assignments) and compute the 70% share when an
  // explicit payout hasn't been stamped yet.
  const fetchTurnoverEarnings = useCallback(async (cleanerId: string) => {
    try {
      // turnover_requests isn't in the generated Supabase types; cast like the
      // rest of the turnover UI does.
      const { data, error } = await (supabase.from as any)("turnover_requests")
        .select("id, status, price, cleaner_payout_cents, requested_date, completed_at, properties(nickname, address)")
        .eq("assigned_cleaner_id", cleanerId)
        .order("requested_date", { ascending: false })
        .limit(100);
      if (error) throw error;

      const rows = (data || []) as unknown as Array<{
        id: string;
        status: string;
        price: number | null;
        cleaner_payout_cents: number | null;
        requested_date: string | null;
        completed_at: string | null;
        properties: { nickname: string | null; address: string | null } | null;
      }>;

      const payOf = (r: { price: number | null; cleaner_payout_cents: number | null }) =>
        r.cleaner_payout_cents != null
          ? r.cleaner_payout_cents
          : Math.round(Number(r.price || 0) * 100 * TURNOVER_CLEANER_SHARE);

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const SCHEDULED = ["assigned", "cleaner_confirmed", "in_progress"];

      let thisWeekCents = 0;
      let lifetimeCents = 0;
      let scheduledCents = 0;
      let completedCount = 0;
      const recent: EarningsRow[] = [];

      for (const r of rows) {
        const cents = payOf(r);
        const propertyName = r.properties?.nickname || r.properties?.address || "Turnover";
        if (r.status === "completed") {
          lifetimeCents += cents;
          completedCount += 1;
          const when = r.completed_at ? new Date(r.completed_at).getTime() : 0;
          if (when >= weekAgo) thisWeekCents += cents;
          if (recent.length < 6) {
            recent.push({ id: r.id, propertyName, date: r.completed_at || r.requested_date, payCents: cents, status: r.status });
          }
        } else if (SCHEDULED.includes(r.status)) {
          scheduledCents += cents;
        }
      }

      setTurnoverPay({ thisWeekCents, lifetimeCents, scheduledCents, completedCount, recent });
    } catch (err) {
      console.error("Error fetching turnover earnings:", err);
    }
  }, []);

  // Residential job pay also wasn't reflecting: cleaners.total_earnings_cents
  // is stuck at 0 (the rollup isn't maintained), so the headline showed $0 even
  // though completed bookings carry real cleaner_payout_cents. Compute it live
  // from bookings (the authoritative layer — job_assignments mirror the same
  // jobs, so we use bookings only to avoid double counting).
  const fetchJobEarnings = useCallback(async (cleanerId: string, payPct: number | null | undefined) => {
    try {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, status, service_date, completed_at, cleaner_payout_cents, total_estimate_cents, address, city")
        .eq("cleaner_id", cleanerId)
        .order("service_date", { ascending: false })
        .limit(500);
      if (error) throw error;

      const rows = (data || []) as unknown as Array<{
        id: string;
        status: string | null;
        service_date: string | null;
        completed_at: string | null;
        cleaner_payout_cents: number | null;
        total_estimate_cents: number | null;
        address: string | null;
        city: string | null;
      }>;

      const pct = (payPct ?? 35) / 100;
      const payOf = (b: { cleaner_payout_cents: number | null; total_estimate_cents: number | null }) =>
        b.cleaner_payout_cents != null
          ? b.cleaner_payout_cents
          : Math.round(Number(b.total_estimate_cents || 0) * pct);

      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const SCHEDULED = ["confirmed", "assigned", "accepted", "in_progress"];

      let thisWeekCents = 0;
      let lifetimeCents = 0;
      let scheduledCents = 0;
      let completedCount = 0;
      const recent: EarningsRow[] = [];

      for (const b of rows) {
        const cents = payOf(b);
        const name = b.address ? `${b.address}${b.city ? `, ${b.city}` : ""}` : "Cleaning";
        if (b.status === "completed") {
          lifetimeCents += cents;
          completedCount += 1;
          const when = b.completed_at ? new Date(b.completed_at).getTime() : 0;
          if (when >= weekAgo) thisWeekCents += cents;
          if (recent.length < 6) {
            recent.push({ id: b.id, propertyName: name, date: b.completed_at || b.service_date, payCents: cents, status: b.status });
          }
        } else if (b.status && SCHEDULED.includes(b.status)) {
          scheduledCents += cents;
        }
      }

      setJobPay({ thisWeekCents, lifetimeCents, scheduledCents, completedCount, recent });
    } catch (err) {
      console.error("Error fetching job earnings:", err);
    }
  }, []);

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
      await Promise.all([
        fetchJobs(full.id),
        fetchTurnoverEarnings(full.id),
        fetchJobEarnings(full.id, (full as CleanerProfile).pay_percentage),
      ]);
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [router, fetchJobs, fetchTurnoverEarnings, fetchJobEarnings]);

  useEffect(() => {
    checkAuthAndLoadProfile();
  }, [checkAuthAndLoadProfile]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/cleaner/auth");
  };

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
      await fetchJobs(profile.id);
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
      const { data, error } = await supabase.functions.invoke("complete-booking", {
        body: { bookingId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Job marked complete!");
      await fetchJobs(profile.id);
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
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
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

  // Compute totals live (cleaners.total_earnings_cents / completed_bookings
  // rollups aren't maintained — they read 0 even with paid completed jobs).
  const totalEarnings = Math.max(
    profile.total_earnings_cents ?? 0,
    jobPay.lifetimeCents,
  ) + turnoverPay.lifetimeCents;
  const jobsCompleted = Math.max(
    profile.completed_bookings ?? 0,
    jobPay.completedCount,
  ) + turnoverPay.completedCount;
  const rating = profile.average_rating ?? 0;
  const totalRatings = profile.total_ratings ?? 0;
  const upcomingCount = upcomingJobs.length;

  const zipForJob = (j: UpcomingJob | CompletedJob) => j.zip || j.zip_code || "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      <SEO title="Contractor Dashboard" noindex />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-lg border-b shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                className="w-11 h-11 rounded-full object-cover border-2 border-primary/20 ring-2 ring-background"
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-primary/15 flex items-center justify-center ring-2 ring-background">
                <RiUserLine className="w-6 h-6 text-primary" />
              </div>
            )}
            <div>
              <p className="font-semibold text-base">
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
          <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
            <RiLogoutBoxRLine className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
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
                      ? `${format(new Date(job.service_date), "EEEE, MMM d")} at ${job.time_slot}`
                      : "—";
                  const sharePct = profile?.pay_percentage ?? 35;
                  const pay =
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
                          <h3 className="font-semibold text-base">{job.service_type}</h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <RiTimeLine className="w-3.5 h-3.5" />
                            {dateTime}
                          </p>
                        </div>
                        {pay != null && (
                          <p className="font-semibold text-primary whitespace-nowrap">
                            {formatCurrency(pay)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RiMapPinLine className="w-4 h-4 flex-shrink-0" />
                        <span>
                          {job.address}, {job.city}, {job.state} {zip}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                      ? format(new Date(job.service_date), "MMM d, yyyy")
                      : "—";
                  const zip = zipForJob(job);
                  const pay =
                    job.estimated_pay_cents ?? job.cleaner_payout_cents ?? null;

                  return (
                    <div
                      key={job.id}
                      className="rounded-lg border bg-muted/30 p-3 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-medium text-sm">{job.service_type}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.address}, {job.city} · {dateStr}
                        </p>
                      </div>
                      {pay != null && (
                        <p className="font-semibold text-green-600 text-sm">
                          {formatCurrency(pay)}
                        </p>
                      )}
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

        {/* Job earnings (residential) */}
        {(jobPay.lifetimeCents > 0 || jobPay.scheduledCents > 0) && (
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <RiMoneyDollarCircleLine className="w-5 h-5 text-green-600" />
                Job Earnings
              </CardTitle>
              <CardDescription>Your pay from completed & upcoming cleanings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-green-500/5 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">This week</p>
                  <p className="text-base font-bold text-green-600">{formatCurrency(jobPay.thisWeekCents)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">Lifetime</p>
                  <p className="text-base font-bold">{formatCurrency(jobPay.lifetimeCents)}</p>
                </div>
                <div className="rounded-lg bg-amber-500/5 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">Scheduled</p>
                  <p className="text-base font-bold text-amber-600">{formatCurrency(jobPay.scheduledCents)}</p>
                </div>
              </div>
              {jobPay.recent.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Recent job payments</p>
                  {jobPay.recent.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.propertyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.date ? format(new Date(r.date), "MMM d, yyyy") : "—"}
                        </p>
                      </div>
                      <p className="font-semibold text-green-600 flex-shrink-0">{formatCurrency(r.payCents)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Turnover earnings */}
        {(turnoverPay.lifetimeCents > 0 || turnoverPay.scheduledCents > 0) && (
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <RiMoneyDollarCircleLine className="w-5 h-5 text-green-600" />
                Turnover Earnings
              </CardTitle>
              <CardDescription>Your STR / Airbnb turnover pay (70% share)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-green-500/5 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">This week</p>
                  <p className="text-base font-bold text-green-600">{formatCurrency(turnoverPay.thisWeekCents)}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">Lifetime</p>
                  <p className="text-base font-bold">{formatCurrency(turnoverPay.lifetimeCents)}</p>
                </div>
                <div className="rounded-lg bg-amber-500/5 p-3 text-center">
                  <p className="text-[11px] font-medium text-muted-foreground">Scheduled</p>
                  <p className="text-base font-bold text-amber-600">{formatCurrency(turnoverPay.scheduledCents)}</p>
                </div>
              </div>
              {turnoverPay.recent.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Recent turnover payments</p>
                  {turnoverPay.recent.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.propertyName}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.date ? format(new Date(r.date), "MMM d, yyyy") : "—"}
                        </p>
                      </div>
                      <p className="font-semibold text-green-600 flex-shrink-0">{formatCurrency(r.payCents)}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Turnover pay is settled through your weekly payroll. Scheduled is work assigned but not yet completed.
              </p>
            </CardContent>
          </Card>
        )}

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
