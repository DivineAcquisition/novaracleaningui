"use client";

// ─── /admin/recurring — Memberships & recurring cleaning hub ──────────────
//
// The admin management hub for memberships:
//   • Members — every Glow membership (from Stripe subscription credits):
//     plan, credits used/remaining, billing period, contact info, linked
//     recurring schedule. Pause / resume / cancel billing right here, or
//     spin up their recurring schedule pre-filled.
//   • Schedules — the recurring cleaning engine: cadence (weekly / biweekly
//     / monthly), preferred time + cleaner, pause/resume, edit, "generate
//     now", and create. Each cycle the customer-recurring-generate cron
//     creates a confirmed booking, assigns the preferred/previous cleaner,
//     and syncs GHL + Airtable + Google Calendar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiRepeatLine, RiAddLine, RiPlayLine, RiPauseLine, RiFlashlightLine, RiCloseLine,
  RiVipCrownLine, RiUserHeartLine, RiStopCircleLine, RiCalendarScheduleLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calculatePrice, SERVICE_TIER_PRICING, HOME_SIZE_RANGES } from "@/lib/pricing";
import { cn } from "@/lib/utils";

interface Schedule {
  id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip_code: string | null;
  home_size_id: string | null; service_type: string; add_ons: string[] | null;
  cadence: string; preferred_time_slot: string | null; preferred_cleaner_id: string | null;
  price_cents: number | null; uses_credit: boolean; membership_plan: string | null;
  next_service_date: string | null; last_generated_date: string | null; active: boolean; notes: string | null;
}
interface Cleaner { id: string; first_name: string | null; last_name: string | null; }
interface Member {
  id: string;
  email: string;
  customer_id: string;
  subscription_id: string;
  membership_plan: string;
  credits_per_month: number;
  credits_remaining: number;
  credits_used: number | null;
  current_period_start: string;
  current_period_end: string;
  period_active: boolean;
  customer: { first_name?: string | null; last_name?: string | null; phone?: string | null; city?: string | null; state?: string | null } | null;
  schedules: { id: string; cadence: string; active: boolean; next_service_date: string | null }[];
  last_booking: { service_date?: string | null; status?: string | null } | null;
}

const TIME_SLOTS = [
  "8:00 AM - 9:00 AM", "9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM", "2:00 PM - 3:00 PM", "3:00 PM - 4:00 PM",
  "4:00 PM - 5:00 PM", "5:00 PM - 6:00 PM",
];
const fmtMoney = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(0)}`);
const PLAN_LABELS: Record<string, string> = {
  weekly: "Glow Weekly",
  biweekly: "Glow Bi-Weekly",
  monthly: "Glow Monthly",
};
const PLAN_CADENCE: Record<string, string> = { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" };

export default function AdminRecurringSchedules() {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [prefill, setPrefill] = useState<Partial<Schedule> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMembersError(null);
    const [{ data: s }, { data: c }, membersRes] = await Promise.all([
      (supabase.from as any)("customer_recurring_schedules").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("cleaners").select("id, first_name, last_name").eq("status", "active").order("first_name"),
      supabase.functions.invoke("admin-memberships", { body: {} }).catch((e) => ({ data: null, error: e })),
    ]);
    setSchedules((s as Schedule[]) || []);
    setCleaners((c as Cleaner[]) || []);
    const mData = (membersRes as any)?.data;
    if ((membersRes as any)?.error || mData?.error) {
      setMembersError(String(mData?.error || (membersRes as any)?.error?.message || "Couldn't load members"));
      setMembers([]);
    } else {
      setMembers((mData?.members as Member[]) || []);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cleanerName = (id: string | null) => {
    if (!id) return "Auto (previous cleaner)";
    const c = cleaners.find((x) => x.id === id);
    return c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Cleaner";
  };

  const patch = async (id: string, fields: Record<string, unknown>) => {
    const { error } = await (supabase.from as any)("customer_recurring_schedules")
      .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const generateNow = async (id: string) => {
    setWorking(id);
    try {
      const { data, error } = await supabase.functions.invoke("customer-recurring-generate", {
        body: { scheduleId: id, force: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = (data as any)?.results?.[0];
      toast.success(r?.status === "created" ? "Next clean generated & assigned." : `Generator: ${r?.status || "done"}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  };

  const memberAction = async (m: Member, action: "pause" | "resume" | "cancel") => {
    const verb = action === "cancel" ? "cancel at period end" : action;
    if (!confirm(`${verb.charAt(0).toUpperCase() + verb.slice(1)} the ${PLAN_LABELS[m.membership_plan] || m.membership_plan} membership for ${m.email}?`)) return;
    setWorking(m.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: { action, subscriptionId: m.subscription_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(
        action === "pause" ? "Membership billing paused." :
        action === "resume" ? "Membership billing resumed." :
        "Membership will cancel at the end of the current period.",
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  };

  const startScheduleForMember = (m: Member) => {
    setPrefill({
      email: m.email,
      first_name: m.customer?.first_name || "",
      last_name: m.customer?.last_name || "",
      phone: m.customer?.phone || "",
      cadence: PLAN_CADENCE[m.membership_plan] || "biweekly",
      uses_credit: true,
      membership_plan: m.membership_plan,
    } as Partial<Schedule>);
    setShowCreate(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const active = schedules.filter((s) => s.active);
  const paused = schedules.filter((s) => !s.active);
  const membersNeedingSchedule = useMemo(
    () => members.filter((m) => m.period_active && !m.schedules.some((s) => s.active)),
    [members],
  );

  if (loading) return <div className="flex justify-center py-20"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiVipCrownLine className="w-6 h-6 text-violet-700" /> Memberships &amp; recurring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage every Glow membership and its recurring clean schedule in one place. Each cycle auto-creates a
            confirmed booking, assigns the previous/preferred cleaner, and syncs GHL · Airtable · Calendar.
          </p>
        </div>
        <Button onClick={() => { setPrefill(null); setShowCreate((v) => !v); }}>
          {showCreate ? <><RiCloseLine className="w-4 h-4 mr-1.5" /> Close</> : <><RiAddLine className="w-4 h-4 mr-1.5" /> New schedule</>}
        </Button>
      </div>

      {showCreate && (
        <CreateForm
          cleaners={cleaners}
          prefill={prefill}
          onCreated={() => { setShowCreate(false); setPrefill(null); load(); }}
        />
      )}

      {membersNeedingSchedule.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="py-3 flex flex-wrap items-center gap-2 text-sm text-amber-900">
            <RiCalendarScheduleLine className="w-4 h-4 shrink-0" />
            <span className="font-semibold">{membersNeedingSchedule.length} active member{membersNeedingSchedule.length > 1 ? "s" : ""} without a recurring schedule</span>
            <span className="text-amber-800/70">— their cleans won't auto-book until a schedule is set up.</span>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="members" className="w-full">
        <TabsList>
          <TabsTrigger value="members" className="gap-1.5">
            <RiUserHeartLine className="w-4 h-4" /> Members ({members.length})
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <RiRepeatLine className="w-4 h-4" /> Recurring schedules ({schedules.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── Members ─────────────────────────────────────────────────── */}
        <TabsContent value="members" className="mt-4 space-y-2">
          {membersError && (
            <Card className="border-rose-200 bg-rose-50/50">
              <CardContent className="py-3 text-sm text-rose-800">
                Couldn't load members: {membersError}
              </CardContent>
            </Card>
          )}
          {!membersError && members.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No memberships yet.</CardContent></Card>
          )}
          {members.map((m) => {
            const name = `${m.customer?.first_name || ""} ${m.customer?.last_name || ""}`.trim() || m.email;
            const hasActiveSchedule = m.schedules.some((s) => s.active);
            return (
              <Card key={m.id} className={cn("border", m.period_active ? "border-slate-200" : "border-slate-200 bg-slate-50/60")}>
                <CardContent className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900">
                        {name}
                        <span className="text-slate-400 font-normal"> · {m.email}</span>
                        {m.customer?.phone ? <span className="text-slate-400 font-normal"> · {m.customer.phone}</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {PLAN_LABELS[m.membership_plan] || m.membership_plan}
                        {" · "}{m.credits_remaining}/{m.credits_per_month} credit{m.credits_per_month === 1 ? "" : "s"} left this period
                        {" · "}renews {m.current_period_end ? format(new Date(m.current_period_end), "MMM d") : "—"}
                        {m.last_booking?.service_date ? ` · last clean ${format(new Date(`${m.last_booking.service_date}T12:00:00`), "MMM d")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={cn("text-[11px]", m.period_active ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600")}>
                        {m.period_active ? "Active member" : "Period ended"}
                      </Badge>
                      {hasActiveSchedule ? (
                        <Badge className="text-[11px] bg-emerald-100 text-emerald-700">Schedule set</Badge>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-800"
                          onClick={() => startScheduleForMember(m)}>
                          <RiCalendarScheduleLine className="w-3.5 h-3.5 mr-1" /> Set up schedule
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === m.id}
                        title="Pause Stripe billing"
                        onClick={() => memberAction(m, "pause")}>
                        <RiPauseLine className="w-3.5 h-3.5 mr-1" /> Pause
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === m.id}
                        title="Resume Stripe billing"
                        onClick={() => memberAction(m, "resume")}>
                        <RiPlayLine className="w-3.5 h-3.5 mr-1" /> Resume
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs border-rose-200 text-rose-700" disabled={working === m.id}
                        title="Cancel at period end"
                        onClick={() => memberAction(m, "cancel")}>
                        {working === m.id ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiStopCircleLine className="w-3.5 h-3.5 mr-1" /> Cancel</>}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ─── Schedules ───────────────────────────────────────────────── */}
        <TabsContent value="schedules" className="mt-4 space-y-6">
          {schedules.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No recurring schedules yet.</CardContent></Card>
          )}

          {active.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active ({active.length})</p>
              {active.map((s) => (
                <ScheduleRow key={s.id} s={s} cleaners={cleaners} cleanerName={cleanerName} working={working}
                  onPatch={patch} onGenerate={generateNow} timeSlots={TIME_SLOTS} />
              ))}
            </div>
          )}

          {paused.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paused ({paused.length})</p>
              {paused.map((s) => (
                <ScheduleRow key={s.id} s={s} cleaners={cleaners} cleanerName={cleanerName} working={working}
                  onPatch={patch} onGenerate={generateNow} timeSlots={TIME_SLOTS} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScheduleRow({
  s, cleaners, cleanerName, working, onPatch, onGenerate, timeSlots,
}: {
  s: Schedule; cleaners: Cleaner[]; cleanerName: (id: string | null) => string; working: string | null;
  onPatch: (id: string, f: Record<string, unknown>) => void; onGenerate: (id: string) => void; timeSlots: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn("border", s.active ? "border-slate-200" : "border-slate-200 bg-slate-50/60")}>
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-900">
              {`${s.first_name || ""} ${s.last_name || ""}`.trim() || s.email}
              <span className="text-slate-400 font-normal"> · {s.email}</span>
            </p>
            <p className="text-xs text-slate-500">
              {s.cadence} · next {s.next_service_date ? format(new Date(`${s.next_service_date}T12:00:00`), "EEE, MMM d") : "—"}
              {s.preferred_time_slot ? ` · ${s.preferred_time_slot}` : ""} · {cleanerName(s.preferred_cleaner_id)} · {fmtMoney(s.price_cents)}/clean
              {s.uses_credit ? " · membership credit" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(s.membership_plan || s.uses_credit) && (
              <Badge className="text-[11px] bg-violet-100 text-violet-700">
                {s.membership_plan ? `${s.membership_plan} member` : "member credit"}
              </Badge>
            )}
            <Badge className={cn("text-[11px]", s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
              {s.active ? "Active" : "Paused"}
            </Badge>
            <Button size="sm" variant="outline" disabled={working === s.id} onClick={() => onGenerate(s.id)} title="Generate the next clean now">
              {working === s.id ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiFlashlightLine className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant={s.active ? "outline" : "default"} onClick={() => onPatch(s.id, { active: !s.active })}>
              {s.active ? <RiPauseLine className="w-4 h-4" /> : <RiPlayLine className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Edit"}</Button>
          </div>
        </div>

        {open && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 border-t pt-3">
            <div>
              <Label className="text-xs">Cadence</Label>
              <Select value={s.cadence} onValueChange={(v) => onPatch(s.id, { cadence: v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Preferred cleaner</Label>
              <Select value={s.preferred_cleaner_id || "auto"} onValueChange={(v) => onPatch(s.id, { preferred_cleaner_id: v === "auto" ? null : v })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (previous cleaner)</SelectItem>
                  {cleaners.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{`${c.first_name || ""} ${c.last_name || ""}`.trim()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Time window</Label>
              <Select value={s.preferred_time_slot || ""} onValueChange={(v) => onPatch(s.id, { preferred_time_slot: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Pick" /></SelectTrigger>
                <SelectContent>
                  {timeSlots.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Next service date</Label>
              <Input type="date" className="h-9" defaultValue={s.next_service_date || ""}
                onBlur={(e) => e.target.value && e.target.value !== s.next_service_date && onPatch(s.id, { next_service_date: e.target.value })} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateForm({ cleaners, prefill, onCreated }: { cleaners: Cleaner[]; prefill: Partial<Schedule> | null; onCreated: () => void }) {
  const [f, setF] = useState({
    email: prefill?.email || "", first_name: prefill?.first_name || "", last_name: prefill?.last_name || "", phone: prefill?.phone || "",
    address: prefill?.address || "", city: prefill?.city || "", state: prefill?.state || "", zip_code: prefill?.zip_code || "",
    home_size_id: "1000_1500", service_type: "standard", preferred_time_slot: "9:00 AM - 10:00 AM",
    cadence: prefill?.cadence || "biweekly", preferred_cleaner_id: "auto", next_service_date: "",
    uses_credit: prefill?.uses_credit ?? false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const priceCents = useMemo(
    () => Math.round((calculatePrice(f.home_size_id, f.service_type, [], "none", f.uses_credit, "B").total || 0) * 100),
    [f.home_size_id, f.service_type, f.uses_credit],
  );

  const create = async () => {
    if (!f.email || !f.next_service_date) { toast.error("Email and first service date are required."); return; }
    setSaving(true);
    try {
      const { error } = await (supabase.from as any)("customer_recurring_schedules").insert({
        email: f.email.trim().toLowerCase(), first_name: f.first_name || null, last_name: f.last_name || null, phone: f.phone || null,
        address: f.address || null, city: f.city || null, state: f.state || null, zip_code: f.zip_code || null,
        home_size_id: f.home_size_id, service_type: f.service_type, preferred_time_slot: f.preferred_time_slot,
        cadence: f.cadence, preferred_cleaner_id: f.preferred_cleaner_id === "auto" ? null : f.preferred_cleaner_id,
        price_cents: priceCents, uses_credit: f.uses_credit, next_service_date: f.next_service_date, active: true,
        membership_plan: prefill?.membership_plan || null,
      });
      if (error) throw error;
      toast.success("Recurring schedule created.");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          New recurring schedule{prefill?.email ? ` — ${prefill.email}` : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <Input placeholder="Email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          <Input placeholder="First name" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} />
          <Input placeholder="Last name" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
          <Input placeholder="Phone" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <Input placeholder="Address" value={f.address} onChange={(e) => set("address", e.target.value)} />
          <Input placeholder="City" value={f.city} onChange={(e) => set("city", e.target.value)} />
          <Input placeholder="State" value={f.state} onChange={(e) => set("state", e.target.value)} />
          <Input placeholder="ZIP" value={f.zip_code} onChange={(e) => set("zip_code", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <div>
            <Label className="text-xs">Home size</Label>
            <Select value={f.home_size_id} onValueChange={(v) => set("home_size_id", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{HOME_SIZE_RANGES.map((h) => <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Service</Label>
            <Select value={f.service_type} onValueChange={(v) => set("service_type", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(SERVICE_TIER_PRICING).map(([id, v]) => <SelectItem key={id} value={id}>{v.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cadence</Label>
            <Select value={f.cadence} onValueChange={(v) => set("cadence", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Bi-weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Time window</Label>
            <Select value={f.preferred_time_slot} onValueChange={(v) => set("preferred_time_slot", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{TIME_SLOTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-xs">Preferred cleaner</Label>
            <Select value={f.preferred_cleaner_id} onValueChange={(v) => set("preferred_cleaner_id", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (previous cleaner)</SelectItem>
                {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{`${c.first_name || ""} ${c.last_name || ""}`.trim()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">First service date</Label>
            <Input type="date" className="h-9" value={f.next_service_date} onChange={(e) => set("next_service_date", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" checked={f.uses_credit} onChange={(e) => set("uses_credit", e.target.checked)} />
            Membership credit
          </label>
          <div className="text-sm">
            <span className="text-slate-500">Est. {fmtMoney(priceCents)}/clean</span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={create} disabled={saving}>{saving ? "Creating…" : "Create schedule"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
