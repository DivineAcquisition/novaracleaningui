"use client";

// --- Weekly Turnover Schedule builder (partner portal) ---------------------
//
// Lets a host lay out a whole week of turnovers across their properties, see a
// live total, optionally mark rows as repeat-weekly, and pay once. All pricing
// is server-authoritative (partner-turnover batch.checkout). Mobile-first with
// a sticky total bar. Also manages existing recurring schedules.

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiAddLine, RiDeleteBin6Line, RiArrowLeftLine, RiRepeatLine,
  RiCalendarEventLine, RiCloseLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; }
interface Recurring { id: string; property_id: string; days_of_week: number[]; window_start: string | null; window_end: string | null; active: boolean; paused_until: string | null; }

// JS day-of-week: 0=Sun..6=Sat. Display Mon-first.
const DOW = [
  { v: 1, label: "Mon" }, { v: 2, label: "Tue" }, { v: 3, label: "Wed" },
  { v: 4, label: "Thu" }, { v: 5, label: "Fri" }, { v: 6, label: "Sat" }, { v: 0, label: "Sun" },
];

interface Row { id: string; propertyId: string; dows: number[]; ws: string; we: string; repeat: boolean; }
let rowSeq = 0;
const newRow = (): Row => ({ id: `r${++rowSeq}`, propertyId: "", dows: [], ws: "11:00", we: "15:00", repeat: false });

function upcomingMonday(): string {
  const d = new Date();
  const dow = d.getDay();
  const offset = dow === 0 ? 1 : (8 - dow) % 7 || 7; // next Monday (always future)
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function dateForDow(weekStartMonday: string, dow: number): string {
  const offset = dow === 0 ? 6 : dow - 1;
  const d = new Date(`${weekStartMonday}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

export default function PartnerWeeklySchedule() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [weekStart, setWeekStart] = useState(upcomingMonday());
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);

  const priced = useMemo(() => properties.filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0), [properties]);
  const priceOf = useCallback((id: string) => Number(properties.find((p) => p.id === id)?.turnover_price || 0), [properties]);
  const nameOf = useCallback((id: string) => { const p = properties.find((x) => x.id === id); return p?.nickname || p?.address || "Property"; }, [properties]);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
    const [{ data: props }, { data: rec }] = await Promise.all([
      (supabase.from as any)("properties").select("id, nickname, address, turnover_price").order("created_at", { ascending: false }),
      (supabase.from as any)("recurring_schedules").select("*").eq("active", true),
    ]);
    setProperties((props as Property[]) || []);
    setRecurring((rec as Recurring[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const total = useMemo(
    () => rows.reduce((sum, r) => sum + (r.propertyId ? priceOf(r.propertyId) * r.dows.length : 0), 0),
    [rows, priceOf],
  );
  const turnoverCount = useMemo(() => rows.reduce((n, r) => n + (r.propertyId ? r.dows.length : 0), 0), [rows]);

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleDow = (id: string, v: number) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, dows: r.dows.includes(v) ? r.dows.filter((d) => d !== v) : [...r.dows, v] } : r));

  const submit = async () => {
    const valid = rows.filter((r) => r.propertyId && r.dows.length > 0);
    if (valid.length === 0) { toast.error("Add at least one property and day."); return; }
    for (const r of valid) {
      if (minutes(r.ws) >= minutes(r.we)) { toast.error(`${nameOf(r.propertyId)}: checkout time must be before the check-in deadline.`); return; }
    }
    // Tight-window warning (<3h) — warn, don't block.
    const tight = valid.some((r) => minutes(r.we) - minutes(r.ws) < 180);
    if (tight && !window.confirm("One or more turnovers have a tight window (under 3 hours) — that's a rush turnover. Continue?")) return;

    // Build server payload: one line per (row, day); dedupe identical lines.
    const lines: Array<{ propertyId: string; date: string; window_start: string; window_end: string }> = [];
    const seen = new Set<string>();
    let dupConfirmed = false;
    for (const r of valid) {
      for (const dow of r.dows) {
        const date = dateForDow(weekStart, dow);
        const key = `${r.propertyId}|${date}|${r.ws}|${r.we}`;
        if (seen.has(key)) {
          if (!dupConfirmed) {
            if (!window.confirm("You have two identical turnovers (same property, day, and window). Keep both as separate paid cleans?")) return;
            dupConfirmed = true;
          }
        }
        seen.add(key);
        lines.push({ propertyId: r.propertyId, date, window_start: r.ws, window_end: r.we });
      }
    }
    const repeat = valid.filter((r) => r.repeat).map((r) => ({ propertyId: r.propertyId, days_of_week: r.dows, window_start: r.ws, window_end: r.we }));

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "batch.checkout", weekStart, lines, repeat },
    });
    if (error || (data as any)?.error || !(data as any)?.url) {
      setSubmitting(false);
      toast.error((data as any)?.error || "Could not start checkout");
      return;
    }
    window.location.href = (data as any).url;
  };

  const recurringAction = async (scheduleId: string, op: "pause" | "resume" | "cancel") => {
    const paused_until = op === "pause" ? prompt("Pause until (YYYY-MM-DD), or leave blank to pause next week:") || undefined : undefined;
    const { error } = await supabase.functions.invoke("partner-turnover", { body: { action: "recurring.update", scheduleId, op, paused_until } });
    if (error) { toast.error("Could not update"); return; }
    toast.success(op === "cancel" ? "Recurring schedule cancelled" : op === "pause" ? "Paused" : "Resumed");
    load();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <SEO title="Weekly Schedule" noindex />
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/partner/dashboard")}><RiArrowLeftLine className="w-4 h-4" /></Button>
          <span className="font-bold">Weekly schedule</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {priced.length === 0 ? (
          <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
            None of your properties are priced yet. Once our team sets your per-turnover rate, you can build a weekly schedule.
          </CardContent></Card>
        ) : (
          <>
            <div>
              <Label>Week starting (Monday)</Label>
              <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="max-w-xs" />
              <p className="text-xs text-muted-foreground mt-1">{format(new Date(`${weekStart}T00:00:00`), "MMM d")} – {format(new Date(`${dateForDow(weekStart, 0)}T00:00:00`), "MMM d")}</p>
            </div>

            <div className="space-y-3">
              {rows.map((r) => {
                const p = priced.find((x) => x.id === r.propertyId);
                const lineTotal = r.propertyId ? priceOf(r.propertyId) * r.dows.length : 0;
                return (
                  <Card key={r.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <select
                          className="flex-1 h-10 rounded-md border border-input bg-background px-3 text-sm"
                          value={r.propertyId}
                          onChange={(e) => update(r.id, { propertyId: e.target.value })}
                        >
                          <option value="">Select a property…</option>
                          {priced.map((pp) => <option key={pp.id} value={pp.id}>{pp.nickname || pp.address} — ${Number(pp.turnover_price).toFixed(0)}</option>)}
                        </select>
                        {rows.length > 1 && (
                          <Button variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}><RiDeleteBin6Line className="w-4 h-4 text-muted-foreground" /></Button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {DOW.map((d) => (
                          <button key={d.v} type="button" onClick={() => toggleDow(r.id, d.v)}
                            className={cn("px-2.5 py-1 rounded-full text-xs font-medium border", r.dows.includes(d.v) ? "text-white border-transparent" : "bg-white text-muted-foreground")}
                            style={r.dows.includes(d.v) ? { background: "#5500FF" } : undefined}>
                            {d.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs">Checkout</Label><Input type="time" value={r.ws} onChange={(e) => update(r.id, { ws: e.target.value })} /></div>
                        <div><Label className="text-xs">Next check-in by</Label><Input type="time" value={r.we} onChange={(e) => update(r.id, { we: e.target.value })} /></div>
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={r.repeat} onChange={(e) => update(r.id, { repeat: e.target.checked })} />
                          <RiRepeatLine className="w-4 h-4 text-primary" /> Repeat weekly
                        </label>
                        {r.propertyId && r.dows.length > 0 && (
                          <span className="text-sm font-semibold text-primary">{r.dows.length} × ${priceOf(r.propertyId).toFixed(0)} = ${lineTotal.toFixed(0)}</span>
                        )}
                      </div>
                      {p && r.dows.length > 0 && minutes(r.we) - minutes(r.ws) < 180 && (
                        <p className="text-[11px] text-amber-600">Tight window (under 3h) — this is a rush turnover.</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              <Button variant="outline" className="w-full" onClick={() => setRows((rs) => [...rs, newRow()])}>
                <RiAddLine className="w-4 h-4 mr-1" /> Add another property / day set
              </Button>
            </div>

            {/* Existing recurring schedules */}
            {recurring.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-bold flex items-center gap-1.5"><RiRepeatLine className="w-4 h-4 text-primary" /> Your recurring schedules</h2>
                {recurring.map((rc) => (
                  <Card key={rc.id}><CardContent className="p-3 flex items-center justify-between gap-2">
                    <div className="text-sm min-w-0">
                      <p className="font-medium truncate">{nameOf(rc.property_id)}</p>
                      <p className="text-xs text-muted-foreground">
                        {rc.days_of_week.slice().sort().map((d) => DOW.find((x) => x.v === d)?.label).join(", ")}
                        {rc.window_start ? ` · ${rc.window_start.slice(0, 5)}–${(rc.window_end || "").slice(0, 5)}` : ""}
                        {rc.paused_until ? ` · paused until ${rc.paused_until}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {rc.paused_until
                        ? <Button size="sm" variant="outline" onClick={() => recurringAction(rc.id, "resume")}>Resume</Button>
                        : <Button size="sm" variant="outline" onClick={() => recurringAction(rc.id, "pause")}>Pause</Button>}
                      <Button size="sm" variant="ghost" onClick={() => recurringAction(rc.id, "cancel")}><RiCloseLine className="w-4 h-4" /></Button>
                    </div>
                  </CardContent></Card>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Sticky total bar */}
      {priced.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t shadow-lg">
          <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{turnoverCount} turnover{turnoverCount === 1 ? "" : "s"} this week</p>
              <p className="text-xl font-bold">${total.toFixed(0)}</p>
            </div>
            <Button onClick={submit} disabled={submitting || turnoverCount === 0} className="h-11 px-6" style={{ background: "#5500FF" }}>
              {submitting ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <><RiCalendarEventLine className="w-4 h-4 mr-1.5" /> Review &amp; pay ${total.toFixed(0)}</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
