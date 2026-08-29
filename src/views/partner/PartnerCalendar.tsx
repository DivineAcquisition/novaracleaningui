"use client";

// --- Host Turnover Calendar (partner portal) — Part A ----------------------
//
// A month/week calendar where a host taps dates to drop turnovers onto their
// properties, sees a live running total, and books+pays the whole batch at
// once. It is a visual front-end over the EXISTING server logic: pricing is
// `properties.turnover_price` (server-authoritative) and booking/payment/
// assignment/notifications all run through `partner-turnover` `batch.checkout`
// — the same action the weekly-schedule form uses. No money math on the client.
//
// Mobile-first: week view is the default on phones (a month grid is too cramped
// to tap); desktop defaults to month.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiArrowLeftLine, RiArrowLeftSLine, RiArrowRightSLine,
  RiCalendarEventLine, RiCloseLine, RiDeleteBin6Line, RiRepeatLine, RiCheckLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; status?: string | null; }
interface ExistingTurnover { id: string; property_id: string; requested_date: string; status: string; batch_id: string | null; }
interface Placed { id: string; propertyId: string; date: string; ws: string; we: string; repeat: boolean; }

// Per-property color ramp (chips + selector). Index by position in priced list.
const PALETTE = [
  { bg: "#5C0FFE", soft: "rgba(92,15,254,0.12)", text: "#5C0FFE" },
  { bg: "#0EA5E9", soft: "rgba(14,165,233,0.12)", text: "#0369A1" },
  { bg: "#10B981", soft: "rgba(16,185,129,0.12)", text: "#047857" },
  { bg: "#F59E0B", soft: "rgba(245,158,11,0.14)", text: "#B45309" },
  { bg: "#EC4899", soft: "rgba(236,72,153,0.12)", text: "#BE185D" },
  { bg: "#8B5CF6", soft: "rgba(139,92,246,0.12)", text: "#6D28D9" },
];

const ymd = (d: Date): string => {
  const z = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
};
const parseYmd = (s: string): Date => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d: Date, n: number): Date => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const mondayOf = (d: Date): Date => { const x = new Date(d); const dow = x.getDay(); x.setDate(x.getDate() + (dow === 0 ? -6 : 1 - dow)); return x; };
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const isPastDate = (s: string) => s < ymd(new Date());

let placedSeq = 0;

export default function PartnerCalendar() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [existing, setExisting] = useState<ExistingTurnover[]>([]);
  const [recurringBatchIds, setRecurringBatchIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [editing, setEditing] = useState<Placed | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const priced = useMemo(
    () => properties.filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0),
    [properties],
  );
  const colorOf = useCallback((id: string) => {
    const idx = priced.findIndex((p) => p.id === id);
    return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
  }, [priced]);
  const priceOf = useCallback((id: string) => Number(properties.find((p) => p.id === id)?.turnover_price || 0), [properties]);
  const nameOf = useCallback((id: string) => { const p = properties.find((x) => x.id === id); return p?.nickname || p?.address || "Property"; }, [properties]);

  // Default to week view on small screens (a month grid is unusable on a phone).
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches) {
      setView("week");
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await supabase.functions.invoke("partner-turnover", { body: { action: "host.ensure" } }).catch(() => {});
    const [{ data: props }, { data: trs }, { data: batches }] = await Promise.all([
      (supabase.from as never as (t: string) => any)("properties").select("id, nickname, address, turnover_price, status").order("created_at", { ascending: false }),
      (supabase.from as never as (t: string) => any)("turnover_requests").select("id, property_id, requested_date, status, batch_id").neq("status", "cancelled").gte("requested_date", ymd(addDays(new Date(), -1))),
      (supabase.from as never as (t: string) => any)("booking_batches").select("id, source").eq("source", "recurring"),
    ]);
    setProperties((props as Property[]) || []);
    setExisting((trs as ExistingTurnover[]) || []);
    setRecurringBatchIds(new Set(((batches as { id: string }[]) || []).map((b) => b.id)));
    if (!selectedPropertyId && (props as Property[])?.length) {
      const firstPriced = (props as Property[]).find((p) => p.turnover_price != null && Number(p.turnover_price) > 0);
      if (firstPriced) setSelectedPropertyId(firstPriced.id);
    }
    setLoading(false);
  }, [selectedPropertyId]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ─── Placed turnovers indexed by date ─────────────────────────────────────
  const placedByDate = useMemo(() => {
    const m = new Map<string, Placed[]>();
    for (const p of placed) { const l = m.get(p.date) || []; l.push(p); m.set(p.date, l); }
    return m;
  }, [placed]);

  const existingByDate = useMemo(() => {
    const m = new Map<string, ExistingTurnover[]>();
    for (const e of existing) { const l = m.get(e.requested_date) || []; l.push(e); m.set(e.requested_date, l); }
    return m;
  }, [existing]);

  const total = useMemo(() => placed.reduce((s, p) => s + priceOf(p.propertyId), 0), [placed, priceOf]);

  // ─── Add / edit / remove ──────────────────────────────────────────────────
  const addOnDate = (date: string) => {
    if (isPastDate(date)) { toast.error("That date has already passed."); return; }
    if (!selectedPropertyId) { toast.error("Pick a property to schedule first."); return; }
    const prop = properties.find((p) => p.id === selectedPropertyId);
    if (!prop || prop.turnover_price == null || Number(prop.turnover_price) <= 0) {
      toast.error("That property isn't priced yet — pricing pending.");
      return;
    }
    const sameDay = placed.filter((p) => p.propertyId === selectedPropertyId && p.date === date);
    if (sameDay.length >= 1) {
      if (!window.confirm(`Add a SECOND turnover for ${nameOf(selectedPropertyId)} on ${format(parseYmd(date), "MMM d")}? Each turnover is its own clean and its own charge.`)) return;
    }
    setPlaced((prev) => [...prev, { id: `p${++placedSeq}`, propertyId: selectedPropertyId, date, ws: "11:00", we: "15:00", repeat: false }]);
  };
  const removePlaced = (id: string) => { setPlaced((prev) => prev.filter((p) => p.id !== id)); setEditing(null); };
  const updatePlaced = (id: string, patch: Partial<Placed>) => setPlaced((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // ─── Booking ──────────────────────────────────────────────────────────────
  const book = async () => {
    if (placed.length === 0) return;
    for (const p of placed) {
      if (minutes(p.ws) >= minutes(p.we)) { toast.error(`${nameOf(p.propertyId)} (${format(parseYmd(p.date), "MMM d")}): checkout must be before the next check-in.`); return; }
    }
    const tight = placed.some((p) => minutes(p.we) - minutes(p.ws) < 180);
    if (tight && !window.confirm("One or more turnovers have a tight window (under 3 hours) — that's a rush turnover. Continue?")) return;

    const lines = placed.map((p) => ({ propertyId: p.propertyId, date: p.date, window_start: p.ws, window_end: p.we }));
    // Recurring: group placed marked repeat by property + day-of-week.
    const repeatMap = new Map<string, { propertyId: string; days_of_week: number[]; window_start: string; window_end: string }>();
    for (const p of placed.filter((x) => x.repeat)) {
      const dow = parseYmd(p.date).getDay();
      const key = `${p.propertyId}|${p.ws}|${p.we}`;
      const r = repeatMap.get(key) || { propertyId: p.propertyId, days_of_week: [], window_start: p.ws, window_end: p.we };
      if (!r.days_of_week.includes(dow)) r.days_of_week.push(dow);
      repeatMap.set(key, r);
    }
    const earliest = placed.map((p) => p.date).sort()[0];
    const weekStart = ymd(mondayOf(parseYmd(earliest)));

    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("partner-turnover", {
      body: { action: "batch.checkout", weekStart, lines, repeat: Array.from(repeatMap.values()) },
    });
    if (error || (data as { error?: string; url?: string })?.error || !(data as { url?: string })?.url) {
      setSubmitting(false);
      toast.error((data as { error?: string })?.error || "Could not start checkout");
      return;
    }
    window.location.href = (data as { url: string }).url;
  };

  // ─── Period navigation ────────────────────────────────────────────────────
  const periodLabel = view === "month"
    ? format(anchor, "MMMM yyyy")
    : (() => { const s = mondayOf(anchor); return `${format(s, "MMM d")} – ${format(addDays(s, 6), "MMM d")}`; })();

  const go = (dir: number) => setAnchor((a) => (view === "month" ? addMonths(a, dir) : addDays(a, dir * 7)));

  // Grid cells for the visible period.
  const cells = useMemo<Array<{ date: string | null }>>(() => {
    if (view === "week") {
      const s = mondayOf(anchor);
      return Array.from({ length: 7 }, (_, i) => ({ date: ymd(addDays(s, i)) }));
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // Mon-first leading blanks
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const out: Array<{ date: string | null }> = [];
    for (let i = 0; i < lead; i++) out.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) out.push({ date: ymd(new Date(anchor.getFullYear(), anchor.getMonth(), d)) });
    while (out.length % 7 !== 0) out.push({ date: null });
    return out;
  }, [view, anchor]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  const hasPriced = priced.length > 0;

  return (
    <div className="min-h-screen bg-background pb-28">
      <SEO title="Turnover Calendar" noindex />
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/partner/dashboard")}><RiArrowLeftLine className="w-4 h-4" /></Button>
          <span className="font-bold">Turnover calendar</span>
          <div className="ml-auto flex items-center rounded-lg border bg-slate-50 p-0.5 text-xs font-medium">
            {(["week", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-3 py-1.5 rounded-md capitalize transition", view === v ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-4 py-5 space-y-5">
        {!hasPriced ? (
          <div className="rounded-2xl border bg-white p-6 text-center text-sm text-muted-foreground">
            None of your properties are priced yet. Once our team sets your per-turnover rate you can schedule turnovers here.
          </div>
        ) : (
          <>
            {/* Property selector */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Scheduling for</p>
              <div className="flex flex-wrap gap-2">
                {properties.map((p) => {
                  const isPriced = p.turnover_price != null && Number(p.turnover_price) > 0;
                  const c = colorOf(p.id);
                  const selected = selectedPropertyId === p.id;
                  if (!isPriced) {
                    return (
                      <span key={p.id} className="px-3 py-1.5 rounded-full text-xs font-medium border bg-slate-100 text-slate-400 cursor-not-allowed" title="Pricing pending">
                        {p.nickname || p.address} · pricing pending
                      </span>
                    );
                  }
                  return (
                    <button key={p.id} type="button" onClick={() => setSelectedPropertyId(p.id)}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-semibold border transition", selected ? "text-white border-transparent" : "bg-white text-slate-700 hover:bg-slate-50")}
                      style={selected ? { background: c.bg } : { borderColor: c.soft }}>
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: selected ? "#fff" : c.bg }} />
                      {p.nickname || p.address} · ${Number(p.turnover_price).toFixed(0)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Period nav */}
            <div className="flex items-center justify-between">
              <Button variant="outline" size="icon" onClick={() => go(-1)}><RiArrowLeftSLine className="w-4 h-4" /></Button>
              <p className="font-semibold text-slate-900">{periodLabel}</p>
              <Button variant="outline" size="icon" onClick={() => go(1)}><RiArrowRightSLine className="w-4 h-4" /></Button>
            </div>

            {/* Calendar grid */}
            <div className="rounded-2xl border bg-white overflow-hidden">
              <div className="grid grid-cols-7 border-b bg-slate-50 text-[11px] font-semibold text-slate-500">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="px-2 py-2 text-center">{d}</div>
                ))}
              </div>
              <div className={cn("grid grid-cols-7", view === "week" && "min-h-[60vh]")}>
                {cells.map((cell, i) => {
                  if (!cell.date) return <div key={`b${i}`} className="border-b border-r min-h-[84px] bg-slate-50/40" />;
                  const date = cell.date;
                  const dayPlaced = placedByDate.get(date) || [];
                  const dayExisting = existingByDate.get(date) || [];
                  const past = isPastDate(date);
                  const isToday = date === ymd(new Date());
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => addOnDate(date)}
                      disabled={past}
                      className={cn(
                        "relative text-left border-b border-r p-1.5 align-top transition",
                        view === "week" ? "min-h-[60vh]" : "min-h-[84px] sm:min-h-[96px]",
                        past ? "bg-slate-50/60 cursor-not-allowed" : "hover:bg-violet-50/40",
                      )}
                    >
                      <span className={cn(
                        "inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-semibold",
                        isToday ? "bg-[#5C0FFE] text-white" : past ? "text-slate-300" : "text-slate-600",
                      )}>
                        {format(parseYmd(date), "d")}
                      </span>
                      <div className="mt-1 space-y-1">
                        {dayPlaced.map((p) => {
                          const c = colorOf(p.propertyId);
                          return (
                            <div key={p.id} role="button" tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); setEditing(p); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setEditing(p); } }}
                              className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-white truncate cursor-pointer"
                              style={{ background: c.bg }}>
                              {p.repeat && <RiRepeatLine className="w-2.5 h-2.5 shrink-0" />}
                              <span className="truncate">{nameOf(p.propertyId)}</span>
                              <span className="ml-auto shrink-0">${priceOf(p.propertyId).toFixed(0)}</span>
                            </div>
                          );
                        })}
                        {dayExisting.map((e) => {
                          const c = colorOf(e.property_id);
                          const isRecurring = !!e.batch_id && recurringBatchIds.has(e.batch_id);
                          return (
                            <div key={e.id}
                              className={cn("flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium truncate", isRecurring ? "bg-white border border-dashed" : "")}
                              style={isRecurring ? { borderColor: c.bg, color: c.text } : { background: c.soft, color: c.text }}
                              title={isRecurring ? "Auto-scheduled (recurring)" : `Booked · ${e.status}`}>
                              {isRecurring && <RiRepeatLine className="w-2.5 h-2.5 shrink-0" />}
                              <span className="truncate">{nameOf(e.property_id)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#5C0FFE]" /> New (this booking)</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ background: "rgba(92,15,254,0.12)" }} /> Booked</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-dashed border-[#5C0FFE]" /> Auto-coming (recurring)</span>
            </p>
          </>
        )}
      </main>

      {/* Sticky live total */}
      {hasPriced && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t shadow-lg z-20">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{placed.length} turnover{placed.length === 1 ? "" : "s"} placed</p>
              <p className="text-xl font-bold">${total.toFixed(0)}</p>
            </div>
            <Button onClick={() => setReviewing(true)} disabled={placed.length === 0} className="h-11 px-6" style={{ background: "#5C0FFE" }}>
              <RiCalendarEventLine className="w-4 h-4 mr-1.5" /> Review &amp; book
            </Button>
          </div>
        </div>
      )}

      {/* Chip editor */}
      {editing && (
        <Overlay onClose={() => setEditing(null)} title={`${nameOf(editing.propertyId)} · ${format(parseYmd(editing.date), "EEE, MMM d")}`}>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Checkout</Label><Input type="time" value={editing.ws} onChange={(e) => { updatePlaced(editing.id, { ws: e.target.value }); setEditing({ ...editing, ws: e.target.value }); }} /></div>
            <div><Label className="text-xs">Next check-in by</Label><Input type="time" value={editing.we} onChange={(e) => { updatePlaced(editing.id, { we: e.target.value }); setEditing({ ...editing, we: e.target.value }); }} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm mt-3">
            <input type="checkbox" checked={editing.repeat} onChange={(e) => { updatePlaced(editing.id, { repeat: e.target.checked }); setEditing({ ...editing, repeat: e.target.checked }); }} />
            <RiRepeatLine className="w-4 h-4 text-[#5C0FFE]" /> Repeat weekly (auto-schedule every {format(parseYmd(editing.date), "EEEE")})
          </label>
          <div className="flex items-center justify-between mt-4">
            <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => removePlaced(editing.id)}>
              <RiDeleteBin6Line className="w-4 h-4 mr-1" /> Remove
            </Button>
            <Button size="sm" onClick={() => setEditing(null)} style={{ background: "#5C0FFE" }}><RiCheckLine className="w-4 h-4 mr-1" /> Done</Button>
          </div>
        </Overlay>
      )}

      {/* Review & book */}
      {reviewing && (
        <Overlay onClose={() => setReviewing(false)} title="Review & book">
          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 divide-y">
            {placed.slice().sort((a, b) => a.date.localeCompare(b.date)).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{nameOf(p.propertyId)}{p.repeat && <RiRepeatLine className="inline w-3 h-3 ml-1 text-[#5C0FFE]" />}</p>
                  <p className="text-xs text-muted-foreground">{format(parseYmd(p.date), "EEE, MMM d")} · {p.ws}–{p.we}</p>
                </div>
                <span className="font-semibold shrink-0">${priceOf(p.propertyId).toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-3 mt-2">
            <div>
              <p className="text-xs text-muted-foreground">{placed.length} turnover{placed.length === 1 ? "" : "s"}</p>
              <p className="text-lg font-bold">${total.toFixed(0)}</p>
            </div>
            <Button onClick={book} disabled={submitting} className="h-11 px-6" style={{ background: "#5C0FFE" }}>
              {submitting ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <>Book &amp; pay ${total.toFixed(0)}</>}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">One secure charge for the batch. Each turnover is created as its own clean and dispatched to a cleaner after payment. Prices are computed server-side from each property's current rate.</p>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-sm">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><RiCloseLine className="w-4 h-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}
