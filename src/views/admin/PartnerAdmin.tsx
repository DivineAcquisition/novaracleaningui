"use client";

// ─── /admin/partner — Turnover portal operations ─────────────────────────
//
// Admin control for the host turnover portal: set per-property pricing
// (gates bookability), manage the turnover crew, review every request, work
// the unassigned-alert queue, and manually (re)assign. Reuses RLS (admin/va
// full access) for reads/writes and the partner-turnover edge function for
// assignment + notifications.

import { useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiPriceTag3Line, RiTeamLine, RiAlarmWarningLine, RiCalendarCheckLine,
  RiSearchLine, RiStarFill, RiImage2Line, RiMoneyDollarCircleLine, RiCheckboxCircleLine,
  RiFileTextLine, RiRepeatLine, RiUserStarLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PartnerOnboardingLinkDialog } from "@/components/admin/PartnerOnboardingLinkDialog";
import { cn } from "@/lib/utils";

interface Property { id: string; nickname: string | null; address: string | null; turnover_price: number | null; host_id: string; }
interface Host { id: string; name: string | null; email: string | null; phone: string | null; status: string | null; }
interface Turnover {
  id: string; property_id: string; host_id: string; requested_date: string; window_start: string | null; window_end: string | null;
  price: number; status: string; assignment_type: string | null; assigned_cleaner_id: string | null;
  host_rating?: number | null; host_review?: string | null;
  before_photos?: string[] | null; after_photos?: string[] | null;
}
interface Cleaner { id: string; first_name: string | null; last_name: string | null; phone: string | null; }
interface Crew { id: string; cleaner_id: string; property_id: string | null; priority: number; active: boolean; is_turnover_crew: boolean; }
interface RecurringSchedule {
  id: string; host_id: string; property_id: string; frequency: string | null;
  days_of_week: number[] | null; day_of_month: number | null;
  window_start: string | null; window_end: string | null;
  active: boolean; paused_until: string | null; price_snapshot: number | null;
}
interface Batch {
  id: string; host_id: string; week_start: string; source: string;
  turnover_count: number; total_amount: number; status: string; created_at: string;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"]; const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const STATUS_TONE: Record<string, string> = {
  unassigned_alert: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  assigned: "bg-violet-100 text-violet-700",
  cleaner_confirmed: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-700",
  pending_payment: "bg-slate-100 text-slate-500",
  cancelled: "bg-slate-100 text-slate-400",
  in_progress: "bg-blue-100 text-blue-700",
};

export default function PartnerAdmin() {
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [turnovers, setTurnovers] = useState<Turnover[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [recurring, setRecurring] = useState<RecurringSchedule[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [crewProperty, setCrewProperty] = useState<string>("");
  const [sendingAgreement, setSendingAgreement] = useState<string | null>(null);
  const [payDate, setPayDate] = useState<Record<string, string>>({});
  const [sendingPayLink, setSendingPayLink] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: props }, { data: hs }, { data: trs }, { data: cl }, { data: cr }, { data: rec }, { data: bt }] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("hosts").select("id, name, email, phone, status").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }).limit(500),
      (supabase.from as any)("cleaners").select("id, first_name, last_name, phone").order("first_name"),
      (supabase.from as any)("turnover_crew").select("*"),
      (supabase.from as any)("recurring_schedules").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("booking_batches").select("*").order("week_start", { ascending: false }).limit(100),
    ]);
    setProperties((props as Property[]) || []);
    setHosts((hs as Host[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    setCleaners((cl as Cleaner[]) || []);
    setCrew((cr as Crew[]) || []);
    setRecurring((rec as RecurringSchedule[]) || []);
    setBatches((bt as Batch[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live updates so ops see new requests / status changes without refresh.
  useEffect(() => {
    const ch = supabase
      .channel("admin-partner-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "turnover_requests" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

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

  // Pin a cleaner to a SPECIFIC property so they are consistently tried first
  // for that STR client's turnovers (runAssignment checks property-scoped crew
  // before the global pool). Toggling re-uses turnover_crew with property_id set.
  const togglePropertyCrew = async (cleanerId: string, propertyId: string) => {
    const existing = crew.find((c) => c.cleaner_id === cleanerId && c.property_id === propertyId);
    if (existing) {
      const { error } = await (supabase.from as any)("turnover_crew").delete().eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Removed from this property's crew.");
    } else {
      const { error } = await (supabase.from as any)("turnover_crew").insert({
        cleaner_id: cleanerId, property_id: propertyId, is_turnover_crew: true, active: true, priority: 10,
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Pinned to this property — they'll be assigned first.");
    }
    load();
  };

  // Admin pause/resume of a host's recurring schedule (RLS admin_all grants
  // direct write). Pausing stops the cron from generating the next week.
  const toggleRecurringActive = async (sched: RecurringSchedule) => {
    const { error } = await (supabase.from as any)("recurring_schedules")
      .update({ active: !sched.active }).eq("id", sched.id);
    if (error) { toast.error(error.message); return; }
    toast.success(sched.active ? "Recurring plan paused." : "Recurring plan resumed.");
    load();
  };

  const cadenceLabel = (s: RecurringSchedule) => {
    if (s.frequency === "monthly") {
      return s.day_of_month ? `Monthly · ${ordinal(s.day_of_month)}` : "Monthly";
    }
    const days = (s.days_of_week || []).slice().sort((a, b) => a - b).map((d) => DOW_LABELS[d]).join(", ");
    const perWeek = (s.days_of_week || []).length;
    return `Weekly · ${perWeek} clean${perWeek === 1 ? "" : "s"}/wk${days ? ` (${days})` : ""}`;
  };

  const pending = properties.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
  const priced = properties.filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0);
  const unassigned = turnovers.filter((t) => t.status === "unassigned_alert");
  const todayStr = new Date().toISOString().slice(0, 10);

  // Hosts whose every property is priced → ready to send the agreement.
  const hostsReadyForAgreement = useMemo(() => {
    return hosts
      .map((h) => {
        const hProps = properties.filter((p) => p.host_id === h.id);
        const priced = hProps.filter((p) => p.turnover_price != null && Number(p.turnover_price) > 0);
        return { host: h, total: hProps.length, priced: priced.length };
      })
      .filter((x) => x.total > 0);
  }, [hosts, properties]);

  const sendAgreement = async (hostId: string) => {
    setSendingAgreement(hostId);
    try {
      const { data, error } = await supabase.functions.invoke("partner-turnover", {
        body: { action: "admin.sendHostAgreement", hostId },
      });
      const err = error || (data as any)?.error;
      if (err) { toast.error((data as any)?.error || "Could not send agreement"); return; }
      toast.success("Host agreement sent — e-sign link emailed & texted.");
    } finally {
      setSendingAgreement(null);
    }
  };

  const hostName = (id: string) => {
    const h = hosts.find((x) => x.id === id);
    return h?.name || h?.email || "Host";
  };

  const sendPaymentLink = async (propertyId: string) => {
    const date = payDate[propertyId];
    if (!date) { toast.error("Pick a service date first."); return; }
    setSendingPayLink(propertyId);
    try {
      const { data, error } = await supabase.functions.invoke("partner-turnover", {
        body: { action: "admin.sendPaymentLink", propertyId, requested_date: date },
      });
      const err = error || (data as any)?.error;
      if (err) { toast.error((data as any)?.error || "Could not send payment link"); return; }
      toast.success("Payment link sent — Stripe checkout emailed & texted to the host.");
      setPayDate((prev) => ({ ...prev, [propertyId]: "" }));
      load();
    } finally {
      setSendingPayLink(null);
    }
  };

  // Apply one rate to every pending-pricing property at once.
  const setAllPending = async () => {
    const val = parseFloat(bulkPrice || "");
    if (!Number.isFinite(val) || val <= 0) { toast.error("Enter a valid price."); return; }
    if (pending.length === 0) { toast.error("No properties pending pricing."); return; }
    const { error } = await (supabase.from as any)("properties")
      .update({ turnover_price: val })
      .in("id", pending.map((p) => p.id));
    if (error) { toast.error(error.message); return; }
    toast.success(`Priced ${pending.length} propert${pending.length === 1 ? "y" : "ies"} at $${val.toFixed(0)}.`);
    setBulkPrice("");
    load();
  };

  // ── Stats + filtered request list ──────────────────────────────────────
  const stats = useMemo(() => {
    const revenue = turnovers
      .filter((t) => ["paid", "assigned", "cleaner_confirmed", "in_progress", "completed"].includes(t.status))
      .reduce((s, t) => s + Number(t.price || 0), 0);
    const completed = turnovers.filter((t) => t.status === "completed");
    const rated = completed.filter((t) => t.host_rating);
    const avgRating = rated.length ? rated.reduce((s, t) => s + (t.host_rating || 0), 0) / rated.length : 0;
    return {
      total: turnovers.length,
      completed: completed.length,
      revenue,
      avgRating,
      ratedCount: rated.length,
      unassigned: unassigned.length,
    };
  }, [turnovers, unassigned.length]);

  const filteredTurnovers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return turnovers.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!q) return true;
      const prop = properties.find((p) => p.id === t.property_id);
      const hay = `${prop?.nickname || ""} ${prop?.address || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [turnovers, properties, statusFilter, search]);

  if (loading) return <div className="flex justify-center py-20"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Turnover &amp; STR Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Price properties, group a consistent crew per STR client, review recurring plans, and handle assignments.</p>
        </div>
        <PartnerOnboardingLinkDialog refTag="partner-admin" />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<RiCalendarCheckLine className="w-4 h-4" />} label="Requests" value={String(stats.total)} />
        <StatCard icon={<RiCheckboxCircleLine className="w-4 h-4" />} label="Completed" value={String(stats.completed)} />
        <StatCard icon={<RiMoneyDollarCircleLine className="w-4 h-4" />} label="Booked revenue" value={`$${stats.revenue.toFixed(0)}`} />
        <StatCard
          icon={<RiStarFill className="w-4 h-4 text-amber-400" />}
          label={`Avg rating${stats.ratedCount ? ` (${stats.ratedCount})` : ""}`}
          value={stats.avgRating ? stats.avgRating.toFixed(1) : "—"}
        />
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
          {pending.length > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 bg-slate-50">
              <span className="text-sm font-medium">Set all {pending.length} pending at once</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input className="w-28" inputMode="decimal" placeholder="per turnover" value={bulkPrice} onChange={(e) => setBulkPrice(e.target.value)} />
                <Button size="sm" variant="outline" onClick={setAllPending}>Apply to all</Button>
              </div>
            </div>
          )}
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{p.nickname || "Property"}</p>
                <p className="text-xs text-muted-foreground truncate">{p.address}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <Input className="w-28" inputMode="decimal" placeholder="per turnover" value={priceEdits[p.id] || ""} onChange={(e) => setPriceEdits({ ...priceEdits, [p.id]: e.target.value })} />
                <Button size="sm" onClick={() => setPrice(p.id)}>Set</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Collect payment — send a Stripe Checkout link by email + SMS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiMoneyDollarCircleLine className="w-5 h-5 text-primary" /> Send payment link ({priced.length} priced)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {priced.length === 0 && <p className="text-sm text-muted-foreground">Set a rate on a property to send its host a Stripe checkout link.</p>}
          {priced.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{p.nickname || "Property"} · ${Number(p.turnover_price).toFixed(0)}/turnover</p>
                <p className="text-xs text-muted-foreground truncate">{hostName(p.host_id)}{p.address ? ` · ${p.address}` : ""}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  className="w-40 h-9"
                  min={todayStr}
                  value={payDate[p.id] || ""}
                  onChange={(e) => setPayDate({ ...payDate, [p.id]: e.target.value })}
                />
                <Button
                  size="sm"
                  disabled={!payDate[p.id] || sendingPayLink === p.id}
                  onClick={() => sendPaymentLink(p.id)}
                >
                  {sendingPayLink === p.id ? "Sending…" : "Send payment link"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Host agreements — send the Host Partnership Agreement to e-sign */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><RiFileTextLine className="w-5 h-5 text-primary" /> Host agreements ({hostsReadyForAgreement.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {hostsReadyForAgreement.length === 0 && <p className="text-sm text-muted-foreground">No hosts with properties yet.</p>}
          {hostsReadyForAgreement.map(({ host, total, priced }) => {
            const allPriced = priced === total && total > 0;
            return (
              <div key={host.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="text-sm min-w-0">
                  <p className="font-medium truncate">{host.name || host.email || "Host"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {host.email || "—"} · {priced}/{total} priced
                    {!allPriced && <span className="text-amber-600"> · price all to send</span>}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={allPriced ? "default" : "outline"}
                  disabled={!allPriced || sendingAgreement === host.id}
                  onClick={() => sendAgreement(host.id)}
                >
                  {sendingAgreement === host.id ? "Sending…" : "Send agreement"}
                </Button>
              </div>
            );
          })}
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
                  <Button size="sm" variant={isCrew ? "default" : "outline"} onClick={() => toggleCrew(c)}>
                    {isCrew ? "On crew" : "Add to crew"}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Consistent crew per STR property — pin cleaners to a property so they
          are always tried first for that host's turnovers. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><RiUserStarLine className="w-5 h-5 text-primary" /> Consistent crew per property</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">Pin specific cleaners to an STR property. Pinned cleaners are assigned first (before the global crew) for every turnover at that property — keeping the same team on each STR client.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
          {properties.length > 0 && (
            <Select value={crewProperty} onValueChange={setCrewProperty}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose a property to set its crew…" /></SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.nickname || p.address || "Property")} · {hostName(p.host_id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {crewProperty && (
            <div className="space-y-1.5 rounded-lg border p-2">
              {cleaners.map((c) => {
                const pinned = crew.some((x) => x.cleaner_id === c.id && x.property_id === crewProperty);
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
                    <span className="text-sm font-medium">{`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}</span>
                    <Button size="sm" variant={pinned ? "default" : "outline"} onClick={() => togglePropertyCrew(c.id, crewProperty)}>
                      {pinned ? "Pinned" : "Pin to property"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recurring schedules + paid batches — admin visibility & approval */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><RiRepeatLine className="w-5 h-5 text-primary" /> Recurring plans ({recurring.length})</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">Weekly / monthly turnover plans hosts have set up. The cron auto-generates &amp; charges each upcoming week; pause to stop generation.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {recurring.length === 0 && <p className="text-sm text-muted-foreground">No recurring plans yet.</p>}
          {recurring.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-sm min-w-0">
                <p className="font-medium truncate">{propName(s.property_id)} · {hostName(s.host_id)}</p>
                <p className="text-xs text-muted-foreground">
                  {cadenceLabel(s)}
                  {s.window_start ? ` · ${s.window_start.slice(0, 5)}–${(s.window_end || "").slice(0, 5)}` : ""}
                  {s.price_snapshot != null ? ` · ~$${Number(s.price_snapshot).toFixed(0)}/clean` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge className={cn("text-[11px]", s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                  {s.active ? "Active" : "Paused"}
                </Badge>
                <Button size="sm" variant={s.active ? "outline" : "default"} onClick={() => toggleRecurringActive(s)}>
                  {s.active ? "Pause" : "Resume"}
                </Button>
              </div>
            </div>
          ))}
          {batches.length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Recent batches</p>
              <div className="space-y-1">
                {batches.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-xs rounded-md border px-2.5 py-1.5">
                    <span className="min-w-0 truncate">{hostName(b.host_id)} · week of {format(new Date(`${b.week_start}T12:00:00`), "MMM d")} · {b.turnover_count} clean{b.turnover_count === 1 ? "" : "s"} · {b.source}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="tabular-nums">${Number(b.total_amount).toFixed(0)}</span>
                      <Badge className={cn("text-[10px]", STATUS_TONE[b.status] || "bg-slate-100")}>{b.status.replace(/_/g, " ")}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All requests */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><RiCalendarCheckLine className="w-5 h-5 text-primary" /> Turnover requests ({filteredTurnovers.length})</CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative flex-1 min-w-[180px]">
              <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Search property / address…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-44 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending_payment">Pending payment</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="cleaner_confirmed">Cleaner confirmed</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="unassigned_alert">Unassigned alert</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredTurnovers.length === 0 && <p className="text-sm text-muted-foreground">No requests match your filters.</p>}
          {filteredTurnovers.map((t) => {
            const photoCount = (t.before_photos?.length || 0) + (t.after_photos?.length || 0);
            const firstPhoto = (t.after_photos?.[0]) || (t.before_photos?.[0]);
            return (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                <div className="text-sm min-w-0">
                  <p className="font-medium truncate">{propName(t.property_id)}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(`${t.requested_date}T12:00:00`), "EEE, MMM d")} · ${Number(t.price).toFixed(0)} · {t.assigned_cleaner_id ? cleanerName(t.assigned_cleaner_id) : "unassigned"}{t.assignment_type ? ` (${t.assignment_type})` : ""}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {t.host_rating ? (
                      <span className="text-[11px] text-amber-500 flex items-center gap-0.5">
                        {Array.from({ length: t.host_rating }).map((_, i) => <RiStarFill key={i} className="w-3 h-3" />)}
                      </span>
                    ) : null}
                    {photoCount > 0 && firstPhoto && (
                      <a href={firstPhoto} target="_blank" rel="noreferrer" className="text-[11px] text-primary flex items-center gap-0.5 hover:underline">
                        <RiImage2Line className="w-3 h-3" /> {photoCount}
                      </a>
                    )}
                    {t.host_review && <span className="text-[11px] text-muted-foreground italic truncate max-w-[200px]">“{t.host_review}”</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={cn("text-[11px]", STATUS_TONE[t.status] || "bg-slate-100")}>{t.status.replace(/_/g, " ")}</Badge>
                  {["paid", "assigned", "unassigned_alert", "cleaner_confirmed"].includes(t.status) && (
                    <AssignControl cleaners={cleaners} onAssign={(cid) => assign(t.id, cid)} label="Reassign" />
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
        <p className="text-xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function AssignControl({ cleaners, onAssign, label = "Assign" }: { cleaners: Cleaner[]; onAssign: (cleanerId: string) => void; label?: string }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <Select value={val} onValueChange={(v) => { setVal(v); onAssign(v); }}>
        <SelectTrigger className="h-8 w-full sm:w-40 text-xs"><SelectValue placeholder={label} /></SelectTrigger>
        <SelectContent>
          {cleaners.map((c) => (
            <SelectItem key={c.id} value={c.id}>{`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
