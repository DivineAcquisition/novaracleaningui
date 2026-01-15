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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  UserCheck,
  UserCog,
  Shield,
  Search,
  RefreshCcw,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Calendar,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

interface UserStats {
  totalCustomers: number;
  totalCleaners: number;
  totalAdmins: number;
  customersThisWeek: number;
  cleanersThisWeek: number;
  customersGrowth: number;
  cleanersGrowth: number;
}

interface RecentActivity {
  id: string;
  type: "customer_created" | "cleaner_created" | "booking_created" | "login";
  description: string;
  timestamp: string;
  user_name?: string;
  user_email?: string;
}

interface SearchResult {
  id: string;
  type: "customer" | "cleaner" | "admin";
  name: string;
  email: string;
  created_at: string;
}

export default function UsersOverviewPage() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const weekAgo = format(subDays(new Date(), 7), "yyyy-MM-dd");
      const twoWeeksAgo = format(subDays(new Date(), 14), "yyyy-MM-dd");

      // Fetch customers count
      const { count: totalCustomers } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true });

      // Fetch cleaners count
      const { count: totalCleaners } = await supabase
        .from("cleaners")
        .select("id", { count: "exact", head: true });

      // Fetch admins count
      const { count: totalAdmins } = await supabase
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");

      // Customers this week
      const { count: customersThisWeek } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo);

      // Customers last week (for growth calculation)
      const { count: customersLastWeek } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .gte("created_at", twoWeeksAgo)
        .lt("created_at", weekAgo);

      // Cleaners this week
      const { count: cleanersThisWeek } = await supabase
        .from("cleaners")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo);

      // Cleaners last week
      const { count: cleanersLastWeek } = await supabase
        .from("cleaners")
        .select("id", { count: "exact", head: true })
        .gte("created_at", twoWeeksAgo)
        .lt("created_at", weekAgo);

      const customersGrowth = (customersLastWeek || 0) > 0
        ? (((customersThisWeek || 0) - (customersLastWeek || 0)) / (customersLastWeek || 1)) * 100
        : (customersThisWeek || 0) * 100;

      const cleanersGrowth = (cleanersLastWeek || 0) > 0
        ? (((cleanersThisWeek || 0) - (cleanersLastWeek || 0)) / (cleanersLastWeek || 1)) * 100
        : (cleanersThisWeek || 0) * 100;

      setStats({
        totalCustomers: totalCustomers || 0,
        totalCleaners: totalCleaners || 0,
        totalAdmins: totalAdmins || 0,
        customersThisWeek: customersThisWeek || 0,
        cleanersThisWeek: cleanersThisWeek || 0,
        customersGrowth,
        cleanersGrowth,
      });

      // Fetch recent activity (customers and cleaners created recently)
      const { data: recentCustomers } = await supabase
        .from("customers")
        .select("id, first_name, last_name, email, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      const { data: recentCleaners } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, email, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      const activities: RecentActivity[] = [
        ...(recentCustomers || []).map((c) => ({
          id: `customer-${c.id}`,
          type: "customer_created" as const,
          description: "New customer registered",
          timestamp: c.created_at,
          user_name: `${c.first_name} ${c.last_name}`,
          user_email: c.email,
        })),
        ...(recentCleaners || []).map((c) => ({
          id: `cleaner-${c.id}`,
          type: "cleaner_created" as const,
          description: "New cleaner onboarded",
          timestamp: c.created_at,
          user_name: `${c.first_name} ${c.last_name}`,
          user_email: c.email,
        })),
      ]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      setRecentActivity(activities);
    } catch (error) {
      console.error("Error fetching stats:", error);
      toast.error("Failed to load user statistics");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const query = searchQuery.trim().toLowerCase();

      // Search customers
      const { data: customers } = await supabase
        .from("customers")
        .select("id, first_name, last_name, email, created_at")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      // Search cleaners
      const { data: cleaners } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, email, created_at")
        .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(10);

      const results: SearchResult[] = [
        ...(customers || []).map((c) => ({
          id: c.id,
          type: "customer" as const,
          name: `${c.first_name} ${c.last_name}`,
          email: c.email,
          created_at: c.created_at,
        })),
        ...(cleaners || []).map((c) => ({
          id: c.id,
          type: "cleaner" as const,
          name: `${c.first_name} ${c.last_name}`,
          email: c.email,
          created_at: c.created_at,
        })),
      ];

      setSearchResults(results);
    } catch (error) {
      console.error("Error searching:", error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const timer = setTimeout(() => {
      handleSearch();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, handleSearch]);

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "customer_created":
        return <Users className="h-4 w-4 text-blue-500" />;
      case "cleaner_created":
        return <UserCog className="h-4 w-4 text-green-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Overview of all users in the system
          </p>
        </div>
        <Button variant="outline" onClick={fetchStats}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Link href="/portal/users/customers">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Customers
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalCustomers || 0}</div>
              <p className="text-xs text-muted-foreground flex items-center">
                {stats?.customersGrowth !== undefined && (
                  <span
                    className={`flex items-center ${
                      stats.customersGrowth >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {stats.customersGrowth >= 0 ? (
                      <ArrowUpRight className="mr-1 h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="mr-1 h-3 w-3" />
                    )}
                    {Math.abs(stats.customersGrowth).toFixed(1)}% this week
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/portal/users/cleaners">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Cleaners
              </CardTitle>
              <UserCog className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalCleaners || 0}</div>
              <p className="text-xs text-muted-foreground flex items-center">
                {stats?.cleanersGrowth !== undefined && (
                  <span
                    className={`flex items-center ${
                      stats.cleanersGrowth >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {stats.cleanersGrowth >= 0 ? (
                      <ArrowUpRight className="mr-1 h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="mr-1 h-3 w-3" />
                    )}
                    {Math.abs(stats.cleanersGrowth).toFixed(1)}% this week
                  </span>
                )}
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/portal/users/admins">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Admins
              </CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.totalAdmins || 0}</div>
              <p className="text-xs text-muted-foreground">
                System administrators
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              New This Week
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(stats?.customersThisWeek || 0) + (stats?.cleanersThisWeek || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.customersThisWeek || 0} customers, {stats?.cleanersThisWeek || 0} cleaners
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Search</CardTitle>
          <CardDescription>
            Search across all users by name, email, or phone
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((result) => (
                <Link
                  key={`${result.type}-${result.id}`}
                  href={`/portal/users/${result.type}s/${result.id}`}
                >
                  <div className="flex items-center justify-between p-3 rounded-lg hover:bg-muted cursor-pointer">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {result.name.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{result.name}</p>
                        <p className="text-sm text-muted-foreground">{result.email}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {result.type}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {searchQuery && searchResults.length === 0 && !isSearching && (
            <p className="mt-4 text-center text-muted-foreground">No results found</p>
          )}
        </CardContent>
      </Card>

      {/* Quick Links and Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Links</CardTitle>
            <CardDescription>
              Common user management tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Link href="/portal/users/customers">
              <Button variant="outline" className="w-full justify-start">
                <Users className="mr-2 h-4 w-4" />
                View All Customers
              </Button>
            </Link>
            <Link href="/portal/users/cleaners">
              <Button variant="outline" className="w-full justify-start">
                <UserCog className="mr-2 h-4 w-4" />
                View All Cleaners
              </Button>
            </Link>
            <Link href="/portal/users/admins">
              <Button variant="outline" className="w-full justify-start">
                <Shield className="mr-2 h-4 w-4" />
                Manage Admins
              </Button>
            </Link>
            <Link href="/portal/users/admins/invite">
              <Button variant="outline" className="w-full justify-start">
                <UserCheck className="mr-2 h-4 w-4" />
                Invite New Admin
              </Button>
            </Link>
            <Link href="/portal/audit">
              <Button variant="outline" className="w-full justify-start">
                <Activity className="mr-2 h-4 w-4" />
                View Audit Log
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>
              Latest user registrations and changes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  No recent activity
                </p>
              ) : (
                recentActivity.map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3">
                    <div className="mt-1">{getActivityIcon(activity.type)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{activity.description}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {activity.user_name} ({activity.user_email})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(activity.timestamp), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
