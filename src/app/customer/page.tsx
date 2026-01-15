"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Loader2,
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

        // Fetch next upcoming booking
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

        // Fetch membership credits
        const { data: membershipData } = await supabase
          .from("membership_credits")
          .select("membership_plan, credits_remaining, credits_per_month, current_period_end")
          .eq("email", email)
          .maybeSingle();

        setMembership(membershipData);

        // Fetch customer for referral code
        const { data: customer } = await supabase
          .from("customers")
          .select("referral_code")
          .eq("email", email)
          .maybeSingle();

        if (customer?.referral_code) {
          setReferralCode(customer.referral_code);
        }

        // Fetch recent activity
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welcome back, {userName}! 👋</h1>
          <p className="text-muted-foreground">
            Manage your cleanings and membership from here
          </p>
        </div>
        <Link href="/customer/bookings/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Book a Cleaning
          </Button>
        </Link>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Next Booking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Next Cleaning
            </CardTitle>
          </CardHeader>
          <CardContent>
            {nextBooking ? (
              <div className="space-y-2">
                <p className="text-2xl font-bold">
                  {format(parseISO(nextBooking.service_date), "MMM d")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {nextBooking.time_slot}
                </p>
                <Link href={`/customer/bookings/${nextBooking.id}`}>
                  <Button variant="outline" size="sm" className="mt-2">
                    View Details
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">No upcoming bookings</p>
                <Link href="/customer/bookings/new">
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Schedule One
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Membership Credits */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" />
              Membership
            </CardTitle>
          </CardHeader>
          <CardContent>
            {membership ? (
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold">{membership.credits_remaining}</p>
                  <p className="text-sm text-muted-foreground">
                    / {membership.credits_per_month} credits
                  </p>
                </div>
                <Badge variant="secondary">{membership.membership_plan}</Badge>
                <Link href="/customer/membership">
                  <Button variant="outline" size="sm" className="mt-2">
                    Manage
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">Not a member yet</p>
                <Link href="/customer/membership">
                  <Button variant="outline" size="sm">
                    <Crown className="h-4 w-4 mr-2" />
                    Join Now
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Referral Program */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-5 w-5 text-primary" />
              Referrals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {referralCode ? (
                <>
                  <p className="text-sm text-muted-foreground">Your code:</p>
                  <p className="text-xl font-bold font-mono tracking-wider">
                    {referralCode}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Share & earn $25 per referral
                </p>
              )}
              <Link href="/customer/referrals">
                <Button variant="outline" size="sm" className="mt-2">
                  View Program
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link href="/customer/bookings/new">
              <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                <Plus className="h-5 w-5" />
                <span>Book Cleaning</span>
              </Button>
            </Link>
            <Link href="/customer/bookings">
              <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                <Calendar className="h-5 w-5" />
                <span>View Bookings</span>
              </Button>
            </Link>
            <Link href="/customer/addresses">
              <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                <MapPin className="h-5 w-5" />
                <span>Manage Addresses</span>
              </Button>
            </Link>
            <Link href="/customer/referrals">
              <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                <Gift className="h-5 w-5" />
                <span>Share & Earn</span>
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Your cleaning history</CardDescription>
          </div>
          <Link href="/customer/bookings">
            <Button variant="ghost" size="sm">
              View All
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No bookings yet. Schedule your first cleaning!
            </p>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{booking.service_type}</p>
                      <p className="text-sm text-muted-foreground">
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
