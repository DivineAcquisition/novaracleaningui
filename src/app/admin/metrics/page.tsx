"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserCheck,
  DollarSign,
  Calendar,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCcw,
  BarChart3,
  PieChart,
  Activity,
} from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface KPIs {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  avgBookingValue: number;
  usersGrowth: number;
  revenueGrowth: number;
  activeUsersGrowth: number;
  avgValueGrowth: number;
}

interface DailyData {
  date: string;
  users: number;
  bookings: number;
  revenue: number;
}

export default function MetricsDashboardPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [userGrowthData, setUserGrowthData] = useState<DailyData[]>([]);
  const [revenueData, setRevenueData] = useState<DailyData[]>([]);
  const [bookingData, setBookingData] = useState<DailyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("30d");

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const daysAgo = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = format(subDays(new Date(), daysAgo), "yyyy-MM-dd");
      const prevStartDate = format(subDays(new Date(), daysAgo * 2), "yyyy-MM-dd");
      const prevEndDate = format(subDays(new Date(), daysAgo), "yyyy-MM-dd");

      // Fetch total customers
      const { count: totalCustomers } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });

      const { count: totalCleaners } = await supabase
        .from("cleaners")
        .select("id", { count: "exact", head: true });

      const totalUsers = (totalCustomers || 0) + (totalCleaners || 0);

      // Previous period users
      const { count: prevCustomers } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .lt("created_at", startDate);

      const { count: prevCleaners } = await supabase
        .from("cleaners")
        .select("id", { count: "exact", head: true })
        .lt("created_at", startDate);

      const prevUsers = (prevCustomers || 0) + (prevCleaners || 0);
      const usersGrowth = prevUsers > 0 ? ((totalUsers - prevUsers) / prevUsers) * 100 : 0;

      // Fetch active users (customers with bookings in period)
      const { data: activeCustomersData } = await supabase
        .from("bookings")
        .select("customer_id")
        .gte("service_date", startDate);

      const activeUsers = new Set(activeCustomersData?.map((b) => b.customer_id) || []).size;

      // Previous period active users
      const { data: prevActiveData } = await supabase
        .from("bookings")
        .select("customer_id")
        .gte("service_date", prevStartDate)
        .lt("service_date", prevEndDate);

      const prevActiveUsers = new Set(prevActiveData?.map((b) => b.customer_id) || []).size;
      const activeUsersGrowth = prevActiveUsers > 0
        ? ((activeUsers - prevActiveUsers) / prevActiveUsers) * 100
        : 0;

      // Fetch revenue
      const { data: revenueBookings } = await supabase
        .from("bookings")
        .select("total_estimate_cents, service_date")
        .gte("service_date", startDate)
        .in("status", ["confirmed", "completed"]);

      const totalRevenue = (revenueBookings || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      const avgBookingValue = revenueBookings && revenueBookings.length > 0
        ? totalRevenue / revenueBookings.length
        : 0;

      // Previous period revenue
      const { data: prevRevenueBookings } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .gte("service_date", prevStartDate)
        .lt("service_date", prevEndDate)
        .in("status", ["confirmed", "completed"]);

      const prevRevenue = (prevRevenueBookings || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );
      const revenueGrowth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;

      const prevAvgValue = prevRevenueBookings && prevRevenueBookings.length > 0
        ? prevRevenue / prevRevenueBookings.length
        : 0;
      const avgValueGrowth = prevAvgValue > 0
        ? ((avgBookingValue - prevAvgValue) / prevAvgValue) * 100
        : 0;

      setKpis({
        totalUsers,
        activeUsers,
        totalRevenue,
        avgBookingValue,
        usersGrowth,
        revenueGrowth,
        activeUsersGrowth,
        avgValueGrowth,
      });

      // Generate chart data
      const days = eachDayOfInterval({
        start: subDays(new Date(), daysAgo),
        end: new Date(),
      });

      // Fetch all customers and bookings for charting
      const { data: allCustomers } = await supabase
        .from("customers")
        .select("created_at")
        .gte("created_at", startDate);

      const { data: allBookings } = await supabase
        .from("bookings")
        .select("service_date, total_estimate_cents")
        .gte("service_date", startDate)
        .in("status", ["confirmed", "completed"]);

      const chartData = days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const displayDate = format(day, "MMM d");

        const usersOnDay = (allCustomers || []).filter(
          (c) => c.created_at && format(parseISO(c.created_at), "yyyy-MM-dd") === dateStr
        ).length;

        const bookingsOnDay = (allBookings || []).filter(
          (b) => b.service_date === dateStr
        );

        const revenueOnDay = bookingsOnDay.reduce(
          (sum, b) => sum + (b.total_estimate_cents || 0),
          0
        );

        return {
          date: displayDate,
          users: usersOnDay,
          bookings: bookingsOnDay.length,
          revenue: revenueOnDay / 100, // Convert to dollars
        };
      });

      setUserGrowthData(chartData);
      setRevenueData(chartData);
      setBookingData(chartData);
    } catch (error) {
      console.error("Error fetching metrics:", error);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
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
          <h1 className="text-3xl font-bold tracking-tight">Metrics Dashboard</h1>
          <p className="text-muted-foreground">
            Key performance indicators and analytics
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchMetrics}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Users
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.totalUsers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground flex items-center mt-1">
              {kpis?.usersGrowth !== undefined && (
                <span
                  className={`flex items-center ${
                    kpis.usersGrowth >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {kpis.usersGrowth >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(kpis.usersGrowth).toFixed(1)}% vs previous period
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Users
            </CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.activeUsers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground flex items-center mt-1">
              {kpis?.activeUsersGrowth !== undefined && (
                <span
                  className={`flex items-center ${
                    kpis.activeUsersGrowth >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {kpis.activeUsersGrowth >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(kpis.activeUsersGrowth).toFixed(1)}% vs previous period
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis ? formatCurrency(kpis.totalRevenue) : "$0"}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-1">
              {kpis?.revenueGrowth !== undefined && (
                <span
                  className={`flex items-center ${
                    kpis.revenueGrowth >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {kpis.revenueGrowth >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(kpis.revenueGrowth).toFixed(1)}% vs previous period
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg. Booking Value
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis ? formatCurrency(kpis.avgBookingValue) : "$0"}
            </div>
            <p className="text-xs text-muted-foreground flex items-center mt-1">
              {kpis?.avgValueGrowth !== undefined && (
                <span
                  className={`flex items-center ${
                    kpis.avgValueGrowth >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {kpis.avgValueGrowth >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(kpis.avgValueGrowth).toFixed(1)}% vs previous period
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* User Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              User Growth
            </CardTitle>
            <CardDescription>New user registrations over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={userGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="users"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.2}
                    name="New Users"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Revenue Trend
            </CardTitle>
            <CardDescription>Daily revenue over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.2}
                    name="Revenue"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Booking Volume Chart */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Booking Volume
            </CardTitle>
            <CardDescription>Number of bookings per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bookingData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar
                    dataKey="bookings"
                    fill="#8b5cf6"
                    radius={[4, 4, 0, 0]}
                    name="Bookings"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links to Detailed Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Link href="/portal/metrics/customers">
          <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-5 w-5" />
                Customer Metrics
              </CardTitle>
              <CardDescription>
                Acquisition, engagement, and retention
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/portal/metrics/cleaners">
          <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-5 w-5" />
                Cleaner Metrics
              </CardTitle>
              <CardDescription>
                Performance, capacity, and reliability
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/portal/metrics/revenue">
          <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Revenue Analytics
              </CardTitle>
              <CardDescription>
                Breakdown, trends, and projections
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/portal/metrics/operations">
          <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Operations Metrics
              </CardTitle>
              <CardDescription>
                Bookings, dispatch, and quality
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
