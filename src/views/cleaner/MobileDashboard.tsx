"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { RiArrowRightLine, RiNotification3Line } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardStats } from "@/components/cleaner/DashboardStats";
import { OnboardingChecklist } from "@/components/cleaner/OnboardingChecklist";
import { ProfileCompletionWizard } from "@/components/cleaner/ProfileCompletionWizard";
import { UpcomingJobs } from "@/components/cleaner/UpcomingJobs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { Skeleton } from "@/components/ui/skeleton";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useCapacitor } from "@/hooks/use-capacitor";
import { resolveCleanerAuth, isBlockedCleanerStatus } from "@/lib/cleaner-auth";
import { toast } from "sonner";

export default function MobileDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [cleaner, setCleaner] = useState<any>(null);
  const [upcomingJobs, setUpcomingJobs] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalEarnings: 0,
    jobsCompleted: 0,
    averageRating: 0,
    totalRatings: 0,
    acceptanceRate: 0,
  });
  const { isNative } = useCapacitor();
  usePushNotifications();

  const fetchData = async () => {
    try {
      // Shared resolver auto-links admin-invited cleaner rows and
      // auto-promotes onboarding_complete when the wizard fields are
      // populated, so cleaners don't get bounced back to onboarding.
      const { cleaner, routing } = await resolveCleanerAuth();

      if (routing === "auth" || !cleaner) {
        if (routing === "onboarding") {
          router.replace("/cleaner/onboarding");
        } else {
          router.replace("/cleaner/auth");
        }
        return;
      }

      if (isBlockedCleanerStatus(cleaner.status)) {
        toast.error("Your account is not currently active. Contact support.");
        router.replace("/cleaner/auth");
        return;
      }

      const { data: cleanerData } = await supabase
        .from("cleaners")
        .select("*")
        .eq("id", cleaner.id)
        .single();

      if (cleanerData) {
        setCleaner(cleanerData);

        const acceptanceRate = cleanerData.total_offers_received > 0
          ? (cleanerData.total_offers_accepted / cleanerData.total_offers_received) * 100
          : 0;

        setStats({
          totalEarnings: cleanerData.total_earnings_cents || 0,
          jobsCompleted: cleanerData.completed_bookings || 0,
          averageRating: cleanerData.average_rating || 0,
          totalRatings: cleanerData.total_ratings || 0,
          acceptanceRate,
        });

        // Fetch upcoming (accepted) jobs.
        const { data: jobsData } = await supabase
          .from("job_assignments")
          .select(`
            *,
            jobs (
              id,
              service_type,
              start_datetime,
              address,
              city,
              state,
              zip,
              duration_est_hours,
              check_in_time
            )
          `)
          .eq("cleaner_id", cleanerData.id)
          // Match every accepted-style status used across the codebase:
          //   • accept-job-offer (token portal) sets "Confirmed"
          //   • legacy respond-to-offer flow sometimes wrote "accepted"
          //   • admin assign uses "Confirmed" / "Accepted"
          .in("status", ["Confirmed", "Accepted", "accepted", "In Progress"])
          .order("assigned_at", { ascending: true });

        // Resolve booking ids so "Mark done" can call complete-booking.
        const jobIds = (jobsData || []).map((a: any) => a.jobs?.id).filter(Boolean);
        const bookingByJob: Record<string, string> = {};
        if (jobIds.length > 0) {
          const { data: bookingRows } = await supabase
            .from("bookings")
            .select("id, job_id")
            .in("job_id", jobIds);
          (bookingRows || []).forEach((b: any) => {
            if (b.job_id) bookingByJob[b.job_id] = b.id;
          });
        }

        if (jobsData) {
          const formattedJobs = jobsData.map((assignment: any) => ({
            id: assignment.id,
            assignmentId: assignment.id,
            role: assignment.role,
            status: assignment.status,
            estimated_pay_cents: assignment.estimated_pay_cents,
            bookingId: assignment.jobs?.id ? bookingByJob[assignment.jobs.id] : undefined,
            ...assignment.jobs,
          }));
          setUpcomingJobs(formattedJobs);
        }

        // Fetch active (un-responded) offers for the Active Offers tab.
        const { data: offerData } = await supabase
          .from("job_assignments")
          .select(
            "id, role, status, estimated_pay_cents, pay_percentage_snapshot, response_token, assigned_at, jobs (service_type, city, state, start_datetime, duration_est_hours)",
          )
          .eq("cleaner_id", cleanerData.id)
          .ilike("status", "offered")
          .order("assigned_at", { ascending: false });
        setOffers((offerData || []) as any[]);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Offline cache ──────────────────────────────────────────────────
  // Seed the dashboard from the last saved snapshot on mount so the screen
  // is useful with no connection, then persist fresh data whenever it loads.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("novara_pro_dashboard");
      if (raw) {
        const c = JSON.parse(raw);
        if (c.cleaner) setCleaner((prev: any) => prev ?? c.cleaner);
        if (Array.isArray(c.offers)) setOffers((prev: any[]) => (prev.length ? prev : c.offers));
        if (Array.isArray(c.upcomingJobs)) setUpcomingJobs((prev: any[]) => (prev.length ? prev : c.upcomingJobs));
        if (c.stats) setStats((prev: any) => prev ?? c.stats);
      }
    } catch {
      /* ignore cache read errors */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cleaner && offers.length === 0 && upcomingJobs.length === 0) return;
    try {
      localStorage.setItem(
        "novara_pro_dashboard",
        JSON.stringify({ cleaner, offers, upcomingJobs, stats }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, [cleaner, offers, upcomingJobs, stats]);

  const handleRefresh = async () => {
    await fetchData();
  };

  const handleCheckIn = async (job: any) => {
    if (!cleaner?.id || !job?.assignmentId) return;
    setActionLoading(`checkin-${job.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("job-check-in", {
        body: { jobAssignmentId: job.assignmentId, action: "check_in", cleanerId: cleaner.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Checked in. Have a great clean!");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't check in");
    } finally {
      setActionLoading(null);
    }
  };

  const handleComplete = async (job: any) => {
    if (!job?.bookingId) {
      toast.error("Couldn't find the booking for this job. Pull to refresh and try again.");
      return;
    }
    if (!confirm("Mark this job complete? This notifies the office and triggers payout.")) return;
    setActionLoading(`complete-${job.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("complete-booking", {
        body: { bookingId: job.bookingId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Job marked complete.");
      await fetchData();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't complete job");
    } finally {
      setActionLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <MobileHeader title="Dashboard" />
        <div className="p-4 space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  if (cleaner && !cleaner.onboarding_complete) {
    return (
      <>
        <ProfileCompletionWizard
          open={!cleaner.onboarding_complete}
          cleaner={cleaner}
          onComplete={fetchData}
        />
        <MobileBottomNav />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <MobileHeader title="Dashboard" />

      <PullToRefresh onRefresh={handleRefresh}>
        <div className="p-4 space-y-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">
              Welcome back, {cleaner?.first_name}!
            </h2>
            <p className="text-muted-foreground">
              {isNative ? "Mobile App" : "Web Version"}
            </p>
          </div>

          {cleaner && !cleaner.stripe_account_id && (
            <OnboardingChecklist cleaner={cleaner} onRefresh={fetchData} />
          )}

          <DashboardStats stats={stats} />

          <Tabs defaultValue="upcoming" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upcoming" className="text-sm">
                Upcoming Jobs
              </TabsTrigger>
              <TabsTrigger value="offers" className="text-sm">
                Active Offers
                {offers.length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                    {offers.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upcoming" className="mt-4">
              <UpcomingJobs
                jobs={upcomingJobs}
                onCheckIn={handleCheckIn}
                onComplete={handleComplete}
                actionLoading={actionLoading}
              />
            </TabsContent>

            <TabsContent value="offers" className="mt-4">
              {offers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RiNotification3Line className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No active offers at the moment</p>
                  <p className="text-xs mt-1">
                    You&apos;ll get a text + push the moment a job opens nearby.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {offers.map((o) => (
                    <Card key={o.id} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-base capitalize">
                            {String(o.jobs?.service_type || "cleaning").replaceAll("_", " ")}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {o.jobs?.start_datetime
                              ? format(new Date(o.jobs.start_datetime), "EEE, MMM d · h:mm a")
                              : "—"}
                            {o.jobs?.city ? ` · ${o.jobs.city}, ${o.jobs.state || ""}` : ""}
                          </p>
                        </div>
                        <Badge className="bg-amber-100 text-amber-800 border-0 hover:bg-amber-100 text-[10px]">
                          New offer
                        </Badge>
                      </div>
                      <p className="text-lg font-bold text-primary mb-3">
                        ${((o.estimated_pay_cents || 0) / 100).toFixed(2)}
                        {o.pay_percentage_snapshot ? (
                          <span className="text-xs font-medium text-muted-foreground">
                            {" "}
                            · {o.pay_percentage_snapshot}% share
                          </span>
                        ) : null}
                      </p>
                      {o.response_token ? (
                        <Button
                          asChild
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Link href={`/cleaner/job-offer/${o.response_token}`}>
                            Review &amp; respond
                            <RiArrowRightLine className="w-4 h-4 ml-1.5" />
                          </Link>
                        </Button>
                      ) : (
                        <p className="text-xs text-amber-700">
                          Offer link unavailable — contact dispatch.
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </PullToRefresh>

      <MobileBottomNav />
    </div>
  );
}
