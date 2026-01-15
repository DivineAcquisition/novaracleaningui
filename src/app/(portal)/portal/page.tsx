"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Calendar,
  DollarSign,
  Users,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Eye,
  RefreshCcw,
} from "lucide-react";

interface DashboardStats {
  todayBookings: number;
  todayRevenue: number;
  activeCleaners: number;
  pendingDispatches: number;
  weeklyBookingChange: number;
  weeklyRevenueChange: number;
}

interface RevenueDataPoint {
  date: string;
  revenue: number;
}

interface BookingStatusData {
  name: string;
  value: number;
  color: string;
}

interface UpcomingBooking {
  id: string;
  booking_number: number | null;
  first_name: string;
  last_name: string;
  service_date: string;
  time_slot: string;
  status: string | null;
  total_estimate_cents: number;
  cleaner_name?: string;
}

interface DispatchAlert {
  id: string;
  job_id: string;
  reason: string;
  severity: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: "#22c55e",
  completed: "#3b82f6",
  cancelled: "#ef4444",
  pending: "#f59e0b",
};

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueDataPoint[]>([]);
  const [bookingStatusData, setBookingStatusData] = useState<BookingStatusData[]>([]);
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [dispatchAlerts, setDispatchAlerts] = useState<DispatchAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    const thirtyDaysAgo = format(subDays(today, 30), "yyyy-MM-dd");
    const sevenDaysAgo = format(subDays(today, 7), "yyyy-MM-dd");
    const fourteenDaysAgo = format(subDays(today, 14), "yyyy-MM-dd");

    try {
      // Fetch today's bookings
      const { data: todayBookingsData } = await supabase
        .from("bookings")
        .select("id, total_estimate_cents")
        .eq("service_date", todayStr);

      // Fetch last 7 days bookings for comparison
      const { data: thisWeekBookings } = await supabase
        .from("bookings")
        .select("id, total_estimate_cents")
        .gte("service_date", sevenDaysAgo)
        .lte("service_date", todayStr);

      // Fetch previous 7 days for comparison
      const { data: lastWeekBookings } = await supabase
        .from("bookings")
        .select("id, total_estimate_cents")
        .gte("service_date", fourteenDaysAgo)
        .lt("service_date", sevenDaysAgo);

      // Fetch active cleaners
      const { data: activeCleanersData } = await supabase
        .from("cleaners")
        .select("id")
        .eq("status", "active");

      // Fetch pending dispatches
      const { data: pendingJobsData } = await supabase
        .from("jobs")
        .select("id")
        .in("status", ["pending", "dispatching"]);

      // Calculate stats
      const todayRevenue = todayBookingsData?.reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      ) || 0;

      const thisWeekRevenue = thisWeekBookings?.reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      ) || 0;

      const lastWeekRevenue = lastWeekBookings?.reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      ) || 0;

      const weeklyRevenueChange = lastWeekRevenue > 0
        ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100
        : 0;

      const weeklyBookingChange = (lastWeekBookings?.length || 0) > 0
        ? (((thisWeekBookings?.length || 0) - (lastWeekBookings?.length || 0)) / (lastWeekBookings?.length || 1)) * 100
        : 0;

      setStats({
        todayBookings: todayBookingsData?.length || 0,
        todayRevenue,
        activeCleaners: activeCleanersData?.length || 0,
        pendingDispatches: pendingJobsData?.length || 0,
        weeklyRevenueChange,
        weeklyBookingChange,
      });

      // Fetch revenue data for the last 30 days
      const { data: revenueHistory } = await supabase
        .from("bookings")
        .select("service_date, total_estimate_cents")
        .gte("service_date", thirtyDaysAgo)
        .order("service_date");

      // Aggregate revenue by date
      const revenueByDate = new Map<string, number>();
      revenueHistory?.forEach((booking) => {
        const date = booking.service_date;
        const current = revenueByDate.get(date) || 0;
        revenueByDate.set(date, current + (booking.total_estimate_cents || 0));
      });

      // Fill in missing dates with 0
      const chartData: RevenueDataPoint[] = [];
      for (let i = 30; i >= 0; i--) {
        const date = format(subDays(today, i), "yyyy-MM-dd");
        chartData.push({
          date: format(subDays(today, i), "MMM dd"),
          revenue: (revenueByDate.get(date) || 0) / 100,
        });
      }
      setRevenueData(chartData);

      // Fetch booking status breakdown
      const { data: statusData } = await supabase
        .from("bookings")
        .select("status")
        .gte("service_date", thirtyDaysAgo);

      const statusCounts: Record<string, number> = {};
      statusData?.forEach((booking) => {
        const status = booking.status || "pending";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      setBookingStatusData(
        Object.entries(statusCounts).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
          color: STATUS_COLORS[name] || "#94a3b8",
        }))
      );

      // Fetch upcoming bookings
      const { data: upcomingData } = await supabase
        .from("bookings")
        .select(`
          id,
          booking_number,
          first_name,
          last_name,
          service_date,
          time_slot,
          status,
          total_estimate_cents,
          cleaner_id,
          cleaners (first_name, last_name)
        `)
        .gte("service_date", todayStr)
        .order("service_date")
        .order("time_slot")
        .limit(10);

      setUpcomingBookings(
        (upcomingData || []).map((b: any) => ({
          ...b,
          cleaner_name: b.cleaners
            ? `${b.cleaners.first_name} ${b.cleaners.last_name}`
            : undefined,
        }))
      );

      // Fetch dispatch alerts
      const { data: alertsData } = await supabase
        .from("dispatch_alerts")
        .select("*")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(5);

      setDispatchAlerts(alertsData || []);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStatusBadgeVariant = (status: string | null) => {
    switch (status) {
      case "confirmed":
        return "default";
      case "completed":
        return "secondary";
      case "cancelled":
        return "destructive";
      default:
        return "outline";
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
                <Skeleton className="mt-2 h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[300px] w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's what's happening today.
          </p>
        </div>
        <Button variant="outline" onClick={fetchDashboardData}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today's Bookings</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.todayBookings || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.weeklyBookingChange !== undefined && (
                <span
                  className={`flex items-center ${
                    stats.weeklyBookingChange >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {stats.weeklyBookingChange >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(stats.weeklyBookingChange).toFixed(1)}% from last week
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Today's Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats?.todayRevenue || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.weeklyRevenueChange !== undefined && (
                <span
                  className={`flex items-center ${
                    stats.weeklyRevenueChange >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {stats.weeklyRevenueChange >= 0 ? (
                    <ArrowUpRight className="mr-1 h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="mr-1 h-3 w-3" />
                  )}
                  {Math.abs(stats.weeklyRevenueChange).toFixed(1)}% from last week
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Cleaners</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeCleaners || 0}</div>
            <p className="text-xs text-muted-foreground">
              Ready to accept jobs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Dispatches</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingDispatches || 0}</div>
            <p className="text-xs text-muted-foreground">
              <Link href="/portal/dispatch" className="text-primary hover:underline">
                View dispatch queue →
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Revenue Trend</CardTitle>
            <CardDescription>Daily revenue over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Booking Status</CardTitle>
            <CardDescription>Distribution over the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={bookingStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {bookingStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-4 mt-4">
                {bookingStatusData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {entry.name}: {entry.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dispatch Alerts */}
      {dispatchAlerts.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              Dispatch Alerts
            </CardTitle>
            <CardDescription>
              Unresolved alerts requiring attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dispatchAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between rounded-lg border border-orange-200 bg-white p-3"
                >
                  <div>
                    <p className="font-medium text-orange-800">{alert.reason}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(alert.created_at), "MMM d, h:mm a")}
                    </p>
                  </div>
                  <Badge variant="outline" className="border-orange-300 text-orange-700">
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
            <Link href="/portal/dispatch">
              <Button variant="outline" className="mt-4 w-full">
                View All Dispatch Issues
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Bookings Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Upcoming Bookings</CardTitle>
              <CardDescription>Next scheduled appointments</CardDescription>
            </div>
            <Link href="/portal/bookings">
              <Button variant="outline" size="sm">
                View All
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date & Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cleaner</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcomingBookings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No upcoming bookings
                  </TableCell>
                </TableRow>
              ) : (
                upcomingBookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      #{booking.booking_number || "N/A"}
                    </TableCell>
                    <TableCell>
                      {booking.first_name} {booking.last_name}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {format(new Date(booking.service_date), "MMM d, yyyy")}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {booking.time_slot}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(booking.status)}>
                        {booking.status || "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {booking.cleaner_name || (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(booking.total_estimate_cents)}
                    </TableCell>
                    <TableCell>
                      <Link href={`/portal/bookings/${booking.id}`}>
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
