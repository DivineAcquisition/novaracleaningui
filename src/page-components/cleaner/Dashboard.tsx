"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EarningsPayouts } from "@/components/cleaner/EarningsPayouts";
import { CompletedJobs } from "@/components/cleaner/CompletedJobs";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  User,
  CreditCard,
  Settings,
  Briefcase,
  Clock,
  Star,
} from "lucide-react";

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
  pay_rate_hr: number;
  total_earnings_cents: number | null;
  completed_bookings: number | null;
  average_rating: number | null;
  total_ratings: number | null;
}

export default function CleanerDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [completedJobs, setCompletedJobs] = useState<any[]>([]);
  const [financialsLoading, setFinancialsLoading] = useState(true);

  useEffect(() => {
    checkAuthAndLoadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAuthAndLoadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push("/cleaner/auth");
        return;
      }

      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!cleaner || !cleaner.onboarding_complete) {
        router.push("/cleaner/onboarding");
        return;
      }

      setProfile(cleaner as CleanerProfile);
      loadFinancials(cleaner.id);
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const loadFinancials = async (cleanerId: string) => {
    setFinancialsLoading(true);
    try {
      // Payout history (with the related booking address for display)
      const { data: payoutData } = await supabase
        .from("payouts")
        .select("*, booking:bookings(address, service_date, service_type)")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false });

      // Completed jobs assigned to this cleaner
      const { data: jobsData } = await supabase
        .from("bookings")
        .select(
          "id, service_type, service_date, address, city, first_name, last_name, cleaner_payout_cents, payout_status, estimated_duration_hours, cleaner_hourly_rate_cents, rating_submitted"
        )
        .eq("cleaner_id", cleanerId)
        .eq("status", "completed")
        .order("service_date", { ascending: false });

      setPayouts(payoutData || []);
      setCompletedJobs(jobsData || []);
    } catch (error) {
      console.error("Error loading financials:", error);
    } finally {
      setFinancialsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/cleaner/auth");
  };

  const openStripeConnect = async () => {
    if (!profile?.stripe_account_id) {
      // Need to set up Stripe first
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

    // Redirect to Stripe Express Dashboard
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-stripe-login-link",
        {
          body: { stripe_account_id: profile.stripe_account_id }
        }
      );

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        // Fallback to Stripe dashboard
        window.open("https://dashboard.stripe.com", "_blank");
      }
    } catch (error) {
      // Fallback: open Stripe Express dashboard directly
      window.open("https://connect.stripe.com/express_login", "_blank");
    } finally {
      setStripeLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
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

  // Earnings figures (in cents)
  const totalPaidOut = payouts
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + (p.cleaner_payout_cents || 0), 0);

  const pendingAmount = payouts
    .filter((p) => p.status === "processing" || p.status === "pending")
    .reduce((sum, p) => sum + (p.cleaner_payout_cents || 0), 0);

  const totalEarnings = profile.total_earnings_cents || totalPaidOut;
  const jobsCompleted = profile.completed_bookings ?? completedJobs.length;
  const payRate = profile.pay_rate_hr || 18;

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                className="w-10 h-10 rounded-full object-cover border-2 border-primary/20"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
            )}
            <div>
              <p className="font-semibold text-sm">{profile.first_name} {profile.last_name}</p>
              <Badge
                variant="secondary"
                className={profile.status === "active" ? "bg-green-500/10 text-green-600 text-xs" : "text-xs"}
              >
                {profile.status === "active" ? "Active" : profile.status}
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleSignOut}>
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Earnings summary stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-0 shadow-lg bg-gradient-to-br from-primary to-purple-600 text-white">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-white/80" />
                <p className="text-xs text-white/80">Total Earnings</p>
              </div>
              <p className="text-2xl font-bold">{formatCurrency(totalEarnings)}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-amber-500" />
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <p className="text-2xl font-bold text-amber-600">{formatCurrency(pendingAmount)}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Briefcase className="w-4 h-4 text-blue-500" />
                <p className="text-xs text-muted-foreground">Jobs Completed</p>
              </div>
              <p className="text-2xl font-bold">{jobsCompleted}</p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Star className="w-4 h-4 text-yellow-500" />
                <p className="text-xs text-muted-foreground">Avg Rating</p>
              </div>
              <p className="text-2xl font-bold">
                {profile.average_rating ? profile.average_rating.toFixed(1) : "—"}
                {profile.total_ratings ? (
                  <span className="text-xs text-muted-foreground font-normal ml-1">
                    ({profile.total_ratings})
                  </span>
                ) : null}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Stripe Connect Status */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Payments & Payouts
              </CardTitle>
              {stripeStatus === "active" && (
                <Badge className="bg-green-500/10 text-green-600 border-0">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              )}
              {stripeStatus === "pending" && (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-0">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Pending
                </Badge>
              )}
            </div>
            <CardDescription>
              {stripeStatus === "active"
                ? "Your payouts are sent to your linked bank account via Stripe"
                : stripeStatus === "pending"
                  ? "Complete your Stripe setup to start receiving payouts"
                  : "Set up Stripe to receive payments for your work"
              }
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
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : stripeStatus === "active" ? (
                <>
                  <DollarSign className="w-4 h-4 mr-2" />
                  Open Stripe Dashboard
                  <ExternalLink className="w-4 h-4 ml-2" />
                </>
              ) : (
                <>
                  <Settings className="w-4 h-4 mr-2" />
                  {stripeStatus === "pending" ? "Complete Setup" : "Set Up Payments"}
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-3">
              Your pay rate is{" "}
              <span className="font-semibold text-foreground">${payRate}/hour</span>
            </p>
          </CardContent>
        </Card>

        {/* Payouts & Completed Jobs */}
        <Tabs defaultValue="payouts" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payouts">Payout History</TabsTrigger>
            <TabsTrigger value="jobs">Completed Jobs</TabsTrigger>
          </TabsList>
          <TabsContent value="payouts" className="mt-4">
            {financialsLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
              </div>
            ) : (
              <EarningsPayouts payouts={payouts} />
            )}
          </TabsContent>
          <TabsContent value="jobs" className="mt-4">
            {financialsLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
              </div>
            ) : (
              <CompletedJobs jobs={completedJobs} />
            )}
          </TabsContent>
        </Tabs>

        {/* Onboarding Portal Link */}
        <Card className="border-0 shadow-lg border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-primary" />
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
                <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Profile Summary */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Profile Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="font-medium truncate">{profile.email}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="font-medium">{profile.phone}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Help Text */}
        <p className="text-xs text-center text-muted-foreground px-4">
          Need help? Contact support@novaracleaning.com
        </p>
      </main>
    </div>
  );
}
