"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, subDays, subMonths, eachDayOfInterval, eachMonthOfInterval, parseISO } from "date-fns";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  TrendingDown,
  RefreshCcw,
  Calendar,
  CreditCard,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface RevenueMetrics {
  totalRevenue: number;
  membershipRevenue: number;
  oneTimeRevenue: number;
  avgOrderValue: number;
  totalBookings: number;
  revenueGrowth: number;
}

interface ServiceBreakdown {
  name: string;
  value: number;
  count: number;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function RevenueMetricsPage() {
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null);
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [serviceBreakdown, setServiceBreakdown] = useState<ServiceBreakdown[]>([]);
  const [homeSizeBreakdown, setHomeSizeBreakdown] = useState<any[]>([]);
  const [timeRange, setTimeRange] = useState("30d");
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const daysAgo = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
      const startDate = format(subDays(new Date(), daysAgo), "yyyy-MM-dd");
      const prevStartDate = format(subDays(new Date(), daysAgo * 2), "yyyy-MM-dd");
      const prevEndDate = startDate;

      // Fetch current period revenue
      const { data: bookings } = await supabase
        .from("bookings")
        .select("total_estimate_cents, service_type, home_size_id, payment_option, service_date")
        .gte("service_date", startDate)
        .in("status", ["confirmed", "completed"]);

      const totalRevenue = (bookings || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      const membershipBookings = (bookings || []).filter(
        (b) => b.payment_option === "membership"
      );
      const membershipRevenue = membershipBookings.reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      const oneTimeRevenue = totalRevenue - membershipRevenue;
      const avgOrderValue = bookings && bookings.length > 0 ? totalRevenue / bookings.length : 0;

      // Previous period for growth calculation
      const { data: prevBookings } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .gte("service_date", prevStartDate)
        .lt("service_date", prevEndDate)
        .in("status", ["confirmed", "completed"]);

      const prevRevenue = (prevBookings || []).reduce(
        (sum, b) => sum + (b.total_estimate_cents || 0),
        0
      );

      const revenueGrowth = prevRevenue > 0
        ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
        : 0;

      setMetrics({
        totalRevenue,
        membershipRevenue,
        oneTimeRevenue,
        avgOrderValue,
        totalBookings: bookings?.length || 0,
        revenueGrowth,
      });

      // Daily revenue data
      const days = eachDayOfInterval({
        start: subDays(new Date(), daysAgo),
        end: new Date(),
      });

      const dailyData = days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const dayBookings = (bookings || []).filter((b) => b.service_date === dateStr);
        const dayRevenue = dayBookings.reduce(
          (sum, b) => sum + (b.total_estimate_cents || 0),
          0
        );

        return {
          date: format(day, "MMM d"),
          revenue: dayRevenue / 100,
          bookings: dayBookings.length,
        };
      });

      setRevenueData(dailyData);

      // Service type breakdown
      const serviceMap = new Map<string, { value: number; count: number }>();
      (bookings || []).forEach((b) => {
        const type = b.service_type || "Standard";
        const current = serviceMap.get(type) || { value: 0, count: 0 };
        serviceMap.set(type, {
          value: current.value + (b.total_estimate_cents || 0),
          count: current.count + 1,
        });
      });

      setServiceBreakdown(
        Array.from(serviceMap.entries()).map(([name, data]) => ({
          name,
          value: data.value / 100,
          count: data.count,
        }))
      );

      // Home size breakdown (using home_size_id)
      const homeSizeMap = new Map<string, number>();
      (bookings || []).forEach((b) => {
        const size = b.home_size_id || "Unknown";
        const current = homeSizeMap.get(size) || 0;
        homeSizeMap.set(size, current + (b.total_estimate_cents || 0));
      });

      setHomeSizeBreakdown(
        Array.from(homeSizeMap.entries()).map(([name, value]) => ({
          name,
          value: value / 100,
        }))
      );
    } catch (error) {
      console.error("Error fetching revenue metrics:", error);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const formatCurrency = (value: number, isCents = false) => {
    const amount = isCents ? value / 100 : value;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

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
          <h1 className="text-2xl font-bold tracking-tight">Revenue Analytics</h1>
          <p className="text-muted-foreground">
            Revenue breakdown, trends, and projections
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
              <DollarSign className="h-4 w-4" />
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics?.totalRevenue || 0, true)}
            </div>
            <p
              className={`text-xs mt-1 flex items-center ${
                (metrics?.revenueGrowth || 0) >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {(metrics?.revenueGrowth || 0) >= 0 ? (
                <TrendingUp className="mr-1 h-3 w-3" />
              ) : (
                <TrendingDown className="mr-1 h-3 w-3" />
              )}
              {Math.abs(metrics?.revenueGrowth || 0).toFixed(1)}% vs prev period
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Membership Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics?.membershipRevenue || 0, true)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.totalRevenue && metrics.totalRevenue > 0
                ? ((metrics.membershipRevenue / metrics.totalRevenue) * 100).toFixed(1)
                : 0}
              % of total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              One-Time Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics?.oneTimeRevenue || 0, true)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.totalBookings || 0} bookings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              Avg. Order Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics?.avgOrderValue || 0, true)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Per booking</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Revenue Trend
          </CardTitle>
          <CardDescription>Daily revenue over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Service Type Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Service Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={serviceBreakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {serviceBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Home Size Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Home Size</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={homeSizeBreakdown} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => `$${v}`} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]} />
                  <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Service Type Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service Type</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceBreakdown.map((service, index) => (
                <TableRow key={service.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      {service.name}
                    </div>
                  </TableCell>
                  <TableCell>{service.count}</TableCell>
                  <TableCell className="text-right font-medium">
                    ${service.value.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {metrics?.totalRevenue && metrics.totalRevenue > 0
                      ? ((service.value * 100 / (metrics.totalRevenue / 100))).toFixed(1)
                      : 0}
                    %
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
