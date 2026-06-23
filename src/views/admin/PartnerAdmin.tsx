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
  RiFileTextLine,
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
  const [sendingAgreement, setSendingAgreement] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: props }, { data: hs }, { data: trs }, { data: cl }, { data: cr }] = await Promise.all([
      (supabase.from as any)("properties").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("hosts").select("id, name, email, phone, status").order("created_at", { ascending: false }),
      (supabase.from as any)("turnover_requests").select("*").order("created_at", { ascending: false }).limit(500),
      (supabase.from as any)("cleaners").select("id, first_name, last_name, phone").order("first_name"),
      (supabase.from as any)("turnover_crew").select("*"),
    ]);
    setProperties((props as Property[]) || []);
    setHosts((hs as Host[]) || []);
    setTurnovers((trs as Turnover[]) || []);
    setCleaners((cl as Cleaner[]) || []);
    setCrew((cr as Crew[]) || []);
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

  const pending = properties.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
  const unassigned = turnovers.filter((t) => t.status === "unassigned_alert");

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
          <h1 className="text-2xl font-bold tracking-tight">Partner Turnover Ops</h1>
          <p className="text-sm text-muted-foreground mt-1">Price properties, manage the turnover crew, and handle assignments.</p>
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
