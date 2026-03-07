import {
  RiBankCardLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMoneyDollarCircleLine,
  RiSettings3Line,
  RiUserLine
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { SEO } from "@/components/SEO";

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
}

export default function CleanerDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CleanerProfile | null>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

  useEffect(() => {
    checkAuthAndLoadProfile();
  }, []);

  const checkAuthAndLoadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/cleaner/auth");
        return;
      }

      const { data: cleaner, error } = await supabase
        .from("cleaners")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) throw error;

      if (!cleaner || !cleaner.onboarding_complete) {
        navigate("/cleaner/onboarding");
        return;
      }

      setProfile(cleaner as CleanerProfile);
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/cleaner/auth");
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      <SEO title="Contractor Dashboard" noindex />
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt="Avatar" 
                className="w-10 h-10 rounded-full object-cover border-2 border-primary/20"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <RiUserLine className="w-5 h-5 text-primary" />
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
            <RiLogoutBoxRLine className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Welcome Card */}
        <Card className="border-0 shadow-lg bg-gradient-to-br from-primary to-purple-600 text-white">
          <CardContent className="p-6">
            <h1 className="text-xl font-bold mb-2">Welcome back!</h1>
            <p className="text-white/80 text-sm">
              Manage your earnings and view financial metrics in your Stripe dashboard.
            </p>
          </CardContent>
        </Card>

        {/* Stripe Connect Status */}
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
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-0">
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

        {/* Onboarding Portal Link */}
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
                onClick={() => navigate("/cleaner/ob-portal")}
              >
                Open
                <RiExternalLinkLine className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-0 shadow-lg bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <RiMoneyDollarCircleLine className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-sm">Your Pay Rate</p>
                <p className="text-2xl font-bold text-blue-600">$18/hour</p>
                <p className="text-xs text-muted-foreground mt-1">
                  You'll receive assignments via email and SMS
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Summary */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <RiUserLine className="w-5 h-5 text-primary" />
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
