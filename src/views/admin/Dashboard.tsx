"use client";

import {
  RiAlertLine,
  RiCalendarCheckLine,
  RiGroupLine,
  RiMoneyDollarCircleLine,
  RiTimeLine,
  RiToolsLine
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { SEO } from "@/components/SEO";
import { format } from "date-fns";

interface Stats {
  todayBookings: number;
  upcomingBookings: number;
  totalCustomers: number;
  activeCleaners: number;
  revenueThisMonth: number;
  pendingJobs: number;
  unassignedBookings: number;
  pendingCleanerApprovals: number;
}

interface RecentBooking {
  id: string;
  first_name: string;
  last_name: string;
  service_date: string;
  service_type: string;
  status: string;
  total_estimate_cents: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentBooking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    const today = format(new Date(), "yyyy-MM-dd");
    const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd");

    const [
      { count: todayCount },
      { count: upcomingCount },
      { count: customerCount },
      { count: cleanerCount },
      { data: monthBookings },
      { count: pendingCount },
      { count: unassignedCount },
      { count: pendingApprovals },
      { data: recentBookings },
    ] = await Promise.all([
      supabase.from("bookings").select("*", { count: "exact", head: true }).eq("service_date", today).neq("status", "cancelled"),
      supabase.from("bookings").select("*", { count: "exact", head: true }).gt("service_date", today).neq("status", "cancelled"),
      supabase.from("customers").select("*", { count: "exact", head: true }),
      supabase.from("cleaners").select("*", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("bookings").select("total_estimate_cents").gte("service_date", monthStart).neq("status", "cancelled"),
      supabase.from("bookings").select("*", { count: "exact", head: true }).eq("status", "pending_payment"),
      supabase.from("bookings").select("*", { count: "exact", head: true }).is("cleaner_id", null).neq("status", "cancelled").neq("status", "pending_payment"),
      supabase.from("cleaners").select("*", { count: "exact", head: true }).eq("approved", false),
      supabase.from("bookings").select("id, first_name, last_name, service_date, service_type, status, total_estimate_cents").order("created_at", { ascending: false }).limit(10),
    ]);

    const revenue = (monthBookings || []).reduce((sum, b) => sum + (b.total_estimate_cents || 0), 0);

    setStats({
      todayBookings: todayCount || 0,
      upcomingBookings: upcomingCount || 0,
      totalCustomers: customerCount || 0,
      activeCleaners: cleanerCount || 0,
      revenueThisMonth: revenue,
      pendingJobs: pendingCount || 0,
      unassignedBookings: unassignedCount || 0,
      pendingCleanerApprovals: pendingApprovals || 0,
    });
    setRecent(recentBookings || []);
    setLoading(false);
  };

  const statCards = stats
    ? [
        { label: "Today's Bookings", value: stats.todayBookings, icon: RiCalendarCheckLine, color: "text-amber-400" },
        { label: "Upcoming", value: stats.upcomingBookings, icon: RiTimeLine, color: "text-blue-400" },
        { label: "Revenue (Month)", value: `$${(stats.revenueThisMonth / 100).toLocaleString()}`, icon: RiMoneyDollarCircleLine, color: "text-emerald-400" },
        { label: "Total Customers", value: stats.totalCustomers, icon: RiGroupLine, color: "text-purple-400" },
        { label: "Active Cleaners", value: stats.activeCleaners, icon: RiToolsLine, color: "text-cyan-400" },
        { label: "Pending Payment", value: stats.pendingJobs, icon: RiAlertLine, color: "text-orange-400" },
      ]
    : [];

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      confirmed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
      pending_payment: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      assigned: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    };
    return map[status] || "bg-slate-500/20 text-slate-400 border-slate-500/30";
  };

  return (
    <AdminLayout>
      <SEO title="Admin Dashboard" noindex />
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-20 mb-2 bg-slate-700" />
                    <Skeleton className="h-8 w-16 bg-slate-700" />
                  </CardContent>
                </Card>
              ))
            : statCards.map((s) => (
                <Card key={s.label} className="bg-slate-800/50 border-white/10">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <s.icon className={`h-4 w-4 ${s.color}`} />
                      <span className="text-xs text-slate-400">{s.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-white">{s.value}</p>
                  </CardContent>
                </Card>
              ))}
        </div>

        {/* Alerts */}
        {stats && (stats.unassignedBookings > 0 || stats.pendingCleanerApprovals > 0) && (
          <div className="flex flex-wrap gap-3">
            {stats.unassignedBookings > 0 && (
              <button
                onClick={() => router.push("/admin/bookings")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm hover:bg-amber-500/20 transition-colors"
              >
                <RiAlertLine className="h-4 w-4" />
                {stats.unassignedBookings} unassigned booking{stats.unassignedBookings > 1 ? "s" : ""}
              </button>
            )}
            {stats.pendingCleanerApprovals > 0 && (
              <button
                onClick={() => router.push("/admin/cleaners")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400 text-sm hover:bg-purple-500/20 transition-colors"
              >
                <RiToolsLine className="h-4 w-4" />
                {stats.pendingCleanerApprovals} pending cleaner approval{stats.pendingCleanerApprovals > 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}

        {/* Recent Bookings */}
        <Card className="bg-slate-800/50 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg">Recent Bookings</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-slate-700" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/10">
                      <th className="text-left py-2 px-3 font-medium">Customer</th>
                      <th className="text-left py-2 px-3 font-medium">Date</th>
                      <th className="text-left py-2 px-3 font-medium">Service</th>
                      <th className="text-left py-2 px-3 font-medium">Status</th>
                      <th className="text-right py-2 px-3 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                        onClick={() => router.push("/admin/bookings")}
                      >
                        <td className="py-2.5 px-3 text-white">
                          {b.first_name} {b.last_name}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">{b.service_date}</td>
                        <td className="py-2.5 px-3 text-slate-400">{b.service_type}</td>
                        <td className="py-2.5 px-3">
                          <Badge variant="outline" className={statusColor(b.status || "")}>
                            {(b.status || "").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-right text-white">
                          ${((b.total_estimate_cents || 0) / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
