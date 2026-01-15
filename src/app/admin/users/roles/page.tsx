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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Key,
  RefreshCcw,
  Search,
  Shield,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";

interface UserRole {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

interface RoleStats {
  admin: number;
  customer: number;
  total: number;
}

export default function RolesManagementPage() {
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [stats, setStats] = useState<RoleStats>({ admin: 0, customer: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from("user_roles")
        .select("*", { count: "exact" });

      if (searchQuery) {
        query = query.ilike("user_id", `%${searchQuery}%`);
      }

      if (roleFilter !== "all") {
        query = query.eq("role", roleFilter as "admin" | "customer");
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      query = query
        .order("created_at", { ascending: false })
        .range(from, to);

      const { data, count, error } = await query;

      if (error) throw error;

      setRoles(data || []);

      // Fetch stats
      const { count: adminCount } = await supabase
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");

      const { count: customerCount } = await supabase
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "customer");

      setStats({
        admin: adminCount || 0,
        customer: customerCount || 0,
        total: count || 0,
      });
    } catch (error) {
      console.error("Error fetching roles:", error);
      toast.error("Failed to load user roles");
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, roleFilter, page]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const totalPages = Math.ceil(stats.total / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/portal/users">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Role Management</h1>
          <p className="text-muted-foreground">
            View and manage user roles across the system
          </p>
        </div>
        <Button variant="outline" onClick={fetchRoles}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Roles
            </CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Administrators
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.admin}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Customers
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.customer}</div>
          </CardContent>
        </Card>
      </div>

      {/* Roles Table */}
      <Card>
        <CardHeader>
          <CardTitle>User Roles</CardTitle>
          <CardDescription>
            All role assignments in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by user ID..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(value) => {
                setRoleFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : roles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No roles found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Assigned</TableHead>
                    <TableHead>Role ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell className="font-mono text-sm">
                        {role.user_id}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={role.role === "admin" ? "default" : "secondary"}
                          className="capitalize"
                        >
                          {role.role === "admin" ? (
                            <Shield className="mr-1 h-3 w-3" />
                          ) : (
                            <User className="mr-1 h-3 w-3" />
                          )}
                          {role.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(parseISO(role.created_at), "MMM d, yyyy 'at' h:mm a")}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {role.id}
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

      {/* Role Descriptions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Role Descriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Administrator</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Full access to all system features including user management,
                bookings, payments, settings, and reports.
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-5 w-5 text-muted-foreground" />
                <h3 className="font-semibold">Customer</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Standard user access to book services, manage their account,
                and view their booking history.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
