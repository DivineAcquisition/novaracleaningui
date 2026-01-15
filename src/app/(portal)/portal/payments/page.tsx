"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format, parseISO, subDays } from "date-fns";
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
  RefreshCcw,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  ExternalLink,
  CreditCard,
  Users,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface PaymentStat {
  label: string;
  value: string;
  change?: string;
  changeType?: "up" | "down";
  icon: React.ReactNode;
}

interface RecentBooking {
  id: string;
  booking_number: number | null;
  first_name: string;
  last_name: string;
  email: string;
  service_date: string;
  total_estimate_cents: number;
  payment_intent_id: string | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
}

export default function PaymentsPage() {
  const [bookings, setBookings] = useState<RecentBooking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<{
    todayRevenue: number;
    weekRevenue: number;
    monthRevenue: number;
    pendingCount: number;
  }>({
    todayRevenue: 0,
    weekRevenue: 0,
    monthRevenue: 0,
    pendingCount: 0,
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const today = format(new Date(), "yyyy-MM-dd");
      const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const monthAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");

      // Fetch recent bookings with payment info
      const { data: bookingsData, error } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, last_name, email, service_date, total_estimate_cents, payment_intent_id, payment_method, status, created_at")
        .not("payment_intent_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setBookings(bookingsData || []);

      // Calculate stats
      const { data: todayData } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .eq("service_date", today);

      const { data: weekData } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .gte("service_date", weekAgo);

      const { data: monthData } = await supabase
        .from("bookings")
        .select("total_estimate_cents")
        .gte("service_date", monthAgo);

      const { count: pendingCount } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      setStats({
        todayRevenue: todayData?.reduce((sum, b) => sum + (b.total_estimate_cents || 0), 0) || 0,
        weekRevenue: weekData?.reduce((sum, b) => sum + (b.total_estimate_cents || 0), 0) || 0,
        monthRevenue: monthData?.reduce((sum, b) => sum + (b.total_estimate_cents || 0), 0) || 0,
        pendingCount: pendingCount || 0,
      });
    } catch (error) {
      console.error("Error fetching payment data:", error);
      toast.error("Failed to load payment data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">
            Overview of revenue and payment transactions
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/portal/payments/payouts">
            <Button variant="outline">
              <Users className="mr-2 h-4 w-4" />
              Cleaner Payouts
            </Button>
          </Link>
          <Link href="/portal/payments/refunds">
            <Button variant="outline">
              <AlertCircle className="mr-2 h-4 w-4" />
              Refunds
            </Button>
          </Link>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today's Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.todayRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This Week
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.weekRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              This Month
            </CardTitle>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.monthRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Payments
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Transactions</CardTitle>
          <CardDescription>
            Recent bookings with payment information
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : bookings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No payment transactions found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bookings.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="font-medium">
                      #{booking.booking_number || "N/A"}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div>{booking.first_name} {booking.last_name}</div>
                        <div className="text-sm text-muted-foreground">{booking.email}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {format(parseISO(booking.service_date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {booking.payment_method || "Card"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          booking.status === "completed"
                            ? "default"
                            : booking.status === "confirmed"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {booking.status || "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(booking.total_estimate_cents)}
                    </TableCell>
                    <TableCell>
                      {booking.payment_intent_id && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={`https://dashboard.stripe.com/payments/${booking.payment_intent_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
