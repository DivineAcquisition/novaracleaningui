import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Settings, Calendar, CheckCircle2, AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OnboardingChecklist } from "@/components/cleaner/OnboardingChecklist";
import { DashboardStats } from "@/components/cleaner/DashboardStats";
import { ProfileCompletionWizard } from "@/components/cleaner/ProfileCompletionWizard";
import { StripeConnectStatus } from "@/components/cleaner/StripeConnectStatus";
import JobOffers from "./JobOffers";
import { UpcomingJobs } from "@/components/cleaner/UpcomingJobs";
import { CompletedJobs } from "@/components/cleaner/CompletedJobs";
import { EarningsPayouts } from "@/components/cleaner/EarningsPayouts";

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  // Handle Stripe return parameters - clean up URL
  useEffect(() => {
    const stripeStatus = searchParams.get('stripe');
    if (stripeStatus) {
      // Clean up URL - the StripeConnectStatus component will handle the status check
      window.history.replaceState({}, '', '/cleaner/dashboard');
    }
  }, [searchParams]);

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
        // User is authenticated but not a cleaner - redirect to onboarding
        navigate("/cleaner/onboarding");
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

      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">
                Welcome back, {cleaner?.first_name}!
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage your jobs and track your earnings
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/cleaner/availability")}
              >
                <Calendar className="mr-2 w-3.5 h-3.5" />
                Availability
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/cleaner/profile")}
              >
                <User className="mr-2 w-3.5 h-3.5" />
                Profile
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-4">
        {/* Stripe Connect Status - Always visible */}
        <div className="mb-4">
          <StripeConnectStatus cleaner={cleaner} onRefresh={fetchCleanerData} />
        </div>

        <OnboardingChecklist cleaner={cleaner} onRefresh={fetchCleanerData} />
        
        <DashboardStats stats={stats} />

        <Tabs defaultValue="offers" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="offers">Active Offers</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="earnings">Earnings</TabsTrigger>
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
