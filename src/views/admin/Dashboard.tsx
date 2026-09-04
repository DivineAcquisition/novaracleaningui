"use client";

// ─── Admin Dashboard (v2 — 2026-05-22) ──────────────────────────────────
//
// Live metrics + activity. Every number on this page is pulled from
// public.bookings / public.cleaners / public.job_assignments / the
// public.daily_metrics_v1 view / public.events_feed_v1. Zero hardcoded
// data. Realtime subscription on public.events streams new activity in.
// "Today" is America/New_York — UTC midnight used to zero the tiles in the
// evening Eastern, and on days with no jobs the 30-day chart now falls back
// to actual bookings so it is not a strip of empty bars.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  RiCalendarCheckLine,
  RiMoneyDollarCircleLine,
  RiPulseLine,
  RiTeamLine,
  RiArrowUpLine,
  RiAlertLine,
  RiTimeLine,
  RiLineChartLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminRole } from "@/hooks/use-admin-role";
import { addDaysYmd, dollars as dollarsExact, ymdInZone } from "@/lib/pnl";
import { cn } from "@/lib/utils";

interface TodayStats {
  bookingsToday: number;
  stillOnToday: number;
  completedToday: number;
  revenueTodayCents: number;
  collectedMtdCents: number;
  pipelineMtdCents: number;
  upcomingCount: number;
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

interface JobRow {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  status: string;
  service_date: string;
  time_slot: string | null;
  service_type: string | null;
  total_estimate_cents: number | null;
  final_charge_cents: number | null;
  is_reclean?: boolean | null;
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const EVENT_BADGE: Record<string, { label: string; className: string }> = {
  "booking.created":   { label: "Booking",  className: "bg-violet-100 text-violet-800 border-violet-200" },
  "booking.confirmed": { label: "Confirmed",className: "bg-violet-100 text-violet-800 border-violet-200" },
  "booking.completed": { label: "Completed",className: "bg-blue-100 text-blue-800 border-blue-200" },
  "booking.cancelled": { label: "Cancelled",className: "bg-rose-100 text-rose-800 border-rose-200" },
  booking_created:     { label: "Booking",  className: "bg-violet-100 text-violet-800 border-violet-200" },
  offer_sent:          { label: "Offer sent", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  job_accepted:        { label: "Job accepted", className: "bg-violet-100 text-violet-800 border-violet-200" },
  booking_completed:   { label: "Completed",className: "bg-blue-100 text-blue-800 border-blue-200" },
  sms_out:             { label: "SMS out",  className: "bg-slate-100 text-slate-700 border-slate-200" },
  "lead.created":      { label: "Lead",     className: "bg-amber-100 text-amber-800 border-amber-200" },
  "sms.sent":          { label: "SMS out",  className: "bg-slate-100 text-slate-700 border-slate-200" },
  "sms.received":      { label: "SMS in",   className: "bg-slate-100 text-slate-700 border-slate-200" },
  "job.assignment.offered":   { label: "Offer sent",   className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  "job.assignment.accepted":  { label: "Job accepted", className: "bg-violet-100 text-violet-800 border-violet-200" },
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

function jobCents(r: Pick<JobRow, "is_reclean" | "final_charge_cents" | "total_estimate_cents">) {
  if (r.is_reclean) return 0;
  return Number(r.final_charge_cents ?? r.total_estimate_cents ?? 0) || 0;
}

function jobName(r: JobRow) {
  return String(r.business_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || "Client");
}

function jobRef(r: JobRow) {
  return r.booking_number != null ? `NVC-${String(r.booking_number).padStart(4, "0")}` : r.id.slice(0, 8);
}

function shortDate(ymd: string) {
  return new Date(`${ymd}T12:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function trendFromBookings(rows: JobRow[], fromYmd: string, toYmd: string): DailyRow[] {
  const byDay = new Map<string, DailyRow>();
  let cur = fromYmd;
  while (cur <= toYmd) {
    byDay.set(cur, { day: cur, bookings_created: 0, jobs_completed: 0, revenue_completed_cents: 0, new_leads: 0 });
    cur = addDaysYmd(cur, 1);
  }
  for (const r of rows) {
    const day = String(r.service_date || "").slice(0, 10);
    const bucket = byDay.get(day);
    if (!bucket) continue;
    bucket.bookings_created += 1;
    if (r.status === "completed") {
      bucket.jobs_completed += 1;
      bucket.revenue_completed_cents += jobCents(r);
    }
  }
  return [...byDay.values()];
}

const JOB_SELECT =
  "id, booking_number, first_name, last_name, business_name, status, service_date, time_slot, service_type, total_estimate_cents, final_charge_cents, is_reclean";

export default function AdminDashboard() {
  const { isAdmin } = useAdminRole();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [trend, setTrend] = useState<DailyRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [todayJobs, setTodayJobs] = useState<JobRow[]>([]);
  const [upcoming, setUpcoming] = useState<JobRow[]>([]);

  useEffect(() => {
    void load();

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
                summary: (row as { summary?: string }).summary || null,
                contact_name: (row as { contact_name?: string }).contact_name || null,
                cleaner_name: (row as { cleaner_name?: string }).cleaner_name || null,
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
      const todayIso = ymdInZone(new Date());
      const monthStartIso = `${todayIso.slice(0, 7)}-01`;
      const since30 = addDaysYmd(todayIso, -29);
      const upcomingEnd = addDaysYmd(todayIso, 7);

      const [
        todayJobsRes,
        upcomingRes,
        mtdRes,
        trendBookingsRes,
        activeCleanersRes,
        pendingOffersRes,
        dispatchAlertsRes,
        trendRes,
        eventsRes,
      ] = await Promise.all([
        supabase
          .from("bookings")
          .select(JOB_SELECT)
          .eq("service_date", todayIso)
          .neq("status", "cancelled")
          .order("time_slot", { ascending: true }),
        supabase
          .from("bookings")
          .select(JOB_SELECT)
          .gt("service_date", todayIso)
          .lte("service_date", upcomingEnd)
          .neq("status", "cancelled")
          .order("service_date", { ascending: true })
          .limit(20),
        supabase
          .from("bookings")
          .select("status, final_charge_cents, total_estimate_cents, is_reclean")
          .gte("service_date", monthStartIso)
          .in("status", ["completed", "confirmed", "assigned", "pending_payment", "pending_details"]),
        supabase
          .from("bookings")
          .select("service_date, status, final_charge_cents, total_estimate_cents, is_reclean")
          .gte("service_date", since30)
          .lte("service_date", todayIso)
          .neq("status", "cancelled"),
        supabase.from("cleaners").select("id", { count: "exact", head: true })
          .eq("status", "active").eq("approved", true),
        supabase.from("job_assignments").select("id", { count: "exact", head: true })
          .ilike("status", "offered"),
        supabase.from("dispatch_alerts" as never).select("id", { count: "exact", head: true })
          .eq("resolved", false),
        supabase.from("daily_metrics_v1" as never)
          .select("day,bookings_created,jobs_completed,revenue_completed_cents,new_leads")
          .gte("day", since30)
          .order("day", { ascending: true }),
        supabase.from("events_feed_v1" as never)
          .select("id,event_type,occurred_at,summary,contact_name,cleaner_name")
          .order("occurred_at", { ascending: false })
          .limit(25),
      ]);

      const todayList = (todayJobsRes.data || []) as JobRow[];
      const upcomingList = (upcomingRes.data || []) as JobRow[];
      const mtd = (mtdRes.data || []) as Array<Pick<JobRow, "status" | "final_charge_cents" | "total_estimate_cents" | "is_reclean">>;
      const completedToday = todayList.filter((r) => r.status === "completed").length;

      setTodayJobs(todayList);
      setUpcoming(upcomingList);
      setStats({
        bookingsToday: todayList.length,
        stillOnToday: todayList.length - completedToday,
        completedToday,
        revenueTodayCents: todayList.reduce((s, r) => s + jobCents(r), 0),
        collectedMtdCents: mtd.filter((r) => r.status === "completed").reduce((s, r) => s + jobCents(r), 0),
        pipelineMtdCents: mtd.filter((r) => r.status !== "completed").reduce((s, r) => s + jobCents(r), 0),
        upcomingCount: upcomingList.length,
        activeCleaners: activeCleanersRes.count ?? 0,
        pendingOffers: pendingOffersRes.count ?? 0,
        openDispatchAlerts: dispatchAlertsRes.count ?? 0,
      });

      const metrics = (trendRes.data as unknown as DailyRow[]) || [];
      const metricsHaveSignal = metrics.some((r) => (r.bookings_created || 0) > 0 || (r.jobs_completed || 0) > 0);
      setTrend(
        metricsHaveSignal
          ? metrics
          : trendFromBookings((trendBookingsRes.data || []) as JobRow[], since30, todayIso),
      );
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
          Eastern Time · live operations metrics, not a P&amp;L.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KpiTile
          loading={loading}
          icon={RiCalendarCheckLine}
          label="Bookings today"
          value={stats?.bookingsToday}
          tone="emerald"
          footer={
            stats
              ? `${stats.stillOnToday} still on · ${stats.completedToday} done`
              : undefined
          }
        />
        <KpiTile
          loading={loading}
          icon={RiMoneyDollarCircleLine}
          label="Revenue today"
          value={stats ? dollars(stats.revenueTodayCents) : undefined}
          tone="emerald"
          footer={
            stats
              ? `${dollars(stats.collectedMtdCents)} collected MTD · ${dollars(stats.pipelineMtdCents)} booked`
              : undefined
          }
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

      {isAdmin ? (
        <Card className="border-violet-200 bg-violet-50/40">
          <CardContent className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="w-10 h-10 rounded-lg flex items-center justify-center bg-brand-50 text-primary shrink-0">
                <RiLineChartLine className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Profit &amp; Loss</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {stats
                    ? `${dollarsExact(stats.collectedMtdCents)} collected this month · ${dollarsExact(stats.pipelineMtdCents)} still booked. Ads, contribution, and ROAS live on P&L.`
                    : "Collected vs pipeline, ad spend, and contribution."}
                </p>
              </div>
            </div>
            <Link
              href="/admin/pnl"
              className="text-sm font-semibold text-primary hover:underline shrink-0"
            >
              Open P&amp;L
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Coming up this week</CardTitle>
            <CardDescription>
              Jobs on the calendar for the next 7 days{stats ? ` · ${stats.upcomingCount} booked` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : upcoming.length === 0 && todayJobs.length === 0 ? (
              <EmptyState
                icon={RiTimeLine}
                title="Nothing on the calendar"
                hint="Today and the next 7 days have no active jobs."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {todayJobs.map((j) => (
                  <UpcomingItem key={j.id} job={j} today />
                ))}
                {upcoming.map((j) => (
                  <UpcomingItem key={j.id} job={j} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Live activity</CardTitle>
              <CardDescription>Realtime stream from public.events</CardDescription>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-violet-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
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

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Last 30 days</CardTitle>
          <CardDescription>
            Jobs on the calendar · completed · revenue collected
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
    </div>
  );
}

function UpcomingItem({ job, today }: { job: JobRow; today?: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="w-16 shrink-0">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
          {today ? "Today" : shortDate(job.service_date)}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-900 truncate">
          <span className="font-medium">{jobRef(job)}</span>
          {" · "}
          {jobName(job)}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          {[job.time_slot, job.service_type, job.status.replace(/_/g, " ")].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p className="text-sm tabular-nums font-medium text-slate-800 shrink-0">{dollars(jobCents(job))}</p>
    </li>
  );
}

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
    emerald: "bg-brand-50 text-primary",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <Card className="panel panel-hover">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className={cn("w-10 h-10 rounded-lg flex items-center justify-center", toneStyles)}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
              {label}
            </p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-1" />
            ) : (
              <p className="text-xl font-heading font-bold text-foreground truncate">
                {value ?? "0"}
              </p>
            )}
          </div>
        </div>
        {footer && (
          <p className="text-[11px] text-muted-foreground mt-3 truncate">{footer}</p>
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
          const heightBookings = (r.bookings_created || 0) === 0 ? 0 : Math.max(4, ((r.bookings_created || 0) / maxBookings) * 100);
          const heightRevenue = (r.revenue_completed_cents || 0) === 0 ? 0 : Math.max(4, ((r.revenue_completed_cents || 0) / maxRevenue) * 100);
          return (
            <div key={r.day} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={r.day}>
              <div
                className="w-full rounded-t-sm bg-violet-500/80"
                style={{ height: `${heightBookings}%` }}
              />
              <div
                className="w-full rounded-t-sm bg-violet-200"
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
            <span className="w-2 h-2 rounded-sm bg-violet-500/80" /> Jobs
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-violet-200" /> Revenue
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
