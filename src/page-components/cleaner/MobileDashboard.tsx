"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { DashboardStats } from "@/components/cleaner/DashboardStats";
import { OnboardingChecklist } from "@/components/cleaner/OnboardingChecklist";
import { ProfileCompletionWizard } from "@/components/cleaner/ProfileCompletionWizard";
import { UpcomingJobs } from "@/components/cleaner/UpcomingJobs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MobileHeader } from "@/components/mobile/MobileHeader";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { PullToRefresh } from "@/components/mobile/PullToRefresh";
import { Skeleton } from "@/components/ui/skeleton";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useCapacitor } from "@/hooks/use-capacitor";

export default function MobileDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [cleaner, setCleaner] = useState<any>(null);
  const [upcomingJobs, setUpcomingJobs] = useState<any[]>([]);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/cleaner/auth");
        return;
      }

      const { data: cleanerData } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", user.id)
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

        // Fetch upcoming jobs
        const { data: jobsData } = await supabase
          .from("job_assignments")
          .select(`
            *,
            jobs (
              service_type,
              start_datetime,
              address,
              city,
              state,
              zip,
              duration_est_hours
            )
          `)
          .eq("cleaner_id", cleanerData.id)
          .eq("status", "accepted")
          .order("assigned_at", { ascending: true });

        if (jobsData) {
          const formattedJobs = jobsData.map((assignment: any) => ({
            id: assignment.id,
            role: assignment.role,
            estimated_pay_cents: assignment.estimated_pay_cents,
            ...assignment.jobs,
          }));
          setUpcomingJobs(formattedJobs);
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = async () => {
    await fetchData();
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
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="upcoming" className="mt-4">
              <UpcomingJobs jobs={upcomingJobs} />
            </TabsContent>
            
            <TabsContent value="offers" className="mt-4">
              <div className="text-center py-8 text-muted-foreground">
                No active offers at the moment
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </PullToRefresh>

      <MobileBottomNav />
    </div>
  );
}
