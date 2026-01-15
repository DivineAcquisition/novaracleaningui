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
import { Progress } from "@/components/ui/progress";
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
  UserCog,
  Star,
  Clock,
  CheckCircle,
  XCircle,
  DollarSign,
  RefreshCcw,
  TrendingUp,
  Activity,
  AlertTriangle,
} from "lucide-react";
import {
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
  LineChart,
  Line,
} from "recharts";

interface CleanerMetrics {
  totalCleaners: number;
  activeCleaners: number;
  avgRating: number;
  avgAcceptanceRate: number;
  avgOnTimeRate: number;
  totalPayouts: number;
  pendingPayouts: number;
}

interface TopCleaner {
  id: string;
  name: string;
  rating: number;
  jobs: number;
  earnings: number;
}

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280"];

export default function CleanerMetricsPage() {
  const [metrics, setMetrics] = useState<CleanerMetrics | null>(null);
  const [ratingDistribution, setRatingDistribution] = useState<any[]>([]);
  const [statusDistribution, setStatusDistribution] = useState<any[]>([]);
  const [topCleaners, setTopCleaners] = useState<TopCleaner[]>([]);
  const [underperformers, setUnderperformers] = useState<TopCleaner[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch all cleaners
      const { data: cleaners, count: totalCleaners } = await supabase
        .from("cleaners")
        .select("*", { count: "exact" });

      const activeCleaners = cleaners?.filter((c) => c.status === "active").length || 0;

      // Calculate averages
      const cleanersWithRating = cleaners?.filter((c) => c.average_rating !== null) || [];
      const avgRating = cleanersWithRating.length > 0
        ? cleanersWithRating.reduce((sum, c) => sum + (c.average_rating || 0), 0) / cleanersWithRating.length
        : 0;

      const cleanersWithAcceptance = cleaners?.filter((c) => c.acceptance_rate !== null) || [];
      const avgAcceptanceRate = cleanersWithAcceptance.length > 0
        ? cleanersWithAcceptance.reduce((sum, c) => sum + (c.acceptance_rate || 0), 0) / cleanersWithAcceptance.length
        : 0;

      const cleanersWithOnTime = cleaners?.filter((c) => c.on_time_rate !== null) || [];
      const avgOnTimeRate = cleanersWithOnTime.length > 0
        ? cleanersWithOnTime.reduce((sum, c) => sum + (c.on_time_rate || 0), 0) / cleanersWithOnTime.length
        : 0;

      // Fetch payout data
      const { data: payouts } = await supabase
        .from("payouts")
        .select("cleaner_payout_cents, status");

      const totalPayouts = payouts?.reduce((sum, p) => sum + p.cleaner_payout_cents, 0) || 0;
      const pendingPayouts = payouts
        ?.filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + p.cleaner_payout_cents, 0) || 0;

      setMetrics({
        totalCleaners: totalCleaners || 0,
        activeCleaners,
        avgRating,
        avgAcceptanceRate: avgAcceptanceRate * 100,
        avgOnTimeRate: avgOnTimeRate * 100,
        totalPayouts,
        pendingPayouts,
      });

      // Rating distribution
      const ratingBuckets = [
        { name: "4.5-5.0", count: 0 },
        { name: "4.0-4.5", count: 0 },
        { name: "3.5-4.0", count: 0 },
        { name: "Below 3.5", count: 0 },
        { name: "No Rating", count: 0 },
      ];

      cleaners?.forEach((c) => {
        if (c.average_rating === null) ratingBuckets[4].count++;
        else if (c.average_rating >= 4.5) ratingBuckets[0].count++;
        else if (c.average_rating >= 4.0) ratingBuckets[1].count++;
        else if (c.average_rating >= 3.5) ratingBuckets[2].count++;
        else ratingBuckets[3].count++;
      });

      setRatingDistribution(ratingBuckets);

      // Status distribution
      const statusCounts = [
        { name: "Active", value: 0 },
        { name: "Inactive", value: 0 },
        { name: "Pending", value: 0 },
      ];

      cleaners?.forEach((c) => {
        if (c.status === "active") statusCounts[0].value++;
        else if (c.status === "inactive") statusCounts[1].value++;
        else statusCounts[2].value++;
      });

      setStatusDistribution(statusCounts);

      // Top performers
      const sortedByRating = [...(cleaners || [])]
        .filter((c) => c.average_rating !== null && c.completed_bookings && c.completed_bookings > 5)
        .sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0))
        .slice(0, 10);

      setTopCleaners(
        sortedByRating.map((c) => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          rating: c.average_rating || 0,
          jobs: c.completed_bookings || 0,
          earnings: c.total_earnings_cents || 0,
        }))
      );

      // Underperformers (low rating or low acceptance)
      const underperformersList = [...(cleaners || [])]
        .filter(
          (c) =>
            (c.average_rating !== null && c.average_rating < 4.0) ||
            (c.acceptance_rate !== null && c.acceptance_rate < 0.7) ||
            (c.on_time_rate !== null && c.on_time_rate < 0.8)
        )
        .slice(0, 10);

      setUnderperformers(
        underperformersList.map((c) => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          rating: c.average_rating || 0,
          jobs: c.completed_bookings || 0,
          earnings: c.total_earnings_cents || 0,
        }))
      );
    } catch (error) {
      console.error("Error fetching cleaner metrics:", error);
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
          <h1 className="text-2xl font-bold tracking-tight">Cleaner Metrics</h1>
          <p className="text-muted-foreground">
            Performance, capacity, and reliability analytics
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
              <UserCog className="h-4 w-4" />
              Total Cleaners
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.totalCleaners}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics?.activeCleaners} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Star className="h-4 w-4" />
              Avg. Rating
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-1">
              {metrics?.avgRating.toFixed(2)}
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Across all cleaners</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Acceptance Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.avgAcceptanceRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">Average</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              On-Time Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.avgOnTimeRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground mt-1">Average</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Rating Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5" />
              Rating Distribution
            </CardTitle>
            <CardDescription>Cleaners by rating tier</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Status Distribution
            </CardTitle>
            <CardDescription>Cleaners by status</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistribution.map((entry, index) => (
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

      {/* Payout Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatCurrency(metrics?.totalPayouts || 0)}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">
              {formatCurrency(metrics?.pendingPayouts || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting processing</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Performers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Top Performers
          </CardTitle>
          <CardDescription>Highest rated cleaners with 5+ jobs</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead>
                <TableHead>Cleaner</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCleaners.map((cleaner, index) => (
                <TableRow key={cleaner.id}>
                  <TableCell>
                    <Badge variant={index < 3 ? "default" : "outline"}>
                      #{index + 1}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/portal/users/cleaners/${cleaner.id}`}
                      className="font-medium hover:underline"
                    >
                      {cleaner.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {cleaner.rating.toFixed(1)}
                      <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    </div>
                  </TableCell>
                  <TableCell>{cleaner.jobs}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(cleaner.earnings)}
                  </TableCell>
                </TableRow>
              ))}
              {topCleaners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No data available
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Underperformers */}
      {underperformers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Needs Attention
            </CardTitle>
            <CardDescription>
              Cleaners with below-target metrics (rating &lt; 4.0, acceptance &lt; 70%, on-time &lt; 80%)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Jobs</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {underperformers.map((cleaner) => (
                  <TableRow key={cleaner.id}>
                    <TableCell>
                      <Link
                        href={`/portal/users/cleaners/${cleaner.id}`}
                        className="font-medium hover:underline"
                      >
                        {cleaner.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {cleaner.rating > 0 ? cleaner.rating.toFixed(1) : "N/A"}
                        {cleaner.rating > 0 && (
                          <Star
                            className={`h-4 w-4 ${
                              cleaner.rating >= 4
                                ? "fill-yellow-400 text-yellow-400"
                                : "fill-orange-400 text-orange-400"
                            }`}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{cleaner.jobs}</TableCell>
                    <TableCell>
                      <Link href={`/portal/users/cleaners/${cleaner.id}`}>
                        <Button variant="outline" size="sm">
                          Review
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
