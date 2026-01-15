"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, subDays } from "date-fns";
import {
  Calendar,
  DollarSign,
  Users,
  Truck,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

interface DashboardStats {
  bookingsToday: number;
  bookingsGrowth: number;
  revenueToday: number;
  revenueGrowth: number;
  activeCleaners: number;
  pendingDispatch: number;
}

interface UpcomingBooking {
  id: string;
  booking_number: number | null;
  first_name: string;
  last_name: string;
  service_date: string;
  time_slot: string;
  status: string | null;
  city: string;
}

export default function AdminDashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>({
    bookingsToday: 0,
    bookingsGrowth: 0,
    revenueToday: 0,
    revenueGrowth: 0,
    activeCleaners: 0,
    pendingDispatch: 0,
  });
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [bookingStatusData, setBookingStatusData] = useState<any[]>([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

      // Bookings today
      const { count: bookingsToday } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("service_date", today);

      const { count: bookingsYesterday } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("service_date", yesterday);

      // Revenue today
      const { data: revenueTodayData } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .eq("service_date", today)
        .in("status", ["confirmed", "completed"]);

      const { data: revenueYesterdayData } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .eq("service_date", yesterday)
        .in("status", ["confirmed", "completed"]);

      const revenueToday = (revenueTodayData || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );
      const revenueYesterday = (revenueYesterdayData || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      // Active cleaners
      const { count: activeCleaners } = await supabase
        .from("cleaners")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      // Pending dispatch (unassigned jobs)
      const { count: pendingDispatch } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .gte("service_date", today)
        .eq("status", "confirmed")
        .is("cleaner_id", null);

      // Calculate growth percentages
      const bookingsGrowth = bookingsYesterday
        ? ((bookingsToday || 0) - bookingsYesterday) / bookingsYesterday * 100
        : 0;
      const revenueGrowth = revenueYesterday
        ? (revenueToday - revenueYesterday) / revenueYesterday * 100
        : 0;

      setStats({
        bookingsToday: bookingsToday || 0,
        bookingsGrowth,
        revenueToday,
        revenueGrowth,
        activeCleaners: activeCleaners || 0,
        pendingDispatch: pendingDispatch || 0,
      });

      // Upcoming bookings
      const { data: upcoming } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, last_name, service_date, time_slot, status, city")
        .gte("service_date", today)
        .order("service_date", { ascending: true })
        .limit(5);

      setUpcomingBookings(upcoming || []);

      // Revenue chart data (last 30 days)
      const last30Days = Array.from({ length: 30 }, (_, i) => {
        const date = subDays(new Date(), 29 - i);
        return format(date, "yyyy-MM-dd");
      });

      const { data: revenueChartData } = await supabase
        .from("bookings")
        .select("service_date, total_estimate_cents")
        .gte("service_date", last30Days[0])
        .in("status", ["confirmed", "completed"]);

      const revenueByDay = new Map<string, number>();
      last30Days.forEach((d) => revenueByDay.set(d, 0));
      (revenueChartData || []).forEach((b) => {
        const current = revenueByDay.get(b.service_date) || 0;
        revenueByDay.set(b.service_date, current + (b.total_estimate_cents || 0));
      });

      setRevenueData(
        last30Days.map((date) => ({
          date: format(parseISO(date), "MMM d"),
          revenue: (revenueByDay.get(date) || 0) / 100,
        }))
      );

      // Booking status data
      const { data: statusData } = await supabase
        .from("bookings")
        .select("status")
        .gte("service_date", last30Days[0]);

      const statusCounts = new Map<string, number>();
      (statusData || []).forEach((b) => {
        const status = b.status || "pending";
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      });

      setBookingStatusData([
        { name: "Confirmed", value: statusCounts.get("confirmed") || 0 },
        { name: "Completed", value: statusCounts.get("completed") || 0 },
        { name: "Cancelled", value: statusCounts.get("cancelled") || 0 },
        { name: "Pending", value: statusCounts.get("pending") || 0 },
      ]);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back! Here's what's happening today.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Bookings Today</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.bookingsToday}</div>
            <div className={`flex items-center text-xs ${stats.bookingsGrowth >= 0 ? "text-green-600" : "text-red-600"}`}>
              {stats.bookingsGrowth >= 0 ? (
                <TrendingUp className="h-3 w-3 mr-1" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-1" />
              )}
              {Math.abs(stats.bookingsGrowth).toFixed(1)}% from yesterday
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Revenue Today</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.revenueToday)}</div>
            <div className={`flex items-center text-xs ${stats.revenueGrowth >= 0 ? "text-green-600" : "text-red-600"}`}>
              {stats.revenueGrowth >= 0 ? (
                <TrendingUp className="h-3 w-3 mr-1" />
              ) : (
                <TrendingDown className="h-3 w-3 mr-1" />
              )}
              {Math.abs(stats.revenueGrowth).toFixed(1)}% from yesterday
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Cleaners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeCleaners}</div>
            <p className="text-xs text-muted-foreground">Available for dispatch</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Dispatch</CardTitle>
            <Truck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingDispatch}</div>
            {stats.pendingDispatch > 0 ? (
              <Link href="/admin/dispatch" className="text-xs text-primary hover:underline">
                View dispatch queue →
              </Link>
            ) : (
              <p className="text-xs text-green-600">All jobs assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary))"
                    fillOpacity={0.2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Booking Status */}
        <Card>
          <CardHeader>
            <CardTitle>Booking Status (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bookingStatusData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Bookings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Upcoming Bookings</CardTitle>
            <CardDescription>Next scheduled cleanings</CardDescription>
          </div>
          <Link href="/admin/bookings">
            <Button variant="ghost" size="sm">
              View All <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {upcomingBookings.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              No upcoming bookings
            </p>
          ) : (
            <div className="space-y-4">
              {upcomingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">
                        {booking.first_name} {booking.last_name}
                        {booking.booking_number && (
                          <span className="text-muted-foreground ml-2">
                            #{booking.booking_number}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="h-3 w-3" />
                        {format(parseISO(booking.service_date), "MMM d")} • {booking.time_slot} • {booking.city}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      booking.status === "confirmed"
                        ? "default"
                        : booking.status === "completed"
                        ? "secondary"
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

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/admin/bookings/intake">
          <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Calendar className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">New Booking</h3>
                  <p className="text-sm text-muted-foreground">Create manual intake</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/dispatch">
          <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Truck className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">Dispatch Center</h3>
                  <p className="text-sm text-muted-foreground">Manage job assignments</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/metrics">
          <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">View Reports</h3>
                  <p className="text-sm text-muted-foreground">Analytics dashboard</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
