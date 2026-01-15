"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, subDays, subMonths, eachMonthOfInterval, parseISO } from "date-fns";
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
  Users,
  UserPlus,
  TrendingUp,
  TrendingDown,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Clock,
  Repeat,
  DollarSign,
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
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface CustomerMetrics {
  totalCustomers: number;
  newThisMonth: number;
  activeCustomers: number;
  membershipRate: number;
  avgLifetimeValue: number;
  churnRate: number;
  retentionRate: number;
  avgBookingFrequency: number;
}

interface CohortData {
  month: string;
  cohortSize: number;
  retentionRates: number[];
}

interface TopCustomer {
  id: string;
  name: string;
  email: string;
  totalSpent: number;
  bookings: number;
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function CustomerMetricsPage() {
  const [metrics, setMetrics] = useState<CustomerMetrics | null>(null);
  const [acquisitionData, setAcquisitionData] = useState<any[]>([]);
  const [segmentData, setSegmentData] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
      const ninetyDaysAgo = format(subDays(new Date(), 90), "yyyy-MM-dd");

      // Total customers
      const { count: totalCustomers } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });

      // New this month
      const startOfMonth = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");
      const { count: newThisMonth } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonth);

      // Active customers (booked in last 30 days)
      const { data: recentBookings } = await supabase
        .from("bookings")
        .select("customer_id")
        .gte("service_date", thirtyDaysAgo);

      const activeCustomers = new Set(recentBookings?.map((b) => b.customer_id) || []).size;

      // Membership rate
      const { count: memberships } = await supabase
        .from("membership_credits")
        .select("customer_id", { count: "exact", head: true });

      const membershipRate = totalCustomers && totalCustomers > 0
        ? ((memberships || 0) / totalCustomers) * 100
        : 0;

      // Calculate avg lifetime value
      const { data: allBookings } = await supabase
        .from("bookings")
        .select("customer_id, total_estimate_cents")
        .in("status", ["confirmed", "completed"]);

      const customerSpending = new Map<string, number>();
      (allBookings || []).forEach((b) => {
        if (b.customer_id) {
          const current = customerSpending.get(b.customer_id) || 0;
          customerSpending.set(b.customer_id, current + (b.total_estimate_cents || 0));
        }
      });

      const avgLifetimeValue = customerSpending.size > 0
        ? Array.from(customerSpending.values()).reduce((a, b) => a + b, 0) / customerSpending.size
        : 0;

      // Churned customers (no booking in 90 days but had previous bookings)
      const { data: oldBookings } = await supabase
        .from("bookings")
        .select("customer_id")
        .lt("service_date", ninetyDaysAgo);

      const oldCustomers = new Set(oldBookings?.map((b) => b.customer_id) || []);
      const { data: recentActiveBookings } = await supabase
        .from("bookings")
        .select("customer_id")
        .gte("service_date", ninetyDaysAgo);

      const recentActive = new Set(recentActiveBookings?.map((b) => b.customer_id) || []);
      const churned = [...oldCustomers].filter((c) => !recentActive.has(c)).length;
      const churnRate = oldCustomers.size > 0 ? (churned / oldCustomers.size) * 100 : 0;
      const retentionRate = 100 - churnRate;

      // Average booking frequency
      const customerBookingCounts = new Map<string, number>();
      (allBookings || []).forEach((b) => {
        if (b.customer_id) {
          const current = customerBookingCounts.get(b.customer_id) || 0;
          customerBookingCounts.set(b.customer_id, current + 1);
        }
      });

      const avgBookingFrequency = customerBookingCounts.size > 0
        ? Array.from(customerBookingCounts.values()).reduce((a, b) => a + b, 0) / customerBookingCounts.size
        : 0;

      setMetrics({
        totalCustomers: totalCustomers || 0,
        newThisMonth: newThisMonth || 0,
        activeCustomers,
        membershipRate,
        avgLifetimeValue,
        churnRate,
        retentionRate,
        avgBookingFrequency,
      });

      // Acquisition data - monthly
      const months = eachMonthOfInterval({
        start: subMonths(new Date(), 11),
        end: new Date(),
      });

      const { data: allCustomers } = await supabase
        .from("customers")
        .select("created_at")
        .gte("created_at", format(subMonths(new Date(), 11), "yyyy-MM-dd"));

      const monthlyAcquisition = months.map((month) => {
        const monthStr = format(month, "yyyy-MM");
        const count = (allCustomers || []).filter((c) => {
          if (!c.created_at) return false;
          return format(parseISO(c.created_at), "yyyy-MM") === monthStr;
        }).length;

        return {
          month: format(month, "MMM"),
          customers: count,
        };
      });

      setAcquisitionData(monthlyAcquisition);

      // Customer segments
      const segments = [
        { name: "0 bookings", value: 0 },
        { name: "1-5 bookings", value: 0 },
        { name: "6-10 bookings", value: 0 },
        { name: "11+ bookings", value: 0 },
      ];

      customerBookingCounts.forEach((count) => {
        if (count === 0) segments[0].value++;
        else if (count <= 5) segments[1].value++;
        else if (count <= 10) segments[2].value++;
        else segments[3].value++;
      });

      // Count customers with 0 bookings
      const customersWithBookings = new Set(customerBookingCounts.keys());
      const { data: allCustomerIds } = await supabase
        .from("customers")
        .select("id");

      const noBookingCount = (allCustomerIds || []).filter(
        (c) => !customersWithBookings.has(c.id)
      ).length;
      segments[0].value = noBookingCount;

      setSegmentData(segments);

      // Top customers
      const topCustomersList = Array.from(customerSpending.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, spent]) => ({ id, spent, bookings: customerBookingCounts.get(id) || 0 }));

      // Get customer names
      if (topCustomersList.length > 0) {
        const { data: customerDetails } = await supabase
          .from("customers")
          .select("id, first_name, last_name, email")
          .in("id", topCustomersList.map((c) => c.id));

        const topCustomersWithNames = topCustomersList.map((c) => {
          const detail = customerDetails?.find((d) => d.id === c.id);
          return {
            id: c.id,
            name: detail ? `${detail.first_name} ${detail.last_name}` : "Unknown",
            email: detail?.email || "",
            totalSpent: c.spent,
            bookings: c.bookings,
          };
        });

        setTopCustomers(topCustomersWithNames);
      }
    } catch (error) {
      console.error("Error fetching customer metrics:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
          <h1 className="text-2xl font-bold tracking-tight">Customer Metrics</h1>
          <p className="text-muted-foreground">
            Customer acquisition, engagement, and retention analytics
          </p>
        </div>
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
              <Users className="h-4 w-4" />
              Total Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.totalCustomers.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              +{metrics?.newThisMonth} this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Active Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.activeCustomers.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Booked in last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Avg. Lifetime Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics?.avgLifetimeValue || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Per customer
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Repeat className="h-4 w-4" />
              Retention Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics?.retentionRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              90-day retention
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Acquisition Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Customer Acquisition
            </CardTitle>
            <CardDescription>New customers per month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={acquisitionData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="customers" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Customer Segments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Customer Segments
            </CardTitle>
            <CardDescription>By booking count</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segmentData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {segmentData.map((entry, index) => (
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

      {/* Additional Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Membership Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics?.membershipRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">Of customers are members</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Churn Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">
              {metrics?.churnRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">90-day inactivity</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg. Booking Frequency</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{metrics?.avgBookingFrequency.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">Bookings per customer</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Customers */}
      <Card>
        <CardHeader>
          <CardTitle>Top Customers by Lifetime Value</CardTitle>
          <CardDescription>Highest spending customers</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Bookings</TableHead>
                <TableHead className="text-right">Total Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.map((customer, index) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Badge variant={index < 3 ? "default" : "outline"}>
                      #{index + 1}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/portal/users/customers/${customer.id}`}
                      className="font-medium hover:underline"
                    >
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.email}
                  </TableCell>
                  <TableCell>{customer.bookings}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(customer.totalSpent)}
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
