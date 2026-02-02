"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  User,
  CreditCard,
  Calendar,
  LogOut,
  Settings,
  Loader2,
  CheckCircle,
  Clock,
  MapPin,
  Plus,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold">NovaraCleaning</span>
          </Link>

          <div className="flex items-center gap-2">
            <Link href="/book/zip">
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Book
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1">My Account</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Membership</p>
                  <p className="font-medium">
                    {subscription?.subscribed ? subscription.plan_name || "Active" : "None"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Upcoming</p>
                  <p className="font-medium">{upcomingBookings.length} bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Completed</p>
                  <p className="font-medium">{pastBookings.length} bookings</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Bookings */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Upcoming Bookings</CardTitle>
              <Link href="/book/zip">
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  New Booking
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium mb-1">No upcoming bookings</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Schedule your next cleaning today
                </p>
                <Link href="/book/zip">
                  <Button>Book a Cleaning</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[50px]">
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.service_date + "T12:00:00"), "MMM")}
                        </p>
                        <p className="text-xl font-bold">
                          {format(new Date(booking.service_date + "T12:00:00"), "d")}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium">{booking.service_type}</p>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {booking.time_slot}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {booking.city}, {booking.state}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>
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
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Booking History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {pastBookings.slice(0, 5).map((booking) => (
                  <div
                    key={booking.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      <div>
                        <p className="font-medium text-sm">{booking.service_type}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(booking.service_date + "T12:00:00"), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    {booking.total_estimate_cents && (
                      <span className="text-sm">${(booking.total_estimate_cents / 100).toFixed(0)}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <User className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Email</p>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>

            {subscription?.subscribed && (
              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Billing</p>
                    <p className="text-sm text-muted-foreground">Manage subscription</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={openCustomerPortal}>
                  Manage
                </Button>
              </div>
            )}

            <Separator />

            <Button
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
