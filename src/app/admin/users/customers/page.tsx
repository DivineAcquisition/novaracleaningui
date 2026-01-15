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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Crown,
  Calendar,
  DollarSign,
  UserX,
  Trash2,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  referral_code: string | null;
  created_at: string;
  booking_count: number;
  total_spent: number;
  last_booking: string | null;
  has_membership: boolean;
}

export default function CustomersListPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const [bookingCountFilter, setBookingCountFilter] = useState("all");
  const [lastActiveFilter, setLastActiveFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const pageSize = 25;

  const fetchCustomers = useCallback(async () => {
    setIsLoading(true);
    try {
      // First get customers
      let query = supabase
        .from("customers")
        .select("*", { count: "exact" });

      if (searchQuery) {
        query = query.or(
          `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`
        );
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      query = query
        .order("created_at", { ascending: false })
        .range(from, to);

      const { data: customersData, count, error } = await query;

      if (error) throw error;

      // Get booking stats for each customer
      const customerIds = customersData?.map((c) => c.id) || [];
      
      const { data: bookingsData } = await supabase
        .from("bookings")
        .select("customer_id, total_estimate_cents, service_date")
        .in("customer_id", customerIds);

      const { data: membershipsData } = await supabase
        .from("membership_credits")
        .select("customer_id")
        .in("customer_id", customerIds);

      // Aggregate booking stats
      const bookingStats = new Map<string, { count: number; total: number; lastBooking: string | null }>();
      bookingsData?.forEach((b) => {
        if (b.customer_id) {
          const current = bookingStats.get(b.customer_id) || { count: 0, total: 0, lastBooking: null };
          const newLastBooking = !current.lastBooking || b.service_date > current.lastBooking
            ? b.service_date
            : current.lastBooking;
          bookingStats.set(b.customer_id, {
            count: current.count + 1,
            total: current.total + (b.total_estimate_cents || 0),
            lastBooking: newLastBooking,
          });
        }
      });

      const membershipCustomers = new Set(membershipsData?.map((m) => m.customer_id) || []);

      let enrichedCustomers: Customer[] = (customersData || []).map((c) => ({
        ...c,
        booking_count: bookingStats.get(c.id)?.count || 0,
        total_spent: bookingStats.get(c.id)?.total || 0,
        last_booking: bookingStats.get(c.id)?.lastBooking || null,
        has_membership: membershipCustomers.has(c.id),
      }));

      // Apply client-side filters
      if (membershipFilter !== "all") {
        enrichedCustomers = enrichedCustomers.filter((c) =>
          membershipFilter === "member" ? c.has_membership : !c.has_membership
        );
      }

      if (bookingCountFilter !== "all") {
        enrichedCustomers = enrichedCustomers.filter((c) => {
          switch (bookingCountFilter) {
            case "0":
              return c.booking_count === 0;
            case "1-5":
              return c.booking_count >= 1 && c.booking_count <= 5;
            case "6-10":
              return c.booking_count >= 6 && c.booking_count <= 10;
            case "10+":
              return c.booking_count > 10;
            default:
              return true;
          }
        });
      }

      if (lastActiveFilter !== "all") {
        const now = new Date();
        enrichedCustomers = enrichedCustomers.filter((c) => {
          if (!c.last_booking) return lastActiveFilter === "never";
          const lastBookingDate = new Date(c.last_booking);
          const daysSince = Math.floor((now.getTime() - lastBookingDate.getTime()) / (1000 * 60 * 60 * 24));
          switch (lastActiveFilter) {
            case "7d":
              return daysSince <= 7;
            case "30d":
              return daysSince <= 30;
            case "90d":
              return daysSince <= 90;
            case "90d+":
              return daysSince > 90;
            default:
              return true;
          }
        });
      }

      setCustomers(enrichedCustomers);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error fetching customers:", error);
      toast.error("Failed to load customers");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, membershipFilter, bookingCountFilter, lastActiveFilter, page]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(customers.map((c) => c.id));
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
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const headers = [
        "ID",
        "First Name",
        "Last Name",
        "Email",
        "Phone",
        "City",
        "State",
        "ZIP",
        "Referral Code",
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
            c.phone || "",
            c.city || "",
            c.state || "",
            c.zip || "",
            c.referral_code || "",
            c.created_at || "",
          ].join(",")
        )),
      ];

      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Export completed");
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export customers");
    }
  };

  const handleDeleteCustomer = async () => {
    if (!customerToDelete) return;

    try {
      // In production, you would also handle Supabase Auth deletion
      // For now, we'll just delete from the customers table
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", customerToDelete.id);

      if (error) throw error;

      toast.success("Customer deleted successfully");
      setDeleteDialogOpen(false);
      setCustomerToDelete(null);
      fetchCustomers();
    } catch (error) {
      console.error("Error deleting customer:", error);
      toast.error("Failed to delete customer");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setMembershipFilter("all");
    setBookingCountFilter("all");
    setLastActiveFilter("all");
    setPage(1);
  };

  const hasActiveFilters = searchQuery || membershipFilter !== "all" || bookingCountFilter !== "all" || lastActiveFilter !== "all";
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
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Manage customer accounts and view details
          </p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
        <Button variant="outline" onClick={fetchCustomers}>
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
              value={membershipFilter}
              onValueChange={(value) => {
                setMembershipFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Membership" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                <SelectItem value="member">Members Only</SelectItem>
                <SelectItem value="non-member">Non-Members</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={bookingCountFilter}
              onValueChange={(value) => {
                setBookingCountFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Bookings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Bookings</SelectItem>
                <SelectItem value="0">No Bookings</SelectItem>
                <SelectItem value="1-5">1-5 Bookings</SelectItem>
                <SelectItem value="6-10">6-10 Bookings</SelectItem>
                <SelectItem value="10+">10+ Bookings</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={lastActiveFilter}
              onValueChange={(value) => {
                setLastActiveFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Last Active" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Time</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
                <SelectItem value="90d+">90+ Days Ago</SelectItem>
                <SelectItem value="never">Never Booked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {selectedIds.length} customer{selectedIds.length > 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  <Mail className="mr-2 h-4 w-4" />
                  Send Email
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export Selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedIds([])}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Customers Table */}
      <Card>
        <CardHeader>
          <CardDescription>
            {totalCount} customer{totalCount !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No customers found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedIds.length === customers.length && customers.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Membership</TableHead>
                    <TableHead>Bookings</TableHead>
                    <TableHead>Total Spent</TableHead>
                    <TableHead>Last Booking</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(customer.id)}
                          onCheckedChange={(checked) =>
                            handleSelectOne(customer.id, checked as boolean)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarFallback>
                              {customer.first_name[0]}
                              {customer.last_name[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <Link
                              href={`/portal/users/customers/${customer.id}`}
                              className="font-medium hover:underline"
                            >
                              {customer.first_name} {customer.last_name}
                            </Link>
                            {customer.city && (
                              <p className="text-xs text-muted-foreground">
                                {customer.city}, {customer.state}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <a
                            href={`mailto:${customer.email}`}
                            className="flex items-center gap-1 text-sm hover:text-primary"
                          >
                            <Mail className="h-3 w-3" />
                            {customer.email}
                          </a>
                          {customer.phone && (
                            <a
                              href={`tel:${customer.phone}`}
                              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                            >
                              <Phone className="h-3 w-3" />
                              {customer.phone}
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {customer.has_membership ? (
                          <Badge variant="secondary" className="gap-1">
                            <Crown className="h-3 w-3" />
                            Member
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {customer.booking_count}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 font-medium">
                          <DollarSign className="h-4 w-4 text-muted-foreground" />
                          {formatCurrency(customer.total_spent)}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {customer.last_booking
                          ? format(parseISO(customer.last_booking), "MMM d, yyyy")
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(parseISO(customer.created_at), "MMM d, yyyy")}
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
                              <Link href={`/portal/users/customers/${customer.id}`}>
                                <Eye className="mr-2 h-4 w-4" />
                                View Profile
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/portal/users/customers/${customer.id}/edit`}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit Details
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/portal/users/customers/${customer.id}/bookings`}>
                                <Calendar className="mr-2 h-4 w-4" />
                                View Bookings
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`mailto:${customer.email}`}>
                                <Mail className="mr-2 h-4 w-4" />
                                Send Email
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => {
                                setCustomerToDelete(customer);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Account
                            </DropdownMenuItem>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the account for{" "}
              <strong>
                {customerToDelete?.first_name} {customerToDelete?.last_name}
              </strong>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCustomer}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
