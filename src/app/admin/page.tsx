"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  Plus,
  Activity,
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

      const { count: bookingsToday } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("service_date", today);

      const { count: bookingsYesterday } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("service_date", yesterday);

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

      const { count: activeCleaners } = await supabase
        .from("cleaners")
        .select("*", { count: "exact", head: true })
        .eq("status", "active");

      const { count: pendingDispatch } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .gte("service_date", today)
        .eq("status", "confirmed")
        .is("cleaner_id", null);

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

      const { data: upcoming } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, last_name, service_date, time_slot, status, city")
        .gte("service_date", today)
        .order("service_date", { ascending: true })
        .limit(5);

      setUpcomingBookings(upcoming || []);

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
        { name: "Confirmed", value: statusCounts.get("confirmed") || 0, fill: "hsl(var(--primary))" },
        { name: "Completed", value: statusCounts.get("completed") || 0, fill: "hsl(var(--chart-2))" },
        { name: "Cancelled", value: statusCounts.get("cancelled") || 0, fill: "hsl(var(--destructive))" },
        { name: "Pending", value: statusCounts.get("pending") || 0, fill: "hsl(var(--muted-foreground))" },
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
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back! Here's what's happening today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/admin/bookings/intake">
              <Plus className="mr-2 h-4 w-4" />
              New Booking
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Bookings Today</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.bookingsToday}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              {stats.bookingsGrowth >= 0 ? (
                <TrendingUp className="mr-1 h-3 w-3 text-emerald-500" />
              ) : (
                <TrendingDown className="mr-1 h-3 w-3 text-destructive" />
              )}
              <span className={stats.bookingsGrowth >= 0 ? "text-emerald-500" : "text-destructive"}>
                {Math.abs(stats.bookingsGrowth).toFixed(1)}%
              </span>
              <span className="ml-1">from yesterday</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Revenue Today</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.revenueToday)}</div>
            <div className="flex items-center text-xs text-muted-foreground">
              {stats.revenueGrowth >= 0 ? (
                <TrendingUp className="mr-1 h-3 w-3 text-emerald-500" />
              ) : (
                <TrendingDown className="mr-1 h-3 w-3 text-destructive" />
              )}
              <span className={stats.revenueGrowth >= 0 ? "text-emerald-500" : "text-destructive"}>
                {Math.abs(stats.revenueGrowth).toFixed(1)}%
              </span>
              <span className="ml-1">from yesterday</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Active Cleaners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeCleaners}</div>
            <p className="text-xs text-muted-foreground">Available for dispatch</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
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
              <p className="text-xs text-emerald-500">All jobs assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Trend</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={4} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    fillOpacity={1}
                    fill="url(#colorRevenue)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking Status</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bookingStatusData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} />
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
            <CardTitle className="text-base">Upcoming Bookings</CardTitle>
            <CardDescription>Next scheduled cleanings</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/bookings">
              View All
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {upcomingBookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Activity className="h-10 w-10 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No upcoming bookings</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                      <Calendar className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {booking.first_name} {booking.last_name}
                        {booking.booking_number && (
                          <span className="ml-2 text-muted-foreground">
                            #{booking.booking_number}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {format(parseISO(booking.service_date), "MMM d")} • {booking.time_slot} • {booking.city}
                      </p>
                    </div>
                  </div>
                  <Badge variant={booking.status === "confirmed" ? "default" : "secondary"}>
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
          <Card className="group hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Calendar className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">New Booking</h3>
                <p className="text-sm text-muted-foreground">Create manual intake</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/dispatch">
          <Card className="group hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <Truck className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">Dispatch Center</h3>
                <p className="text-sm text-muted-foreground">Manage job assignments</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/metrics">
          <Card className="group hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">View Reports</h3>
                <p className="text-sm text-muted-foreground">Analytics dashboard</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
