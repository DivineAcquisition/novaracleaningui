"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { motion } from "framer-motion";

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
  const router = useRouter();
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
    } catch (error) {
      console.error("Error loading profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/cleaner/auth");
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
      const { data, error } = await supabase.functions.invoke("create-stripe-login-link", {
        body: { stripe_account_id: profile.stripe_account_id },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        window.open("https://dashboard.stripe.com", "_blank");
      }
    } catch (error) {
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                className="w-10 h-10 rounded-full object-cover border-2 border-primary/20"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
            <div>
              <p className="font-semibold text-sm">
                {profile.first_name} {profile.last_name}
              </p>
              <Badge
                variant="secondary"
                className={
                  profile.status === "active"
                    ? "bg-green-500/10 text-green-600 text-xs"
                    : "text-xs"
                }
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
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Welcome Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="border-0 shadow-xl bg-gradient-to-br from-primary to-purple-600 text-white overflow-hidden">
            <CardContent className="p-6 relative">
              <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute right-8 bottom-0 w-24 h-24 bg-white/5 rounded-full translate-y-1/2" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className="w-5 h-5" />
                  <span className="text-white/80 text-sm">Cleaner Dashboard</span>
                </div>
                <h1 className="text-2xl font-bold mb-2">
                  Welcome back, {profile.first_name}!
                </h1>
                <p className="text-white/80 text-sm">
                  Manage your earnings and view financial metrics in your Stripe dashboard.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Stripe Connect Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  Payments & Earnings
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
                className={`w-full h-12 ${
                  stripeStatus === "active" ? "bg-gradient-primary" : ""
                }`}
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

              {stripeStatus === "active" && (
                <p className="text-xs text-muted-foreground text-center mt-3">
                  Your Stripe dashboard shows earnings, payouts, tax info, and more
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Pay Rate Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card className="border-0 shadow-lg bg-gradient-to-r from-green-500/5 to-emerald-500/5 border-green-500/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center">
                  <DollarSign className="w-7 h-7 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Your Pay Rate</p>
                  <p className="text-3xl font-bold text-green-600">$18/hour</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Assignments via</p>
                  <p className="text-sm font-medium">Email & SMS</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Profile Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
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
        </motion.div>

        {/* Help Text */}
        <p className="text-xs text-center text-muted-foreground px-4">
          Need help? Contact support@novaracleaning.com
        </p>
      </main>
    </div>
  );
}
