"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO, addDays } from "date-fns";
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
import { ArrowLeft, RefreshCcw, AlertTriangle, Crown } from "lucide-react";
import { toast } from "sonner";

interface MembershipCredit {
  id: string;
  email: string;
  membership_plan: string;
  credits_remaining: number;
  credits_per_month: number;
  current_period_end: string;
  credit_available_date: string | null;
}

export default function CreditManagementPage() {
  const [credits, setCredits] = useState<MembershipCredit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCredits = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("membership_credits")
        .select("*")
        .order("current_period_end", { ascending: true });

      if (error) throw error;
      setCredits(data || []);
    } catch (error) {
      console.error("Error fetching credits:", error);
      toast.error("Failed to load credit data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();
  }, []);

  // Get credits expiring within 7 days
  const expiringCredits = credits.filter((c) => {
    const expiryDate = new Date(c.current_period_end);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 7 && daysUntilExpiry > 0 && c.credits_remaining > 0;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/memberships">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Credit Management</h1>
          <p className="text-muted-foreground">
            Monitor and manage membership credits
          </p>
        </div>
        <Button variant="outline" onClick={fetchCredits}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Expiring Credits Alert */}
      {expiringCredits.length > 0 && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-700">
              <AlertTriangle className="h-5 w-5" />
              Credits Expiring Soon ({expiringCredits.length})
            </CardTitle>
            <CardDescription>
              These members have unused credits that will expire within 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Credits Remaining</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiringCredits.map((credit) => (
                  <TableRow key={credit.id}>
                    <TableCell className="font-medium">{credit.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{credit.membership_plan}</Badge>
                    </TableCell>
                    <TableCell>{credit.credits_remaining}</TableCell>
                    <TableCell className="text-orange-600">
                      {format(parseISO(credit.current_period_end), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* All Credits */}
      <Card>
        <CardHeader>
          <CardTitle>All Membership Credits</CardTitle>
          <CardDescription>
            Complete list of membership credits
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : credits.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No membership credits found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Monthly Allocation</TableHead>
                  <TableHead>Period End</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.map((credit) => {
                  const daysUntilExpiry = Math.ceil(
                    (new Date(credit.current_period_end).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                  );
                  const isExpired = daysUntilExpiry <= 0;
                  const isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= 7;

                  return (
                    <TableRow key={credit.id}>
                      <TableCell className="font-medium">{credit.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1">
                          <Crown className="h-3 w-3" />
                          {credit.membership_plan}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className={credit.credits_remaining === 0 ? "text-muted-foreground" : "font-medium"}>
                          {credit.credits_remaining}
                        </span>
                      </TableCell>
                      <TableCell>{credit.credits_per_month}</TableCell>
                      <TableCell>
                        {format(parseISO(credit.current_period_end), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        {isExpired ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : isExpiringSoon ? (
                          <Badge variant="outline" className="border-orange-300 text-orange-700">
                            Expiring Soon
                          </Badge>
                        ) : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
