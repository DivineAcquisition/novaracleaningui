"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import {
  Calendar,
  Crown,
  Gift,
  Plus,
  ArrowRight,
  Clock,
  MapPin,
  Sparkles,
  Activity,
} from "lucide-react";

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string | null;
  city: string;
}

interface MembershipCredits {
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  current_period_end: string;
}

export default function CustomerDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [nextBooking, setNextBooking] = useState<Booking | null>(null);
  const [membership, setMembership] = useState<MembershipCredits | null>(null);
  const [referralCode, setReferralCode] = useState("");
  const [recentActivity, setRecentActivity] = useState<Booking[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      
      setUser(session.user);
      const email = session.user.email;

      setIsLoading(true);
      try {
        const today = format(new Date(), "yyyy-MM-dd");

        const { data: bookings } = await supabase
          .from("bookings")
          .select("id, service_date, time_slot, service_type, status, city")
          .eq("email", email)
          .gte("service_date", today)
          .eq("status", "confirmed")
          .order("service_date", { ascending: true })
          .limit(1);

        if (bookings && bookings.length > 0) {
          setNextBooking(bookings[0]);
        }

        const { data: membershipData } = await supabase
          .from("membership_credits")
          .select("membership_plan, credits_remaining, credits_per_month, current_period_end")
          .eq("email", email)
          .maybeSingle();

        setMembership(membershipData);

        const { data: customer } = await supabase
          .from("customers")
          .select("referral_code")
          .eq("email", email)
          .maybeSingle();

        if (customer?.referral_code) {
          setReferralCode(customer.referral_code);
        }

        const { data: activity } = await supabase
          .from("bookings")
          .select("id, service_date, time_slot, service_type, status, city")
          .eq("email", email)
          .order("service_date", { ascending: false })
          .limit(5);

        setRecentActivity(activity || []);
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const userName = user?.user_metadata?.first_name || user?.email?.split("@")[0] || "there";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {userName}! 👋</h1>
          <p className="text-sm text-muted-foreground">
            Manage your cleanings and membership from here
          </p>
        </div>
        <Button asChild>
          <Link href="/customer/bookings/new">
            <Plus className="mr-2 h-4 w-4" />
            Book a Cleaning
          </Link>
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Next Booking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Next Cleaning
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextBooking ? (
              <div className="space-y-2">
                <p className="text-2xl font-bold">
                  {format(parseISO(nextBooking.service_date), "MMM d")}
                </p>
                <p className="text-sm text-muted-foreground">{nextBooking.time_slot}</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/customer/bookings/${nextBooking.id}`}>
                    View Details
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No upcoming bookings</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/customer/bookings/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Schedule One
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Membership Credits */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary" />
              Membership
            </CardTitle>
          </CardHeader>
          <CardContent>
            {membership ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold">{membership.credits_remaining}</p>
                  <p className="text-sm text-muted-foreground">/ {membership.credits_per_month} credits</p>
                </div>
                <Badge variant="secondary">{membership.membership_plan}</Badge>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href="/customer/membership">
                    Manage
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Not a member yet</p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/customer/membership">
                    <Crown className="mr-2 h-4 w-4" />
                    Join Now
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Referral Program */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Referrals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {referralCode ? (
                <>
                  <p className="text-xs text-muted-foreground">Your code:</p>
                  <p className="text-xl font-bold font-mono tracking-wider">{referralCode}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Share & earn $25 per referral</p>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href="/customer/referrals">
                  View Program
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: "/customer/bookings/new", icon: Plus, label: "Book Cleaning" },
              { href: "/customer/bookings", icon: Calendar, label: "View Bookings" },
              { href: "/customer/addresses", icon: MapPin, label: "Manage Addresses" },
              { href: "/customer/referrals", icon: Gift, label: "Share & Earn" },
            ].map((action) => (
              <Button key={action.href} variant="outline" className="h-auto py-4 flex-col gap-2" asChild>
                <Link href={action.href}>
                  <action.icon className="h-5 w-5" />
                  <span className="text-xs">{action.label}</span>
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Your cleaning history</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/customer/bookings">
              View All
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No bookings yet. Schedule your first cleaning!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{booking.service_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(booking.service_date), "MMM d, yyyy")} • {booking.city}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      booking.status === "completed"
                        ? "secondary"
                        : booking.status === "confirmed"
                        ? "default"
                        : "outline"
                    }
                  >
                    {booking.status || "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
