"use client";
export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Search,
  MoreHorizontal,
  Eye,
  RefreshCcw,
  Crown,
  CreditCard,
  ExternalLink,
  Users,
  Gift,
} from "lucide-react";
import { toast } from "sonner";

interface Membership {
  id: string;
  customer_id: string;
  email: string;
  membership_plan: string;
  credits_remaining: number;
  credits_used: number | null;
  credits_per_month: number;
  current_period_start: string;
  current_period_end: string;
  subscription_id: string;
  created_at: string | null;
}

export default function MembershipsPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchMemberships = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("membership_credits")
        .select("*")
        .order("current_period_end", { ascending: true });

      if (searchQuery) {
        query = query.ilike("email", `%${searchQuery}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      setMemberships(data || []);
    } catch (error) {
      console.error("Error fetching memberships:", error);
      toast.error("Failed to load memberships");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchMemberships();
  }, [fetchMemberships]);

  const totalMembers = memberships.length;
  const totalCredits = memberships.reduce((sum, m) => sum + m.credits_remaining, 0);
  const usedCredits = memberships.reduce((sum, m) => sum + (m.credits_used || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Memberships</h1>
          <p className="text-muted-foreground">
            Manage active subscription members
          </p>
        </div>
        <Link href="/portal/memberships/credits">
          <Button variant="outline">
            <Gift className="mr-2 h-4 w-4" />
            Credit Management
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Members
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMembers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Available Credits
            </CardTitle>
            <Crown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCredits}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credits Used (All Time)
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usedCredits}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={fetchMemberships}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Memberships Table */}
      <Card>
        <CardHeader>
          <CardDescription>
            {memberships.length} membership{memberships.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : memberships.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No memberships found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Renewal Date</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((membership) => {
                  const usagePercent = (membership.credits_used || 0) / membership.credits_per_month * 100;
                  const daysUntilRenewal = Math.ceil(
                    (new Date(membership.current_period_end).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                  );

                  return (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{membership.email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1">
                          <Crown className="h-3 w-3" />
                          {membership.membership_plan}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {membership.credits_remaining} / {membership.credits_per_month}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {membership.credits_used || 0} used this period
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={usagePercent}
                            className="h-2 w-20"
                          />
                          <span className="text-sm text-muted-foreground">
                            {Math.round(usagePercent)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {format(parseISO(membership.current_period_end), "MMM d, yyyy")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {daysUntilRenewal > 0
                              ? `in ${daysUntilRenewal} days`
                              : "Expired"}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link href={`/portal/customers/${membership.customer_id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Customer
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a
                                href={`https://dashboard.stripe.com/subscriptions/${membership.subscription_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                View in Stripe
                              </a>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
