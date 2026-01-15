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
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  MoreHorizontal,
  Eye,
  Edit,
  Mail,
  Phone,
  RefreshCcw,
  Download,
  Filter,
  X,
  Star,
  CheckCircle,
  DollarSign,
  ArrowLeft,
  ExternalLink,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";

interface Cleaner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  avatar_url: string | null;
  status: string;
  average_rating: number | null;
  completed_bookings: number | null;
  acceptance_rate: number | null;
  on_time_rate: number | null;
  total_earnings_cents: number | null;
  onboarding_complete: boolean | null;
  stripe_account_id: string | null;
  payouts_enabled: boolean | null;
  created_at: string;
}

export default function CleanersListPage() {
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stripeFilter, setStripeFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const fetchCleaners = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("cleaners")
        .select("*", { count: "exact" });

      if (searchQuery) {
        query = query.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`
        );
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (stripeFilter !== "all") {
        if (stripeFilter === "connected") {
          query = query.eq("payouts_enabled", true);
        } else if (stripeFilter === "pending") {
          query = query.not("stripe_account_id", "is", null).eq("payouts_enabled", false);
        } else if (stripeFilter === "not_started") {
          query = query.is("stripe_account_id", null);
        }
      }

      if (ratingFilter !== "all") {
        const minRating = parseFloat(ratingFilter);
        query = query.gte("average_rating", minRating);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      query = query
        .order("created_at", { ascending: false })
        .range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      setCleaners(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error fetching cleaners:", error);
      toast.error("Failed to load cleaners");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, statusFilter, stripeFilter, ratingFilter, page]);

  useEffect(() => {
    fetchCleaners();
  }, [fetchCleaners]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "pending":
        return "outline";
      default:
        return "outline";
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(cleaners.map((c) => c.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    }
  };

  const handleExport = async () => {
    try {
      const { data, error } = await supabase
        .from("cleaners")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const headers = [
        "ID",
        "First Name",
        "Last Name",
        "Email",
        "Phone",
        "Status",
        "Rating",
        "Jobs Completed",
        "Acceptance Rate",
        "On-Time Rate",
        "Total Earnings",
        "Created At",
      ];

      const csvRows = [
        headers.join(","),
        ...((data || []).map((c) =>
          [
            c.id,
            c.first_name,
            c.last_name,
            c.email,
            c.phone,
            c.status,
            c.average_rating || "",
            c.completed_bookings || 0,
            c.acceptance_rate ? (c.acceptance_rate * 100).toFixed(1) + "%" : "",
            c.on_time_rate ? (c.on_time_rate * 100).toFixed(1) + "%" : "",
            c.total_earnings_cents ? (c.total_earnings_cents / 100).toFixed(2) : 0,
            c.created_at || "",
          ].join(",")
        )),
      ];

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cleaners-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Export completed");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export cleaners");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setStripeFilter("all");
    setRatingFilter("all");
    setPage(1);
  };

  const hasActiveFilters = searchQuery || statusFilter !== "all" || stripeFilter !== "all" || ratingFilter !== "all";
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/users">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Cleaners</h1>
          <p className="text-muted-foreground">
            Manage cleaner accounts and performance
          </p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
        <Button variant="outline" onClick={fetchCleaners}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                Clear All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>

            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={stripeFilter}
              onValueChange={(value) => {
                setStripeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Stripe Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Stripe</SelectItem>
                <SelectItem value="connected">Connected</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="not_started">Not Started</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={ratingFilter}
              onValueChange={(value) => {
                setRatingFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Rating</SelectItem>
                <SelectItem value="4.5">4.5+ Stars</SelectItem>
                <SelectItem value="4.0">4.0+ Stars</SelectItem>
                <SelectItem value="3.5">3.5+ Stars</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Cleaners Table */}
      <Card>
        <CardHeader>
          <CardDescription>
            {totalCount} cleaner{totalCount !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : cleaners.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No cleaners found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedIds.length === cleaners.length && cleaners.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Cleaner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Jobs</TableHead>
                    <TableHead>Acceptance</TableHead>
                    <TableHead>On-Time</TableHead>
                    <TableHead>Earnings</TableHead>
                    <TableHead>Stripe</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cleaners.map((cleaner) => (
                    <TableRow key={cleaner.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(cleaner.id)}
                          onCheckedChange={(checked) =>
                            handleSelectOne(cleaner.id, checked as boolean)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={cleaner.avatar_url || undefined} />
                            <AvatarFallback>
                              {cleaner.first_name[0]}
                              {cleaner.last_name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <Link
                              href={`/portal/users/cleaners/${cleaner.id}`}
                              className="font-medium hover:underline flex items-center gap-1"
                            >
                              {cleaner.first_name} {cleaner.last_name}
                              {cleaner.onboarding_complete && (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              )}
                            </Link>
                            <p className="text-xs text-muted-foreground">{cleaner.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(cleaner.status)}>
                          {cleaner.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {cleaner.average_rating ? (
                          <div className="flex items-center gap-1">
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                            <span>{cleaner.average_rating.toFixed(1)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          {cleaner.completed_bookings || 0}
                        </div>
                      </TableCell>
                      <TableCell>
                        {cleaner.acceptance_rate !== null ? (
                          <div className="flex items-center gap-2">
                            <Progress
                              value={cleaner.acceptance_rate * 100}
                              className="h-2 w-16"
                            />
                            <span className="text-sm">
                              {Math.round(cleaner.acceptance_rate * 100)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cleaner.on_time_rate !== null ? (
                          <div className="flex items-center gap-2">
                            <Progress
                              value={cleaner.on_time_rate * 100}
                              className="h-2 w-16"
                            />
                            <span className="text-sm">
                              {Math.round(cleaner.on_time_rate * 100)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 font-medium">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          {formatCurrency(cleaner.total_earnings_cents || 0)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {cleaner.payouts_enabled ? (
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle className="h-3 w-3" />
                            Connected
                          </Badge>
                        ) : cleaner.stripe_account_id ? (
                          <Badge variant="outline">Pending</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Not Started
                          </Badge>
                        )}
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
                              <Link href={`/portal/users/cleaners/${cleaner.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/portal/users/cleaners/${cleaner.id}/edit`}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Details
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`mailto:${cleaner.email}`}>
                                <Mail className="mr-2 h-4 w-4" />
                                Send Email
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`tel:${cleaner.phone}`}>
                                <Phone className="mr-2 h-4 w-4" />
                                Call
                              </a>
                            </DropdownMenuItem>
                            {cleaner.stripe_account_id && (
                              <DropdownMenuItem asChild>
                                <a
                                  href={`https://dashboard.stripe.com/connect/accounts/${cleaner.stripe_account_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  View in Stripe
                                </a>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
