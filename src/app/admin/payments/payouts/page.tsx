"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
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
import { ArrowLeft, RefreshCcw, ExternalLink, DollarSign, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Payout {
  id: string;
  booking_id: string;
  cleaner_id: string;
  cleaner_payout_cents: number;
  platform_fee_cents: number;
  total_booking_amount_cents: number;
  status: string;
  stripe_transfer_id: string | null;
  stripe_account_id: string;
  created_at: string;
  processed_at: string | null;
  failed_reason: string | null;
  cleaners?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPayouts = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("payouts")
        .select(`
          *,
          cleaners (first_name, last_name, email)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setPayouts(data || []);
    } catch (error) {
      console.error("Error fetching payouts:", error);
      toast.error("Failed to load payouts");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, []);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="gap-1 bg-green-100 text-green-800">
            <CheckCircle className="h-3 w-3" />
            Completed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Processing
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const pendingPayouts = payouts.filter((p) => p.status === "pending");
  const completedPayouts = payouts.filter((p) => p.status === "completed");
  const failedPayouts = payouts.filter((p) => p.status === "failed");

  const totalPending = pendingPayouts.reduce((sum, p) => sum + p.cleaner_payout_cents, 0);
  const totalCompleted = completedPayouts.reduce((sum, p) => sum + p.cleaner_payout_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/payments">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Cleaner Payouts</h1>
          <p className="text-muted-foreground">
            Manage payments to cleaning professionals
          </p>
        </div>
        <Button variant="outline" onClick={fetchPayouts}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingPayouts.length}</div>
            <p className="text-sm text-muted-foreground">{formatCurrency(totalPending)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedPayouts.length}</div>
            <p className="text-sm text-muted-foreground">{formatCurrency(totalCompleted)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{failedPayouts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payouts.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Payouts Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payout History</CardTitle>
          <CardDescription>All cleaner payouts</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : payouts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No payouts found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Payout Amount</TableHead>
                  <TableHead>Platform Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell>
                      {payout.cleaners ? (
                        <div>
                          <div className="font-medium">
                            {payout.cleaners.first_name} {payout.cleaners.last_name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {payout.cleaners.email}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatCurrency(payout.cleaner_payout_cents)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatCurrency(payout.platform_fee_cents)}
                    </TableCell>
                    <TableCell>{getStatusBadge(payout.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(payout.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {payout.processed_at
                        ? format(parseISO(payout.processed_at), "MMM d, yyyy")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {payout.stripe_transfer_id && (
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={`https://dashboard.stripe.com/transfers/${payout.stripe_transfer_id}`}
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
