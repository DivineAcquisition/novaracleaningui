"use client";

// ─── Admin Dashboard (v2 — 2026-05-22) ──────────────────────────────────
//
// Live metrics + activity. Every number on this page is pulled from
// public.bookings / public.cleaners / public.job_assignments / the
// public.daily_metrics_v1 view / public.events_feed_v1. Zero hardcoded
// data. Realtime subscription on public.events streams new activity in.

import { useEffect, useMemo, useState } from "react";
import {
  RiCalendarCheckLine,
  RiCheckboxCircleLine,
  RiMoneyDollarCircleLine,
  RiPulseLine,
  RiTeamLine,
  RiArrowUpLine,
  RiAlertLine,
  RiLoader4Line,
  RiTimeLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TodayStats {
  bookingsToday: number;
  confirmedToday: number;
  completedToday: number;
  revenueTodayCents: number;
  revenueMtdCents: number;
  activeCleaners: number;
  pendingOffers: number;
  openDispatchAlerts: number;
}

interface DailyRow {
  day: string;
  bookings_created: number;
  jobs_completed: number;
  revenue_completed_cents: number;
  new_leads: number;
}

interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  summary: string | null;
  contact_name: string | null;
  cleaner_name: string | null;
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const EVENT_BADGE: Record<string, { label: string; className: string }> = {
  "booking.created":   { label: "Booking",  className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  "booking.confirmed": { label: "Confirmed",className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  "booking.completed": { label: "Completed",className: "bg-blue-100 text-blue-800 border-blue-200" },
  "booking.cancelled": { label: "Cancelled",className: "bg-rose-100 text-rose-800 border-rose-200" },
  "lead.created":      { label: "Lead",     className: "bg-amber-100 text-amber-800 border-amber-200" },
  "sms.sent":          { label: "SMS out",  className: "bg-slate-100 text-slate-700 border-slate-200" },
  "sms.received":      { label: "SMS in",   className: "bg-slate-100 text-slate-700 border-slate-200" },
  "job.assignment.offered":   { label: "Offer sent",   className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  "job.assignment.accepted":  { label: "Job accepted", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  "job.assignment.declined":  { label: "Declined",     className: "bg-rose-100 text-rose-800 border-rose-200" },
};

function eventBadge(eventType: string) {
  return (
    EVENT_BADGE[eventType] || {
      label: eventType,
      className: "bg-slate-100 text-slate-700 border-slate-200",
    }
  );
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [trend, setTrend] = useState<DailyRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    void load();

    // Live subscription to the events stream.
    const channel = supabase
      .channel("admin-dashboard-events")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          const row = payload.new as Partial<EventRow> & { occurred_at?: string };
          if (!row?.id) return;
          setEvents((prev) =>
            [
              {
                id: row.id!,
                event_type: row.event_type || "",
                occurred_at: row.occurred_at || new Date().toISOString(),
                summary: (row as any).summary || null,
                contact_name: (row as any).contact_name || null,
                cleaner_name: (row as any).cleaner_name || null,
              },
              ...prev,
            ].slice(0, 25),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const monthStartIso = new Date();
      monthStartIso.setDate(1);
      const since30 = new Date();
      since30.setDate(since30.getDate() - 29);

      const [
        bookingsTodayRes,
        confirmedTodayRes,
        completedTodayRes,
        revenueTodayRes,
        revenueMtdRes,
        activeCleanersRes,
        pendingOffersRes,
        dispatchAlertsRes,
        trendRes,
        eventsRes,
      ] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("service_date", todayIso),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("service_date", todayIso).eq("status", "confirmed"),
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("service_date", todayIso).eq("status", "completed"),
        supabase.from("bookings").select("final_charge_cents,total_estimate_cents")
          .eq("service_date", todayIso).in("status", ["confirmed", "completed", "assigned"]),
        supabase.from("bookings").select("final_charge_cents,total_estimate_cents")
          .gte("service_date", monthStartIso.toISOString().slice(0, 10))
          .in("status", ["confirmed", "completed", "assigned"]),
        supabase.from("cleaners").select("id", { count: "exact", head: true })
          .eq("status", "active").eq("approved", true),
        supabase.from("job_assignments").select("id", { count: "exact", head: true })
          .ilike("status", "offered"),
        supabase.from("dispatch_alerts" as any).select("id", { count: "exact", head: true })
          .eq("resolved", false),
        supabase.from("daily_metrics_v1" as any)
          .select("day,bookings_created,jobs_completed,revenue_completed_cents,new_leads")
          .gte("day", since30.toISOString().slice(0, 10))
          .order("day", { ascending: true }),
        supabase.from("events_feed_v1" as any)
          .select("id,event_type,occurred_at,summary,contact_name,cleaner_name")
          .order("occurred_at", { ascending: false })
          .limit(25),
      ]);

      const sumCharge = (rows: any[] | null) =>
        (rows || []).reduce(
          (acc, r) => acc + (r.final_charge_cents ?? r.total_estimate_cents ?? 0),
          0,
        );

      setStats({
        bookingsToday:    bookingsTodayRes.count ?? 0,
        confirmedToday:   confirmedTodayRes.count ?? 0,
        completedToday:   completedTodayRes.count ?? 0,
        revenueTodayCents: sumCharge(revenueTodayRes.data as any[]),
        revenueMtdCents:   sumCharge(revenueMtdRes.data as any[]),
        activeCleaners:   activeCleanersRes.count ?? 0,
        pendingOffers:    pendingOffersRes.count ?? 0,
        openDispatchAlerts: dispatchAlertsRes.count ?? 0,
      });
      setTrend((trendRes.data as unknown as DailyRow[]) || []);
      setEvents((eventsRes.data as unknown as EventRow[]) || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Today at a glance</h1>
        <p className="text-sm text-slate-500">
          Live operations metrics &middot; everything below pulls straight from the DB.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          loading={loading}
          icon={RiCalendarCheckLine}
          label="Bookings today"
          value={stats?.bookingsToday}
          tone="emerald"
          footer={
            stats
              ? `${stats.confirmedToday} confirmed · ${stats.completedToday} done`
              : undefined
          }
        />
        <KpiTile
          loading={loading}
          icon={RiMoneyDollarCircleLine}
          label="Revenue today"
          value={stats ? dollars(stats.revenueTodayCents) : undefined}
          tone="emerald"
          footer={stats ? `${dollars(stats.revenueMtdCents)} MTD` : undefined}
        />
        <KpiTile
          loading={loading}
          icon={RiTeamLine}
          label="Active cleaners"
          value={stats?.activeCleaners}
          tone="slate"
          footer="Approved & status=active"
        />
        <KpiTile
          loading={loading}
          icon={RiPulseLine}
          label="Pending offers"
          value={stats?.pendingOffers}
          tone={stats && stats.openDispatchAlerts ? "amber" : "slate"}
          footer={
            stats
              ? `${stats.openDispatchAlerts} unresolved alerts`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 30-day trend */}
        <Card className="xl:col-span-2 border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Last 30 days</CardTitle>
            <CardDescription>
              Bookings created · jobs completed · revenue collected
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-44 w-full" />
            ) : trend.length === 0 ? (
              <EmptyState
                icon={RiArrowUpLine}
                title="No data yet"
                hint="Daily metrics will populate as bookings are created."
              />
            ) : (
              <TrendStrip rows={trend} />
            )}
          </CardContent>
        </Card>

        {/* Live activity */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Live activity</CardTitle>
              <CardDescription>Realtime stream from public.events</CardDescription>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto pr-1">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <EmptyState
                icon={RiPulseLine}
                title="No recent events"
                hint="Bookings, calls, SMS, and offer responses will appear here in real time."
              />
            ) : (
              <ol className="space-y-2">
                {events.map((e) => {
                  const b = eventBadge(e.event_type);
                  return (
                    <li
                      key={e.id}
                      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium uppercase tracking-wide border",
                          b.className,
                        )}
                      >
                        {b.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 truncate">
                          {e.summary || e.event_type}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {[e.contact_name, e.cleaner_name].filter(Boolean).join(" · ")}
                          {" · "}
                          <RelTime iso={e.occurred_at} />
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function KpiTile({
  loading,
  icon: Icon,
  label,
  value,
  footer,
  tone,
}: {
  loading: boolean;
  icon: typeof RiCalendarCheckLine;
  label: string;
  value: string | number | undefined;
  footer?: string;
  tone: "emerald" | "amber" | "slate";
}) {
  const toneStyles = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className={cn("w-10 h-10 rounded-lg flex items-center justify-center", toneStyles)}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-xl font-bold text-slate-900 truncate">
                {value ?? "0"}
              </p>
            )}
          </div>
        </div>
        {footer && (
          <p className="text-[11px] text-slate-500 mt-3 truncate">{footer}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TrendStrip({ rows }: { rows: DailyRow[] }) {
  const maxBookings = Math.max(1, ...rows.map((r) => r.bookings_created || 0));
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue_completed_cents || 0));
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1 h-32">
        {rows.map((r) => {
          const heightBookings = Math.max(2, ((r.bookings_created || 0) / maxBookings) * 100);
          const heightRevenue = Math.max(2, ((r.revenue_completed_cents || 0) / maxRevenue) * 100);
          return (
            <div key={r.day} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={r.day}>
              <div
                className="w-full rounded-t-sm bg-emerald-500/80"
                style={{ height: `${heightBookings}%` }}
              />
              <div
                className="w-full rounded-t-sm bg-emerald-200"
                style={{ height: `${heightRevenue}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>{rows[0]?.day}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500/80" /> Bookings
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-200" /> Revenue
          </span>
        </div>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof RiAlertLine;
  title: string;
  hint?: string;
}) {
  return (
    <div className="text-center py-10 text-slate-500">
      <Icon className="w-8 h-8 mx-auto text-slate-300" />
      <p className="text-sm font-medium text-slate-700 mt-2">{title}</p>
      {hint && <p className="text-xs mt-1">{hint}</p>}
    </div>
  );
}

function RelTime({ iso }: { iso: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return <span>{formatRel(iso)}</span>;
}

function formatRel(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "just now";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
