"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Crown,
  CreditCard,
  Calendar,
  CheckCircle,
  ArrowRight,
  ExternalLink,
  Loader2,
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
}

export default function MembershipPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchMembership = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("membership_credits")
          .select("*")
          .eq("email", session.user.email)
          .maybeSingle();

        if (error && error.code !== "PGRST116") throw error;
        setMembership(data);
      } catch (error) {
        console.error("Error fetching membership:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembership();
  }, []);

  const handleManageBilling = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.email) return;

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: { email: session.user.email },
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
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membership</h1>
          <p className="text-sm text-muted-foreground">Join our membership program for exclusive benefits</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary">
                <Crown className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <CardTitle>Novara Membership</CardTitle>
                <CardDescription>Save more with monthly cleanings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <span className="text-3xl font-bold">$189</span>
              <span className="text-muted-foreground">/month</span>
            </div>

            <ul className="space-y-2">
              {[
                "Monthly standard cleaning included",
                "Priority scheduling",
                "Same cleaner each visit",
                "10% off additional services",
                "Pause or cancel anytime",
              ].map((feature, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>

            <Button size="lg" className="w-full" asChild>
              <a href="https://try.novaracleaning.com">
                Join Membership
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const creditPercentage = (membership.credits_remaining / membership.credits_per_month) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Membership</h1>
        <p className="text-sm text-muted-foreground">Manage your membership and credits</p>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">{membership.membership_plan}</CardTitle>
                <CardDescription>Active Membership</CardDescription>
              </div>
            </div>
            <Badge>Active</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Credits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Credits Remaining</span>
              <span className="font-medium">{membership.credits_remaining} / {membership.credits_per_month}</span>
            </div>
            <Progress value={creditPercentage} className="h-2" />
            <p className="text-xs text-muted-foreground">{membership.credits_used} credits used this period</p>
          </div>

          {/* Renewal Date */}
          <div className="flex items-center justify-between py-3 border-t">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>Next Renewal</span>
            </div>
            <span className="text-sm font-medium">
              {format(parseISO(membership.current_period_end), "MMMM d, yyyy")}
            </span>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-2 gap-3">
            <Button asChild>
              <Link href="/customer/bookings/new">Use Credit</Link>
            </Button>
            <Button variant="outline" onClick={handleManageBilling} disabled={isProcessing}>
              {isProcessing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Manage
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Billing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={handleManageBilling} disabled={isProcessing}>
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="mr-2 h-4 w-4" />
            )}
            Manage Billing
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Update payment method, view invoices, or cancel subscription
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
