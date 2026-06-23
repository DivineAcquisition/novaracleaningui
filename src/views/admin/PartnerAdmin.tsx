"use client";

// ─── /admin/partner — Turnover portal operations ─────────────────────────
//
// Admin control for the host turnover portal: set per-property pricing
// (gates bookability), manage the turnover crew, review every request, work
// the unassigned-alert queue, and manually (re)assign. Reuses RLS (admin/va
// full access) for reads/writes and the partner-turnover edge function for
// assignment + notifications.

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiPriceTag3Line, RiTeamLine, RiAlarmWarningLine, RiCalendarCheckLine,
  RiRepeatLine, RiStackLine, RiPlayLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; host_id: string; }
interface Turnover {
  id: string; property_id: string; host_id: string; requested_date: string; window_start: string | null; window_end: string | null;
  price: number; status: string; assignment_type: string | null; assigned_cleaner_id: string | null;
}
interface Cleaner { id: string; first_name: string | null; last_name: string | null; phone: string | null; }
interface Crew { id: string; cleaner_id: string; property_id: string | null; priority: number; active: boolean; is_turnover_crew: boolean; }
interface Batch { id: string; host_id: string; week_start: string; source: string; turnover_count: number; total_amount: number; status: string; recurring_schedule_id: string | null; created_at: string; }
interface RecurringSchedule { id: string; host_id: string; property_id: string; days_of_week: number[]; window_start: string | null; window_end: string | null; active: boolean; paused_until: string | null; last_generated_week: string | null; }

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Monday of next week (ISO date) — used to pause a recurring schedule.
function nextWeekIso(): string {
  const d = new Date();
  const dow = d.getDay();
  const toMon = dow === 0 ? 1 : (8 - dow) % 7 || 7;
  d.setDate(d.getDate() + toMon);
  return d.toISOString().slice(0, 10);
}

const STATUS_TONE: Record<string, string> = {
  unassigned_alert: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  assigned: "bg-violet-100 text-violet-700",
  cleaner_confirmed: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-700",
  pending_payment: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-400",
  in_progress: "bg-blue-100 text-blue-700",
  payment_failed: "bg-red-100 text-red-700",
  partially_assigned: "bg-amber-100 text-amber-700",
  complete: "bg-emerald-100 text-emerald-700",
};

export default function PartnerAdmin() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: props }, { data: trs }, { data: cl }, { data: cr }, { data: bb }, { data: rs }] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }).limit(100),
      (supabase.from as any)("cleaners").select("id, first_name, last_name, phone").order("first_name"),
      (supabase.from as any)("turnover_crew").select("*"),
      (supabase.from as any)("booking_batches").select("*").order("created_at", { ascending: false }).limit(50),
      (supabase.from as any)("recurring_schedules").select("*").order("created_at", { ascending: false }),
    ]);
    setProperties((props as Property[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    setCleaners((cl as Cleaner[]) || []);
    setCrew((cr as Crew[]) || []);
    setBatches((bb as Batch[]) || []);
    setSchedules((rs as RecurringSchedule[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cleanerName = (id: string | null) => {
    if (!id) return "—";
    const c = cleaners.find((x) => x.id === id);
    return c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner" : "Cleaner";
  };
  const propName = (id: string) => properties.find((p) => p.id === id)?.nickname || properties.find((p) => p.id === id)?.address || "Property";

  const setPrice = async (propertyId: string) => {
    const val = parseFloat(priceEdits[propertyId] || "");
    if (!Number.isFinite(val) || val <= 0) { toast.error("Enter a valid price."); return; }
    const { error } = await (supabase.from as any)("properties").update({ turnover_price: val }).eq("id", propertyId);
    if (error) { toast.error(error.message); return; }
    toast.success("Price set — property is now bookable.");
    load();
  };

  const assign = async (turnoverId: string, cleanerId: string) => {
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "admin.assign", turnoverId, cleanerId },
    });
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Assign failed"); return; }
    toast.success("Assigned & notified.");
    load();
  };

  const toggleCrew = async (cleaner: Cleaner) => {
    const existing = crew.find((c) => c.cleaner_id === cleaner.id && !c.property_id);
    if (existing) {
      const { error } = await (supabase.from as any)("turnover_crew").update({ active: !existing.active }).eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await (supabase.from as any)("turnover_crew").insert({ cleaner_id: cleaner.id, is_turnover_crew: true, active: true, priority: 100 });
      if (error) { toast.error(error.message); return; }
    }
    load();
  };
  const setPriority = async (crewId: string, priority: number) => {
    await (supabase.from as any)("turnover_crew").update({ priority }).eq("id", crewId);
    load();
  };

  const setSchedule = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await (supabase.from as any)("recurring_schedules").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };
  const runSchedule = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("partner-recurring-generate", { body: { mode: "generate", scheduleId: id } });
    if (error || (data as any)?.error) { toast.error((data as any)?.error || "Run failed"); return; }
    toast.success("Generation run triggered.");
    load();
  };
  const retryBatch = async (b: Batch) => {
    if (!b.recurring_schedule_id) { toast.error("Only recurring batches can be retried."); return; }
    await (supabase.from as any)("recurring_schedules").update({ last_generated_week: null }).eq("id", b.recurring_schedule_id);
    await runSchedule(b.recurring_schedule_id);
  };

  const pending = properties.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
  const unassigned = turnovers.filter((t) => t.status === "unassigned_alert");
  const failedBatches = batches.filter((b) => b.status === "payment_failed");

  if (loading) return <div className="flex justify-center py-20"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Partner Turnover Ops</h1>
        <p className="text-sm text-muted-foreground mt-1">Price properties, manage the turnover crew, and handle assignments.</p>
      </div>

      {/* Unassigned alert queue */}
      {unassigned.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2 text-amber-700"><RiAlarmWarningLine className="w-5 h-5" /> Needs manual assignment ({unassigned.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {unassigned.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <div className="text-sm">
                  <p className="font-medium">{propName(t.property_id)}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")} · ${Number(t.price).toFixed(0)}</p>
                </div>
                <AssignControl cleaners={cleaners} onAssign={(cid) => assign(t.id, cid)} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pending pricing */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiPriceTag3Line className="w-5 h-5 text-primary" /> Properties pending pricing ({pending.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">All properties are priced.</p>}
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{p.nickname || "Property"}</p>
                <p className="text-xs text-muted-foreground truncate">{p.address}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input className="w-28" inputMode="decimal" placeholder="per turnover" value={priceEdits[p.id] || ""} onChange={(e) => setPriceEdits({ ...priceEdits, [p.id]: e.target.value })} />
                <Button size="sm" onClick={() => setPrice(p.id)} style={{ background: "#5500FF" }}>Set</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Turnover crew */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiTeamLine className="w-5 h-5 text-primary" /> Turnover crew</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cleaners.map((c) => {
            const member = crew.find((x) => x.cleaner_id === c.id && !x.property_id);
            const isCrew = member && member.active;
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <span className="text-sm font-medium">{`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}</span>
                <div className="flex items-center gap-2">
                  {member && (
                    <Input type="number" className="w-20 h-8" value={member.priority} onChange={(e) => setPriority(member.id, parseInt(e.target.value, 10) || 100)} title="priority (lower = first)" />
                  )}
                  <Button size="sm" variant={isCrew ? "default" : "outline"} onClick={() => toggleCrew(c)} style={isCrew ? { background: "#5500FF" } : undefined}>
                    {isCrew ? "On crew" : "Add to crew"}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Payment-failed batches */}
      {failedBatches.length > 0 && (
        <Card className="border-red-300">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2 text-red-700"><RiAlarmWarningLine className="w-5 h-5" /> Payment-failed batches ({failedBatches.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {failedBatches.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/50 p-3">
                <div className="text-sm">
                  <p className="font-medium">Week of {b.week_start} · {b.turnover_count} turnover(s)</p>
                  <p className="text-xs text-muted-foreground">${Number(b.total_amount).toFixed(0)} · recurring charge declined</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => retryBatch(b)}><RiPlayLine className="w-3.5 h-3.5 mr-1" /> Retry</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recurring schedules */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiRepeatLine className="w-5 h-5 text-primary" /> Recurring schedules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {schedules.length === 0 && <p className="text-sm text-muted-foreground">No recurring schedules.</p>}
          {schedules.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{propName(s.property_id)}</p>
                <p className="text-xs text-muted-foreground">
                  {(s.days_of_week || []).slice().sort().map((d) => DOW_LABEL[d]).join(", ")}
                  {s.window_start ? ` · ${s.window_start.slice(0, 5)}–${(s.window_end || "").slice(0, 5)}` : ""}
                  {s.active ? "" : " · cancelled"}{s.paused_until ? ` · paused until ${s.paused_until}` : ""}
                  {s.last_generated_week ? ` · last gen ${s.last_generated_week}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => runSchedule(s.id)} title="Generate next week now"><RiPlayLine className="w-3.5 h-3.5 mr-1" /> Run now</Button>
                {s.active
                  ? (s.paused_until
                    ? <Button size="sm" variant="ghost" onClick={() => setSchedule(s.id, { paused_until: null })}>Resume</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setSchedule(s.id, { paused_until: nextWeekIso() })}>Pause</Button>)
                  : null}
                {s.active && <Button size="sm" variant="ghost" onClick={() => setSchedule(s.id, { active: false })}>Cancel</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent batches */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiStackLine className="w-5 h-5 text-primary" /> Recent batches</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {batches.length === 0 && <p className="text-sm text-muted-foreground">No batches yet.</p>}
          {batches.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm">
                <p className="font-medium">Week of {b.week_start} · {b.turnover_count} turnover(s)</p>
                <p className="text-xs text-muted-foreground">{b.source} · ${Number(b.total_amount).toFixed(0)}</p>
              </div>
              <Badge className={cn("text-[11px]", STATUS_TONE[b.status] || "bg-slate-100")}>{b.status.replace(/_/g, " ")}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* All requests */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiCalendarCheckLine className="w-5 h-5 text-primary" /> Recent turnover requests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {turnovers.length === 0 && <p className="text-sm text-muted-foreground">No requests yet.</p>}
          {turnovers.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{propName(t.property_id)}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")} · ${Number(t.price).toFixed(0)} · {t.assigned_cleaner_id ? cleanerName(t.assigned_cleaner_id) : "unassigned"}{t.assignment_type ? ` (${t.assignment_type})` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={cn("text-[11px]", STATUS_TONE[t.status] || "bg-slate-100")}>{t.status.replace(/_/g, " ")}</Badge>
                {["paid", "assigned", "unassigned_alert", "cleaner_confirmed"].includes(t.status) && (
                  <AssignControl cleaners={cleaners} onAssign={(cid) => assign(t.id, cid)} label="Reassign" />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AssignControl({ cleaners, onAssign, label = "Assign" }: { cleaners: Cleaner[]; onAssign: (cleanerId: string) => void; label?: string }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <Select value={val} onValueChange={(v) => { setVal(v); onAssign(v); }}>
        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={label} /></SelectTrigger>
        <SelectContent>
          {cleaners.map((c) => (
            <SelectItem key={c.id} value={c.id}>{`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
