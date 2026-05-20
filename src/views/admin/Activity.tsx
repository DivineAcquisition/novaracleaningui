"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RiBriefcaseLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiMailLine,
  RiMessage2Line,
  RiPulseLine,
  RiUserAddLine,
  RiCalendarCheckLine,
} from "@remixicon/react";

interface EventRow {
  id: string;
  event_type: string;
  occurred_at: string;
  created_at: string;
  summary: string | null;
  source: string | null;
  zone: string | null;
  data: any;
  booking_id?: string | null;
  lead_id?: string | null;
  cleaner_id?: string | null;
  job_id?: string | null;
  customer_id?: string | null;
}

const EVENT_TYPES = [
  "all",
  "booking.created",
  "booking.status_change",
  "booking.completed",
  "booking.cancelled",
  "booking.no_show",
  "lead.created",
  "lead.status_change",
  "sms.sent",
  "sms.received",
  "cleaner.flagged",
  "cleaner.escalation",
  "cleaner.deactivated",
  "cleaner.terminated",
  "cleaner.reactivated",
  "cleaner.exception_added",
  "job.status_change",
  "appointment.created",
  "ghl.contact.created",
  "ghl.contact.updated",
  "ghl.appointment.created",
  "ghl.appointment.cancelled",
];

function iconFor(eventType: string) {
  if (eventType.startsWith("sms.received")) return RiMailLine;
  if (eventType.startsWith("sms.")) return RiMessage2Line;
  if (eventType.startsWith("lead.")) return RiUserAddLine;
  if (eventType.startsWith("booking.cancelled") || eventType.startsWith("booking.no_show")) return RiCloseCircleLine;
  if (eventType.startsWith("booking.completed")) return RiCheckLine;
  if (eventType.startsWith("booking.")) return RiCalendarCheckLine;
  if (eventType.startsWith("job.")) return RiBriefcaseLine;
  if (eventType.startsWith("cleaner.escalation")) return RiErrorWarningLine;
  if (eventType.startsWith("cleaner.")) return RiBriefcaseLine;
  if (eventType.startsWith("appointment.") || eventType.startsWith("ghl.")) return RiCalendarCheckLine;
  return RiPulseLine;
}

function colorFor(eventType: string): string {
  if (eventType.includes("escalation") || eventType.includes("no_show") || eventType.includes("cancelled") || eventType.includes("terminated")) return "text-red-400";
  if (eventType.includes("completed") || eventType.includes("reactivated") || eventType.includes("booked")) return "text-emerald-400";
  if (eventType.startsWith("ghl.")) return "text-purple-400";
  if (eventType.startsWith("sms.received") || eventType.startsWith("lead.")) return "text-blue-400";
  if (eventType.includes("flagged") || eventType.includes("escalat")) return "text-amber-400";
  return "text-slate-400";
}

export default function AdminActivity() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const query = supabase
      .from("events" as any)
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(300);
    if (filterType !== "all") query.eq("event_type", filterType);
    const { data, error } = await query;
    if (error) {
      console.error("[activity] fetch error", error);
    } else {
      setEvents((data as unknown as EventRow[]) || []);
    }
    setLoading(false);
  }, [filterType]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Realtime subscription on the events table.
  useEffect(() => {
    if (!autoRefresh) return;
    const channel = supabase
      .channel("events-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events" },
        (payload) => {
          const row = payload.new as unknown as EventRow;
          if (filterType === "all" || row.event_type === filterType) {
            setEvents((prev) => [row, ...prev].slice(0, 300));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [filterType, autoRefresh]);

  const filtered = useMemo(() => {
    if (!search.trim()) return events;
    const s = search.toLowerCase();
    return events.filter(
      (e) =>
        (e.summary || "").toLowerCase().includes(s) ||
        (e.event_type || "").toLowerCase().includes(s) ||
        (e.source || "").toLowerCase().includes(s)
    );
  }, [events, search]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todays = events.filter((e) => (e.occurred_at || "").slice(0, 10) === today);
    return {
      todayTotal: todays.length,
      smsSent: todays.filter((e) => e.event_type === "sms.sent").length,
      smsReceived: todays.filter((e) => e.event_type === "sms.received").length,
      bookingsCreated: todays.filter((e) => e.event_type === "booking.created").length,
      jobsCompleted: todays.filter((e) => e.event_type === "booking.completed").length,
      leadsCreated: todays.filter((e) => e.event_type === "lead.created").length,
      escalations: todays.filter((e) => e.event_type === "cleaner.escalation").length,
    };
  }, [events]);

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <RiPulseLine className="w-6 h-6 text-amber-400" />
              Activity Feed
            </h1>
            <p className="text-sm text-slate-400 mt-1">Realtime stream of every operational event. New events stream to the top automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded border ${autoRefresh ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" : "bg-slate-800 border-white/10 text-slate-400"}`}
            >
              {autoRefresh ? "● Live" : "○ Paused"}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          {[
            { label: "Today", value: stats.todayTotal },
            { label: "SMS Out", value: stats.smsSent },
            { label: "SMS In", value: stats.smsReceived },
            { label: "Bookings", value: stats.bookingsCreated },
            { label: "Completed", value: stats.jobsCompleted },
            { label: "New Leads", value: stats.leadsCreated },
            { label: "Escalations", value: stats.escalations, alert: true },
          ].map((s) => (
            <Card key={s.label} className={`bg-slate-900 border-white/10 ${s.alert && s.value > 0 ? "border-red-500/40" : ""}`}>
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${s.alert && s.value > 0 ? "text-red-400" : "text-amber-400"}`}>{s.value}</p>
                <p className="text-xs text-slate-500 uppercase">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-slate-900 border-white/10">
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <CardTitle className="text-white text-lg">Stream</CardTitle>
            <div className="flex-1 flex items-center gap-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-56 bg-slate-800 border-white/10 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t === "all" ? "All event types" : t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Search summary / source..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-slate-800 border-white/10 text-white max-w-sm"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 bg-slate-800" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No events match.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {filtered.map((e) => {
                  const Icon = iconFor(e.event_type);
                  const color = colorFor(e.event_type);
                  return (
                    <div key={e.id} className="flex items-start gap-3 py-3 hover:bg-white/2">
                      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <Badge variant="outline" className="border-white/10 text-slate-400 text-xs">{e.event_type}</Badge>
                          {e.zone && <Badge variant="outline" className="border-white/10 text-slate-400 text-xs">{e.zone}</Badge>}
                          {e.source && <span className="text-xs text-slate-600">via {e.source}</span>}
                        </div>
                        <p className="text-sm text-slate-200 mt-1">{e.summary || "(no summary)"}</p>
                        {e.data && Object.keys(e.data).length > 0 && (
                          <details className="mt-1">
                            <summary className="text-xs text-slate-500 cursor-pointer">data</summary>
                            <pre className="text-xs text-slate-400 bg-slate-950/50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(e.data, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                      <div className="text-right text-xs text-slate-500 shrink-0 ml-2">
                        <div>{formatDistanceToNowStrict(new Date(e.occurred_at), { addSuffix: true })}</div>
                        <div className="text-slate-600">{format(new Date(e.occurred_at), "MMM d HH:mm")}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
