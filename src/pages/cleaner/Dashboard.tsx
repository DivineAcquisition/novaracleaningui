import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { User, Settings, Calendar } from "lucide-react";
import { OnboardingChecklist } from "@/components/cleaner/OnboardingChecklist";
import { DashboardStats } from "@/components/cleaner/DashboardStats";
import { ProfileCompletionWizard } from "@/components/cleaner/ProfileCompletionWizard";
import JobOffers from "./JobOffers";
import { UpcomingJobs } from "@/components/cleaner/UpcomingJobs";
import { CompletedJobs } from "@/components/cleaner/CompletedJobs";
import { EarningsPayouts } from "@/components/cleaner/EarningsPayouts";

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const [cleaner, setCleaner] = useState<any>(null);
  const [stats, setStats] = useState({
    totalEarnings: 0,
    jobsCompleted: 0,
    averageRating: 0,
    totalRatings: 0,
    acceptanceRate: 0,
  });
  const [upcomingJobs, setUpcomingJobs] = useState<any[]>([]);
  const [completedBookings, setCompletedBookings] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCleanerData();

    // Set up real-time subscriptions
    const jobAssignmentsChannel = supabase
      .channel('job_assignments_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_assignments'
        },
        () => {
          console.log('Job assignments changed, refreshing data');
          fetchCleanerData();
        }
      )
      .subscribe();

    const bookingsChannel = supabase
      .channel('bookings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings'
        },
        () => {
          console.log('Bookings changed, refreshing data');
          fetchCleanerData();
        }
      )
      .subscribe();

    const payoutsChannel = supabase
      .channel('payouts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payouts'
        },
        () => {
          console.log('Payouts changed, refreshing data');
          fetchCleanerData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(jobAssignmentsChannel);
      supabase.removeChannel(bookingsChannel);
      supabase.removeChannel(payoutsChannel);
    };
  }, []);

  const fetchCleanerData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate("/cleaner/auth");
        return;
      }

      // Fetch cleaner profile
      const { data: cleanerData, error: cleanerError } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (cleanerError || !cleanerData) {
        // User is authenticated but not a cleaner - redirect to home
        navigate("/");
        return;
      }
      
      setCleaner(cleanerData);

      // Fetch stats
      setStats({
        totalEarnings: cleanerData.total_earnings_cents || 0,
        jobsCompleted: cleanerData.completed_bookings || 0,
        averageRating: cleanerData.average_rating || 0,
        totalRatings: cleanerData.total_ratings || 0,
        acceptanceRate: cleanerData.acceptance_rate || 0,
      });

      // Fetch upcoming jobs (confirmed assignments)
      const { data: upcomingData } = await supabase
        .from("job_assignments")
        .select(`
          *,
          job:jobs(*)
        `)
        .eq("cleaner_id", cleanerData.id)
        .eq("status", "Confirmed")
        .gte("job.start_datetime", new Date().toISOString())
        .order("job.start_datetime", { ascending: true })
        .limit(10);

      if (upcomingData) {
        setUpcomingJobs(upcomingData.map(a => ({
          ...a.job,
          role: a.role,
          estimated_pay_cents: a.estimated_pay_cents,
        })));
      }

      // Fetch completed bookings
      const { data: completedData } = await supabase
        .from("bookings")
        .select("*")
        .eq("cleaner_id", cleanerData.id)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(20);

      if (completedData) {
        setCompletedBookings(completedData);
      }

      // Fetch payouts
      const { data: payoutsData } = await supabase
        .from("payouts")
        .select(`
          *,
          booking:bookings(address, city, service_type)
        `)
        .eq("cleaner_id", cleanerData.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (payoutsData) {
        setPayouts(payoutsData);
      }
    } catch (error) {
      console.error("Error fetching cleaner data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const showWizard = cleaner && !cleaner.onboarding_complete;

  return (
    <div className="min-h-screen bg-background">
      {/* Profile Completion Wizard */}
      {showWizard && (
        <ProfileCompletionWizard
          open={showWizard}
          cleaner={cleaner}
          onComplete={fetchCleanerData}
        />
      )}

      {/* Header - Compact for mobile */}
      <div className="border-b sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="container mx-auto px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-bold truncate">
                Hi, {cleaner?.first_name}!
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
                Manage your jobs and earnings
              </p>
            </div>
            <div className="flex gap-1.5 sm:gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 sm:px-3"
                onClick={() => navigate("/cleaner/availability")}
              >
                <Calendar className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline text-xs">Schedule</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 sm:px-3"
                onClick={() => navigate("/cleaner/profile")}
              >
                <User className="w-4 h-4 sm:mr-1.5" />
                <span className="hidden sm:inline text-xs">Profile</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Compact spacing for mobile */}
      <div className="container mx-auto px-3 py-3 sm:px-4 sm:py-4 space-y-3 sm:space-y-4">
        <OnboardingChecklist cleaner={cleaner} onRefresh={fetchCleanerData} />
        
        <DashboardStats stats={stats} />

        <Tabs defaultValue="offers" className="space-y-3 sm:space-y-4">
          <TabsList className="grid w-full grid-cols-4 h-9">
            <TabsTrigger value="offers" className="text-xs sm:text-sm px-1 sm:px-2">
              <span className="hidden sm:inline">Active </span>Offers
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-xs sm:text-sm px-1 sm:px-2">
              <span className="hidden sm:inline">Up</span>coming
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-xs sm:text-sm px-1 sm:px-2">
              <span className="hidden sm:inline">Comple</span>ted
            </TabsTrigger>
            <TabsTrigger value="earnings" className="text-xs sm:text-sm px-1 sm:px-2">
              Earn<span className="hidden sm:inline">ings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="offers">
            <JobOffers />
          </TabsContent>

          <TabsContent value="upcoming">
            <UpcomingJobs jobs={upcomingJobs} />
          </TabsContent>

          <TabsContent value="completed">
            <CompletedJobs jobs={completedBookings} />
          </TabsContent>

          <TabsContent value="earnings">
            <EarningsPayouts payouts={payouts} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
