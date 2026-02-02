"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { format, isPast, isFuture } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface Booking {
  id: string;
  service_date: string;
  time_slot: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  total_estimate_cents: number;
}

export default function Account() {
  const router = useRouter();
  const { user, subscription, signOut, checkSubscription, openCustomerPortal } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      router.push("/auth");
      return;
    }

    loadData();
  }, [user, router]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      await checkSubscription();

      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("*")
        .eq("email", user?.email)
        .order("service_date", { ascending: false })
        .limit(10);

      setBookings((bookingsData || []) as any);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const upcomingBookings = bookings.filter(
    (b) => b.service_date && isFuture(new Date(b.service_date + "T23:59:59"))
  );
  const pastBookings = bookings.filter(
    (b) => b.service_date && isPast(new Date(b.service_date + "T23:59:59"))
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background flex items-center justify-center">
        <i className="ri-loader-4-line text-3xl animate-spin text-primary"></i>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary glow-primary-sm flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>

          <div className="flex items-center gap-2">
            <Link href="/book/zip">
              <Button size="sm" className="glow-primary-sm">
                <i className="ri-add-line mr-1"></i>
                Book
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <i className="ri-logout-box-r-line text-lg"></i>
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-1">My Account</h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <i className="ri-mail-line"></i>
            {user?.email}
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="card-premium">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <i className="ri-vip-crown-line text-primary text-2xl"></i>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Membership</p>
                  <p className="font-semibold text-lg">
                    {subscription?.subscribed ? subscription.plan_name || "Active" : "None"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-premium">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                  <i className="ri-calendar-check-line text-green-600 text-2xl"></i>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Upcoming</p>
                  <p className="font-semibold text-lg">{upcomingBookings.length} bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-premium">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                  <i className="ri-checkbox-circle-line text-muted-foreground text-2xl"></i>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="font-semibold text-lg">{pastBookings.length} bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Bookings */}
        <Card className="card-premium mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <i className="ri-calendar-todo-line text-primary"></i>
                Upcoming Bookings
              </CardTitle>
              <Link href="/book/zip">
                <Button size="sm" className="glow-primary-sm">
                  <i className="ri-add-line mr-1"></i>
                  New Booking
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <div className="text-center py-10">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <i className="ri-calendar-line text-muted-foreground text-3xl"></i>
                </div>
                <p className="font-medium mb-1">No upcoming bookings</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Schedule your next cleaning today
                </p>
                <Link href="/book/zip">
                  <Button className="glow-primary-sm">
                    <i className="ri-calendar-check-line mr-2"></i>
                    Book a Cleaning
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-4 border border-border/50 rounded-xl hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[50px] p-2 bg-primary/10 rounded-lg">
                        <p className="text-xs text-primary font-medium">
                          {format(new Date(booking.service_date + "T12:00:00"), "MMM")}
                        </p>
                        <p className="text-2xl font-bold text-primary">
                          {format(new Date(booking.service_date + "T12:00:00"), "d")}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold">{booking.service_type}</p>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <i className="ri-time-line"></i>
                            {booking.time_slot}
                          </span>
                          <span className="flex items-center gap-1">
                            <i className="ri-map-pin-line"></i>
                            {booking.city}, {booking.state}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge 
                      variant={booking.status === "confirmed" ? "default" : "secondary"}
                      className={booking.status === "confirmed" ? "bg-green-500" : ""}
                    >
                      {booking.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past Bookings */}
        {pastBookings.length > 0 && (
          <Card className="card-premium mb-6">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <i className="ri-history-line text-muted-foreground"></i>
                Booking History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastBookings.slice(0, 5).map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/30"
                  >
                    <div className="flex items-center gap-3">
                      <i className="ri-checkbox-circle-fill text-green-500 text-lg"></i>
                      <div>
                        <p className="font-medium text-sm">{booking.service_type}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.service_date + "T12:00:00"), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    {booking.total_estimate_cents && (
                      <span className="text-sm font-medium">${(booking.total_estimate_cents / 100).toFixed(0)}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Settings */}
        <Card className="card-premium">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <i className="ri-settings-3-line"></i>
              Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-4 border border-border/50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <i className="ri-user-line text-muted-foreground text-lg"></i>
                </div>
                <div>
                  <p className="font-medium">Email</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>

            {subscription?.subscribed && (
              <div className="flex items-center justify-between p-4 border border-border/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <i className="ri-bank-card-line text-muted-foreground text-lg"></i>
                  </div>
                  <div>
                    <p className="font-medium">Billing</p>
                    <p className="text-sm text-muted-foreground">Manage subscription</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={openCustomerPortal}>
                  <i className="ri-external-link-line mr-1"></i>
                  Manage
                </Button>
              </div>
            )}

            <Separator />

            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleSignOut}
            >
              <i className="ri-logout-box-r-line mr-2"></i>
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
