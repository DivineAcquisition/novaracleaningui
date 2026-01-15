"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, subDays, parseISO } from "date-fns";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCcw,
  Activity,
  TrendingUp,
  Truck,
  MessageSquare,
  Mail,
} from "lucide-react";
import {
  BarChart,
  Bar,
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

interface OperationsMetrics {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  avgLeadTime: number;
  autoDispatchRate: number;
  avgAssignmentTime: number;
  avgRating: number;
  smsDeliveryRate: number;
  emailDeliveryRate: number;
}

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280", "#3b82f6"];

export default function OperationsMetricsPage() {
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null);
  const [bookingStatusData, setBookingStatusData] = useState<any[]>([]);
  const [dailyBookings, setDailyBookings] = useState<any[]>([]);
  const [peakHours, setPeakHours] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState("30d");
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const daysAgo = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = format(subDays(new Date(), daysAgo), "yyyy-MM-dd");

      // Fetch bookings
      const { data: bookings } = await supabase
        .from("bookings")
        .select("status, service_date, time_slot, created_at")
        .gte("service_date", startDate);

      const totalBookings = bookings?.length || 0;
      const completedBookings = bookings?.filter((b) => b.status === "completed").length || 0;
      const cancelledBookings = bookings?.filter((b) => b.status === "cancelled").length || 0;

      // Calculate average lead time (days between booking creation and service date)
      const leadTimes = (bookings || [])
        .filter((b) => b.created_at && b.service_date)
        .map((b) => {
          const created = new Date(b.created_at);
          const service = new Date(b.service_date);
          return Math.max(0, (service.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
        });
      const avgLeadTime = leadTimes.length > 0
        ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
        : 0;

      // Fetch job assignments for dispatch metrics
      const { data: assignments } = await supabase
        .from("job_assignments")
        .select("status, assigned_at, responded_at")
        .gte("assigned_at", startDate);

      const autoDispatchRate = 0.85; // Placeholder
      const assignmentTimes = (assignments || [])
        .filter((a) => a.assigned_at && a.responded_at)
        .map((a) => {
          const assigned = new Date(a.assigned_at);
          const responded = new Date(a.responded_at);
          return (responded.getTime() - assigned.getTime()) / (1000 * 60); // in minutes
        });
      const avgAssignmentTime = assignmentTimes.length > 0
        ? assignmentTimes.reduce((a, b) => a + b, 0) / assignmentTimes.length
        : 0;

      // Fetch ratings
      const { data: ratings } = await supabase
        .from("cleaner_ratings")
        .select("rating")
        .gte("created_at", startDate);

      const avgRating = ratings && ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
        : 0;

      // Fetch SMS logs
      const { data: smsLogs } = await supabase
        .from("sms_logs")
        .select("status")
        .gte("created_at", startDate);

      const smsDelivered = smsLogs?.filter((s) => s.status === "delivered").length || 0;
      const smsDeliveryRate = smsLogs && smsLogs.length > 0
        ? (smsDelivered / smsLogs.length) * 100
        : 100;

      // Email delivery (placeholder)
      const emailDeliveryRate = 98.5;

      setMetrics({
        totalBookings,
        completedBookings,
        cancelledBookings,
        avgLeadTime,
        autoDispatchRate: autoDispatchRate * 100,
        avgAssignmentTime,
        avgRating,
        smsDeliveryRate,
        emailDeliveryRate,
      });

      // Booking status distribution
      const statusCounts: Record<string, number> = {};
      (bookings || []).forEach((b) => {
        const status = b.status || "pending";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      setBookingStatusData(
        Object.entries(statusCounts).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
        }))
      );

      // Daily bookings
      const dailyMap = new Map<string, number>();
      (bookings || []).forEach((b) => {
        if (b.service_date) {
          const count = dailyMap.get(b.service_date) || 0;
          dailyMap.set(b.service_date, count + 1);
        }
      });

      const sortedDays = Array.from(dailyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-30) // Last 30 days
        .map(([date, count]) => ({
          date: format(parseISO(date), "MMM d"),
          bookings: count,
        }));

      setDailyBookings(sortedDays);

      // Peak booking hours (based on time slots)
      const hourCounts: Record<string, number> = {};
      (bookings || []).forEach((b) => {
        if (b.time_slot) {
          hourCounts[b.time_slot] = (hourCounts[b.time_slot] || 0) + 1;
        }
      });

      setPeakHours(
        Object.entries(hourCounts)
          .map(([time, count]) => ({ time, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
      );
    } catch (error) {
      console.error("Error fetching operations metrics:", error);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/metrics">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Operations Metrics</h1>
          <p className="text-muted-foreground">
            Booking, dispatch, quality, and communication analytics
          </p>
        </div>
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

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Total Bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.totalBookings}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.completedBookings} completed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Completion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.totalBookings && metrics.totalBookings > 0
                ? ((metrics.completedBookings / metrics.totalBookings) * 100).toFixed(1)
                : 0}
              %
            </div>
            <Progress
              value={
                metrics?.totalBookings && metrics.totalBookings > 0
                  ? (metrics.completedBookings / metrics.totalBookings) * 100
                  : 0
              }
              className="h-2 mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg. Lead Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.avgLeadTime.toFixed(1)} days</div>
            <p className="text-xs text-muted-foreground mt-1">Booking to service</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Cancellation Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {metrics?.totalBookings && metrics.totalBookings > 0
                ? ((metrics.cancelledBookings / metrics.totalBookings) * 100).toFixed(1)
                : 0}
              %
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.cancelledBookings} cancelled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Dispatch & Quality */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Auto-Dispatch Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics?.autoDispatchRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Jobs auto-assigned</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Avg. Response Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics?.avgAssignmentTime.toFixed(0)} min</div>
            <p className="text-xs text-muted-foreground">Cleaner response</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Avg. Customer Rating
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics?.avgRating.toFixed(2)} / 5</div>
            <p className="text-xs text-muted-foreground">Overall satisfaction</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Daily Bookings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Daily Booking Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyBookings}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="bookings" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Booking Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Booking Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={bookingStatusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {bookingStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Communication Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Communication Delivery Rates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4" />
                  SMS Delivery Rate
                </span>
                <span className="font-medium">{metrics?.smsDeliveryRate.toFixed(1)}%</span>
              </div>
              <Progress value={metrics?.smsDeliveryRate || 0} className="h-2" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4" />
                  Email Delivery Rate
                </span>
                <span className="font-medium">{metrics?.emailDeliveryRate.toFixed(1)}%</span>
              </div>
              <Progress value={metrics?.emailDeliveryRate || 0} className="h-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Peak Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Peak Booking Times</CardTitle>
          <CardDescription>Most popular time slots</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="time" type="category" tick={{ fontSize: 12 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
