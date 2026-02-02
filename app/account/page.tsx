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
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  AlertCircle,
  Home,
  Star,
  ArrowRight,
  Sparkles,
  Crown,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { format, isPast, isFuture } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";

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
  const [membershipCredits, setMembershipCredits] = useState(0);

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

      // Fetch bookings
      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("*")
        .eq("email", user?.email)
        .order("service_date", { ascending: false })
        .limit(10);

      setBookings((bookingsData || []) as any);

      // Get membership credits (skip complex type inference)
      try {
        const { data: customerData } = await (supabase as any)
          .from("customers")
          .select("membership_credits")
          .eq("user_id", user?.id)
          .maybeSingle();

        if (customerData) {
          setMembershipCredits(customerData.membership_credits || 0);
        }
      } catch (e) {
        // Customers table may not have this field
        console.log("Credits not available");
      }
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
      <div className="min-h-screen bg-gradient-to-b from-white via-purple-50/30 to-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your account...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-purple-50/30 to-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold">NovaraCleaning</span>
          </Link>

          <div className="flex items-center gap-3">
            <Link href="/book/zip">
              <Button size="sm" className="bg-gradient-primary">
                <Plus className="w-4 h-4 mr-2" />
                Book Cleaning
              </Button>
            </Link>
            <Button variant="ghost" size="icon" onClick={handleSignOut}>
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8">
        {/* Welcome Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold mb-2">
            Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}!
          </h1>
          <p className="text-muted-foreground">
            Manage your bookings and account settings
          </p>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"
        >
          {/* Membership Card */}
          <Card className={`border-0 shadow-lg ${subscription?.subscribed ? "bg-gradient-primary text-white" : "bg-gradient-to-br from-gray-50 to-gray-100"}`}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Crown className={`w-8 h-8 ${subscription?.subscribed ? "text-white" : "text-primary"}`} />
                {subscription?.subscribed && (
                  <Badge className="bg-white/20 text-white border-0">Active</Badge>
                )}
              </div>
              <h3 className={`text-lg font-semibold mb-1 ${subscription?.subscribed ? "text-white" : ""}`}>
                {subscription?.subscribed ? subscription.plan_name || "Member" : "No Membership"}
              </h3>
              <p className={`text-sm ${subscription?.subscribed ? "text-white/80" : "text-muted-foreground"}`}>
                {subscription?.subscribed ? "You're saving 15% on every clean!" : "Join to save 15%"}
              </p>
              {!subscription?.subscribed && (
                <Link href="/membership">
                  <Button size="sm" className="mt-4 w-full bg-gradient-primary">
                    View Plans
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Credits Card */}
          <Card className="border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <CreditCard className="w-8 h-8 text-green-600" />
                <Badge className="bg-green-100 text-green-700 border-0">
                  {membershipCredits} Available
                </Badge>
              </div>
              <h3 className="text-lg font-semibold mb-1">Cleaning Credits</h3>
              <p className="text-sm text-muted-foreground">
                Use credits for free cleanings
              </p>
              {membershipCredits > 0 && (
                <Link href="/portal/book">
                  <Button size="sm" variant="outline" className="mt-4 w-full">
                    Use Credit
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Card */}
          <Card className="border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <Calendar className="w-8 h-8 text-blue-600" />
                <Badge className="bg-blue-100 text-blue-700 border-0">
                  {upcomingBookings.length} Scheduled
                </Badge>
              </div>
              <h3 className="text-lg font-semibold mb-1">Upcoming Cleanings</h3>
              <p className="text-sm text-muted-foreground">
                {upcomingBookings.length > 0
                  ? `Next: ${format(new Date(upcomingBookings[0].service_date + "T12:00:00"), "MMM d")}`
                  : "No upcoming bookings"}
              </p>
              <Link href="/book/zip">
                <Button size="sm" variant="outline" className="mt-4 w-full">
                  Book Now
                </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>

        {/* Upcoming Bookings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">Upcoming Cleanings</CardTitle>
                  <CardDescription>Your scheduled appointments</CardDescription>
                </div>
                <Link href="/book/zip">
                  <Button size="sm" className="bg-gradient-primary">
                    <Plus className="w-4 h-4 mr-2" />
                    New Booking
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {upcomingBookings.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">No upcoming bookings</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Schedule your next cleaning today
                  </p>
                  <Link href="/book/zip">
                    <Button className="bg-gradient-primary">
                      Book a Cleaning
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {upcomingBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between p-4 rounded-xl border bg-card hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 flex flex-col items-center justify-center">
                          <span className="text-xs text-primary font-medium">
                            {format(new Date(booking.service_date + "T12:00:00"), "MMM")}
                          </span>
                          <span className="text-lg font-bold text-primary">
                            {format(new Date(booking.service_date + "T12:00:00"), "d")}
                          </span>
                        </div>
                        <div>
                          <h4 className="font-semibold">{booking.service_type}</h4>
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
                      <div className="flex items-center gap-3">
                        <Badge
                          className={
                            booking.status === "confirmed"
                              ? "bg-green-100 text-green-700"
                              : "bg-amber-100 text-amber-700"
                          }
                        >
                          {booking.status}
                        </Badge>
                        <Button variant="ghost" size="sm">
                          Details
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Past Bookings */}
        {pastBookings.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-8"
          >
            <Card className="border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl">Booking History</CardTitle>
                <CardDescription>Your past cleanings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pastBookings.slice(0, 5).map((booking) => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                        <div>
                          <p className="font-medium text-sm">{booking.service_type}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(booking.service_date + "T12:00:00"), "MMM d, yyyy")}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {booking.total_estimate_cents && (
                          <span className="text-sm font-medium">
                            ${(booking.total_estimate_cents / 100).toFixed(0)}
                          </span>
                        )}
                        <Button variant="ghost" size="sm" className="text-xs">
                          Rebook
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Account Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Account Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Email</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
              </div>

              {subscription?.subscribed && (
                <div className="flex items-center justify-between p-4 rounded-xl border">
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Billing & Subscription</p>
                      <p className="text-sm text-muted-foreground">
                        Manage payment methods and subscription
                      </p>
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
                className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
