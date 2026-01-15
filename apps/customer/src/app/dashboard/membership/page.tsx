"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { format, parseISO } from "date-fns";
import {
  Crown,
  CreditCard,
  Calendar,
  CheckCircle,
  Loader2,
  ArrowRight,
  Pause,
  Play,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

interface Membership {
  id: string;
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  credits_used: number;
  current_period_end: string;
  subscription_id: string;
  paused_until: string | null;
}

export default function MembershipPage() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchMembership = async () => {
      if (!user?.email) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("membership_credits")
          .select("*")
          .eq("email", user.email)
          .single();

        if (error && error.code !== "PGRST116") throw error;
        setMembership(data);
      } catch (error) {
        console.error("Error fetching membership:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembership();
  }, [user]);

  const handlePauseResume = async () => {
    if (!membership) return;

    setIsProcessing(true);
    try {
      const isPaused = !!membership.paused_until;
      const functionName = isPaused ? "resume-subscription" : "pause-subscription";

      const { error } = await supabase.functions.invoke(functionName, {
        body: { subscriptionId: membership.subscription_id },
      });

      if (error) throw error;

      toast.success(isPaused ? "Subscription resumed!" : "Subscription paused");
      
      // Refresh data
      const { data } = await supabase
        .from("membership_credits")
        .select("*")
        .eq("email", user?.email)
        .single();
      setMembership(data);
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to update subscription");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManageBilling = async () => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: { email: user?.email },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to open billing portal");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Membership</h1>
          <p className="text-muted-foreground">
            Join our membership program for exclusive benefits
          </p>
        </div>

        <Card className="bg-gradient-to-br from-primary/10 to-accent/10">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center">
                <Crown className="h-6 w-6 text-white" />
              </div>
              <div>
                <CardTitle>Novara Membership</CardTitle>
                <CardDescription>Save more with monthly cleanings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-3xl font-bold">
              $189<span className="text-lg font-normal text-muted-foreground">/month</span>
            </div>

            <ul className="space-y-3">
              {[
                "Monthly standard cleaning included",
                "Priority scheduling",
                "Same cleaner each visit",
                "10% off additional services",
                "Pause or cancel anytime",
              ].map((feature, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <a href="https://try.novaracleaning.com">
              <Button className="w-full" size="lg">
                Join Membership
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const creditPercentage = (membership.credits_remaining / membership.credits_per_month) * 100;
  const isPaused = !!membership.paused_until;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Membership</h1>
        <p className="text-muted-foreground">
          Manage your membership and credits
        </p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                <Crown className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle>{membership.membership_plan}</CardTitle>
                <CardDescription>
                  {isPaused ? "Paused" : "Active"} Membership
                </CardDescription>
              </div>
            </div>
            <Badge variant={isPaused ? "secondary" : "default"}>
              {isPaused ? "Paused" : "Active"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Credits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Credits Remaining</span>
              <span className="font-medium">
                {membership.credits_remaining} / {membership.credits_per_month}
              </span>
            </div>
            <Progress value={creditPercentage} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {membership.credits_used} credits used this period
            </p>
          </div>

          {/* Renewal Date */}
          <div className="flex items-center justify-between py-3 border-t">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Next Renewal</span>
            </div>
            <span className="font-medium">
              {format(parseISO(membership.current_period_end), "MMMM d, yyyy")}
            </span>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/dashboard/bookings/new">
              <Button variant="default" className="w-full">
                Use Credit
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={handlePauseResume}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPaused ? (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleManageBilling}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Manage Billing
                <ExternalLink className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Update payment method, view invoices, or cancel subscription
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
