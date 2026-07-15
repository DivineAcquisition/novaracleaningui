"use client";

// ─── /admin/recurring — Memberships & recurring cleaning hub ──────────────
//
// The admin management hub for memberships and recurring cleans:
//
//   • Members — every recurring client, unioned from Stripe Glow
//     subscriptions AND recurring schedules AND plan-stamped bookings (so a
//     bi-weekly client without a Stripe subscription still shows). Pause /
//     resume / cancel Stripe billing, text the customer their self-service
//     manage link, or set up their schedule pre-filled.
//   • Schedules — the recurring engine: cadence (weekly / biweekly /
//     monthly), preferred time + cleaner, pause/resume, edit, "generate
//     now", text manage link, and a creation flow modeled on the internal
//     booking form (address, home size, service, add-ons, cadence-aware
//     date preview, price) that can generate + assign the first clean
//     immediately and text the customer their manage link.
//
// Degrades gracefully: if the admin-memberships edge function isn't
// deployed yet, the Members tab is built client-side from
// customer_recurring_schedules so the page never errors out.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiRepeatLine, RiAddLine, RiPlayLine, RiPauseLine, RiFlashlightLine, RiCloseLine,
  RiVipCrownLine, RiUserHeartLine, RiStopCircleLine, RiCalendarScheduleLine, RiChat3Line,
  RiSearchLine, RiLinkM, RiMailLine, RiFileList3Line, RiMoneyDollarCircleLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { calculatePrice, SERVICE_TIER_PRICING, HOME_SIZE_RANGES, ADD_ONS, MEMBERSHIP_PRICES, type AddOnId } from "@/lib/pricing";
import { sendCustomerChecklist, sendMembershipAgreement } from "@/lib/membership-admin";
import { cn } from "@/lib/utils";

// Supabase/Postgrest errors are plain objects (not Error instances) — String()
// on them renders "[object Object]". Always surface the real message.
const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  const m = (e as { message?: unknown })?.message;
  if (typeof m === "string" && m) return m;
  try { return JSON.stringify(e); } catch { return String(e); }
};

interface Schedule {
  id: string; email: string; first_name: string | null; last_name: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip_code: string | null;
  home_size_id: string | null; service_type: string; add_ons: string[] | null;
  cadence: string; preferred_time_slot: string | null; preferred_cleaner_id: string | null;
  price_cents: number | null; uses_credit: boolean; membership_plan: string | null;
  next_service_date: string | null; last_generated_date: string | null; active: boolean; notes: string | null;
  manage_token?: string | null;
}
interface Cleaner { id: string; first_name: string | null; last_name: string | null; }
interface Member {
  id: string;
  email: string;
  customer_id: string | null;
  subscription_id: string | null;
  membership_plan: string;
  credits_per_month: number | null;
  credits_remaining: number | null;
  credits_used: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  period_active: boolean;
  monthly_price_cents?: number | null;
  home_size_id?: string | null;
  sources: string[];
  customer: { first_name?: string | null; last_name?: string | null; phone?: string | null; city?: string | null; state?: string | null } | null;
  schedules: {
    id: string;
    cadence: string;
    active: boolean;
    next_service_date: string | null;
    manage_token?: string | null;
    price_cents?: number | null;
  }[];
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
  recurring: "Recurring client",
};
const PLAN_CADENCE: Record<string, string> = { weekly: "weekly", biweekly: "biweekly", monthly: "monthly" };

/** Cadence-aware upcoming dates from a start date. */
function previewDates(start: string, cadence: string, count = 4): string[] {
  if (!start) return [];
  const out: string[] = [];
  let d = new Date(`${start}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    const n = new Date(d);
    if (cadence === "weekly") n.setDate(n.getDate() + 7);
    else if (cadence === "monthly") n.setMonth(n.getMonth() + 1);
    else n.setDate(n.getDate() + 14);
    d = n;
  }
  return out;
}

export default function AdminRecurringSchedules() {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersNotice, setMembersNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [prefill, setPrefill] = useState<Partial<Schedule> | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMembersNotice(null);
    const [{ data: s, error: sErr }, { data: c }, membersRes] = await Promise.all([
      (supabase.from as any)("customer_recurring_schedules").select("*").order("created_at", { ascending: false }),
      (supabase.from as any)("cleaners").select("id, first_name, last_name").eq("status", "active").order("first_name"),
      supabase.functions.invoke("admin-memberships", { body: {} }).catch((e) => ({ data: null, error: e })),
    ]);
    if (sErr) toast.error(`Schedules: ${sErr.message}`);
    const schedRows = (s as Schedule[]) || [];
    setSchedules(schedRows);
    setCleaners((c as Cleaner[]) || []);

    const mData = (membersRes as any)?.data;
    if ((membersRes as any)?.error || mData?.error || !Array.isArray(mData?.members)) {
      // Edge function unavailable (not deployed yet / offline): build the
      // member list client-side from the schedules so the hub still works.
      const byEmail = new Map<string, Member>();
      for (const row of schedRows) {
        const email = String(row.email || "").toLowerCase();
        if (!email) continue;
        let entry = byEmail.get(email);
        if (!entry) {
          entry = {
            id: `local-${email}`,
            email,
            customer_id: null,
            subscription_id: null,
            membership_plan: row.membership_plan || row.cadence || "recurring",
            credits_per_month: null, credits_remaining: null, credits_used: null,
            current_period_start: null, current_period_end: null,
            period_active: row.active,
            sources: ["recurring"],
            customer: { first_name: row.first_name, last_name: row.last_name, phone: row.phone },
            schedules: [],
            last_booking: null,
          };
          byEmail.set(email, entry);
        }
        entry.schedules.push({
          id: row.id, cadence: row.cadence, active: row.active,
          next_service_date: row.next_service_date, manage_token: row.manage_token,
          price_cents: row.price_cents,
        });
        if (row.active) entry.period_active = true;
      }
      setMembers(Array.from(byEmail.values()));
      setMembersNotice(
        "Stripe billing data unavailable (admin-memberships function not reachable) — showing recurring clients from schedules. Billing controls need the function deployed.",
      );
    } else {
      setMembers((mData.members as Member[]).map((m) => ({
        ...m,
        sources: Array.isArray(m.sources) ? m.sources : ["stripe"],
        schedules: Array.isArray(m.schedules) ? m.schedules : [],
      })));
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
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const textManageLink = async (scheduleId: string) => {
    setWorking(`sms-${scheduleId}`);
    try {
      const { data, error } = await supabase.functions.invoke("send-recurring-manage-link", {
        body: { scheduleId, context: "manual" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Manage link texted to the customer.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const copyManageLink = (token: string | null | undefined) => {
    if (!token) { toast.error("No link minted yet — use 'Text link' once (it mints the token)."); return; }
    void navigator.clipboard.writeText(`https://app.novaracleaning.com/manage-recurring/${token}`);
    toast.success("Manage link copied.");
  };

  const memberAction = async (m: Member, action: "pause" | "resume" | "cancel") => {
    if (!m.subscription_id) { toast.error("No Stripe subscription on this client — billing controls don't apply."); return; }
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
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const adjustMemberPrice = async (m: Member, dollars: string) => {
    if (!m.subscription_id) { toast.error("No Stripe subscription on this member."); return; }
    const cents = Math.round(parseFloat(dollars) * 100);
    if (!Number.isFinite(cents) || cents < 100) { toast.error("Enter a valid monthly price ($1+)."); return; }
    if (!confirm(`Set ${m.email}'s Glow monthly rate to $${(cents / 100).toFixed(2)}? This updates Stripe (with proration).`)) return;
    setWorking(`price-${m.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: { action: "adjust_price", subscriptionId: m.subscription_id, monthlyPriceCents: cents },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Monthly price updated to $${(cents / 100).toFixed(2)}`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const sendMemberChecklist = async (m: Member) => {
    setWorking(`cl-${m.id}`);
    try {
      const data = await sendCustomerChecklist({
        email: m.email,
        phone: m.customer?.phone,
        firstName: m.customer?.first_name,
        serviceType: "standard",
        sendEmail: true,
        sendSms: Boolean(m.customer?.phone),
      });
      toast.success(data.smsSent ? "Checklist emailed and texted" : "Checklist emailed");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const sendMemberAgreement = async (m: Member) => {
    setWorking(`ag-${m.id}`);
    try {
      const name = `${m.customer?.first_name || ""} ${m.customer?.last_name || ""}`.trim() || undefined;
      const planKey =
        m.membership_plan === "weekly" || m.membership_plan === "biweekly" || m.membership_plan === "monthly"
          ? m.membership_plan
          : "biweekly";
      const rate =
        m.monthly_price_cents ??
        (m.home_size_id && MEMBERSHIP_PRICES[m.home_size_id]
          ? Math.round((MEMBERSHIP_PRICES[m.home_size_id][planKey] || 0) * 100)
          : undefined);
      await sendMembershipAgreement({
        email: m.email,
        name,
        phone: m.customer?.phone || undefined,
        plan: PLAN_LABELS[m.membership_plan] || m.membership_plan,
        membershipRateCents: rate,
        homeSizeId: m.home_size_id || undefined,
        holdPayment: false,
        sendEmail: true,
      });
      toast.success("Membership agreement emailed for e-sign");
    } catch (e) {
      toast.error(errMsg(e));
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
      uses_credit: !!m.subscription_id,
      membership_plan: PLAN_CADENCE[m.membership_plan] ? m.membership_plan : null,
    } as Partial<Schedule>);
    setShowCreate(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const q = search.trim().toLowerCase();
  const matchMember = (m: Member) => !q ||
    m.email.includes(q) ||
    `${m.customer?.first_name || ""} ${m.customer?.last_name || ""}`.toLowerCase().includes(q) ||
    String(m.customer?.phone || "").includes(q);
  const matchSchedule = (s: Schedule) => !q ||
    s.email.toLowerCase().includes(q) ||
    `${s.first_name || ""} ${s.last_name || ""}`.toLowerCase().includes(q) ||
    String(s.phone || "").includes(q);

  const filteredMembers = members.filter(matchMember);
  const filteredSchedules = schedules.filter(matchSchedule);
  const active = filteredSchedules.filter((s) => s.active);
  const paused = filteredSchedules.filter((s) => !s.active);
  const membersNeedingSchedule = useMemo(
    () => members.filter((m) => m.period_active && !m.schedules.some((s) => s.active)),
    [members],
  );

  if (loading) return <div className="flex justify-center py-20"><RiLoader4Line className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="max-w-6xl mx-auto px-2 sm:px-4 py-4 sm:py-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiVipCrownLine className="w-6 h-6 text-violet-700" /> Memberships &amp; recurring
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every recurring client and their schedule in one hub. Each cycle auto-creates a confirmed booking,
            assigns the previous/preferred cleaner, syncs GHL · Airtable · Calendar, and texts the customer their
            self-service manage link.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => { setPrefill(null); setShowCreate((v) => !v); }}>
          {showCreate ? <><RiCloseLine className="w-4 h-4 mr-1.5" /> Close</> : <><RiAddLine className="w-4 h-4 mr-1.5" /> New recurring plan</>}
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

      <div className="relative">
        <RiSearchLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search by name, email, or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="members" className="gap-1.5">
            <RiUserHeartLine className="w-4 h-4" /> Members ({filteredMembers.length})
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <RiRepeatLine className="w-4 h-4" /> Recurring schedules ({filteredSchedules.length})
          </TabsTrigger>
        </TabsList>

        {/* ─── Members ─────────────────────────────────────────────────── */}
        <TabsContent value="members" className="mt-4 space-y-2">
          {membersNotice && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="py-3 text-xs text-amber-900">{membersNotice}</CardContent>
            </Card>
          )}
          {filteredMembers.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              {q ? "No members match your search." : "No recurring clients yet."}
            </CardContent></Card>
          )}
          {filteredMembers.map((m) => {
            const name = `${m.customer?.first_name || ""} ${m.customer?.last_name || ""}`.trim() || m.email;
            const activeSchedule = m.schedules.find((s) => s.active);
            const isStripe = !!m.subscription_id;
            const schedulePrice = activeSchedule?.price_cents ?? m.schedules[0]?.price_cents;
            return (
              <Card key={m.id} className={cn("border", m.period_active ? "border-slate-200" : "border-slate-200 bg-slate-50/60")}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">
                        {name}
                        <span className="text-slate-400 font-normal"> · {m.email}</span>
                        {m.customer?.phone ? <span className="text-slate-400 font-normal hidden sm:inline"> · {m.customer.phone}</span> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {PLAN_LABELS[m.membership_plan] || m.membership_plan}
                        {isStripe && m.monthly_price_cents != null ? ` · ${fmtMoney(m.monthly_price_cents)}/mo` : ""}
                        {schedulePrice != null ? ` · ${fmtMoney(schedulePrice)}/clean` : ""}
                        {isStripe && m.credits_per_month != null
                          ? ` · ${m.credits_remaining ?? 0}/${m.credits_per_month} credit${m.credits_per_month === 1 ? "" : "s"} left · renews ${m.current_period_end ? format(new Date(m.current_period_end), "MMM d") : "—"}`
                          : activeSchedule
                            ? ` · ${activeSchedule.cadence} · next ${activeSchedule.next_service_date ? format(new Date(`${activeSchedule.next_service_date}T12:00:00`), "MMM d") : "—"}`
                            : ""}
                        {m.last_booking?.service_date ? ` · last clean ${format(new Date(`${m.last_booking.service_date}T12:00:00`), "MMM d")}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={cn("text-[11px]", m.period_active ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600")}>
                        {m.period_active ? (isStripe ? "Active member" : "Active recurring") : "Inactive"}
                      </Badge>
                      {!isStripe && <Badge className="text-[11px] bg-slate-100 text-slate-600">No Stripe sub</Badge>}
                      {activeSchedule ? (
                        <>
                          <Badge className="text-[11px] bg-emerald-100 text-emerald-700">Schedule set</Badge>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === `sms-${activeSchedule.id}`}
                            title="Text the customer their self-service manage link"
                            onClick={() => textManageLink(activeSchedule.id)}>
                            {working === `sms-${activeSchedule.id}` ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiChat3Line className="w-3.5 h-3.5 mr-1" /> Text link</>}
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-300 text-amber-800"
                          onClick={() => startScheduleForMember(m)}>
                          <RiCalendarScheduleLine className="w-3.5 h-3.5 mr-1" /> Set up schedule
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === `cl-${m.id}`}
                        title="Email/SMS customer checklist" onClick={() => void sendMemberChecklist(m)}>
                        {working === `cl-${m.id}` ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiFileList3Line className="w-3.5 h-3.5 mr-1" />Checklist</>}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs border-violet-200 text-violet-800" disabled={working === `ag-${m.id}`}
                        title="Email DocuSeal membership agreement" onClick={() => void sendMemberAgreement(m)}>
                        {working === `ag-${m.id}` ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiMailLine className="w-3.5 h-3.5 mr-1" />Agreement</>}
                      </Button>
                      {isStripe && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === m.id}
                            title="Pause Stripe billing" onClick={() => memberAction(m, "pause")}>
                            <RiPauseLine className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={working === m.id}
                            title="Resume Stripe billing" onClick={() => memberAction(m, "resume")}>
                            <RiPlayLine className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-rose-200 text-rose-700" disabled={working === m.id}
                            title="Cancel at period end" onClick={() => memberAction(m, "cancel")}>
                            {working === m.id ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <RiStopCircleLine className="w-3.5 h-3.5" />}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isStripe && (
                    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-violet-50/70 border border-violet-100 px-2.5 py-2">
                      <div className="min-w-[140px]">
                        <Label className="text-[10px] uppercase tracking-wide text-violet-700">Monthly Glow price ($)</Label>
                        <Input
                          type="number"
                          min={1}
                          step="1"
                          className="h-8 bg-white"
                          defaultValue={m.monthly_price_cents != null ? (m.monthly_price_cents / 100).toFixed(0) : ""}
                          id={`price-${m.id}`}
                          placeholder="e.g. 199"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="h-8 bg-violet-600 hover:bg-violet-700 text-white"
                        disabled={working === `price-${m.id}`}
                        onClick={() => {
                          const el = document.getElementById(`price-${m.id}`) as HTMLInputElement | null;
                          void adjustMemberPrice(m, el?.value || "");
                        }}
                      >
                        {working === `price-${m.id}`
                          ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                          : <><RiMoneyDollarCircleLine className="w-3.5 h-3.5 mr-1" />Update Stripe price</>}
                      </Button>
                      <span className="text-[11px] text-violet-700/80 self-center">
                        Adjusts the recurring Stripe subscription amount (prorated).
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ─── Schedules ───────────────────────────────────────────────── */}
        <TabsContent value="schedules" className="mt-4 space-y-6">
          {filteredSchedules.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
              {q ? "No schedules match your search." : "No recurring schedules yet."}
            </CardContent></Card>
          )}

          {active.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active ({active.length})</p>
              {active.map((s) => (
                <ScheduleRow key={s.id} s={s} cleaners={cleaners} cleanerName={cleanerName} working={working}
                  onPatch={patch} onGenerate={generateNow} onTextLink={textManageLink} onCopyLink={copyManageLink}
                  timeSlots={TIME_SLOTS} />
              ))}
            </div>
          )}

          {paused.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paused ({paused.length})</p>
              {paused.map((s) => (
                <ScheduleRow key={s.id} s={s} cleaners={cleaners} cleanerName={cleanerName} working={working}
                  onPatch={patch} onGenerate={generateNow} onTextLink={textManageLink} onCopyLink={copyManageLink}
                  timeSlots={TIME_SLOTS} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** One cadence step after the given date (used by "Skip next visit"). */
function nextCadenceDate(date: string, cadence: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function ScheduleRow({
  s, cleaners, cleanerName, working, onPatch, onGenerate, onTextLink, onCopyLink, timeSlots,
}: {
  s: Schedule; cleaners: Cleaner[]; cleanerName: (id: string | null) => string; working: string | null;
  onPatch: (id: string, f: Record<string, unknown>) => void; onGenerate: (id: string) => void;
  onTextLink: (id: string) => void; onCopyLink: (token: string | null | undefined) => void;
  timeSlots: string[];
}) {
  const [open, setOpen] = useState(false);
  const upcoming = s.active && s.next_service_date ? previewDates(s.next_service_date, s.cadence, 3) : [];

  const skipNext = () => {
    if (!s.next_service_date) { toast.error("No next service date set."); return; }
    const skipped = s.next_service_date;
    const next = nextCadenceDate(skipped, s.cadence);
    if (!confirm(`Skip the ${format(new Date(`${skipped}T12:00:00`), "EEE, MMM d")} visit? Next clean moves to ${format(new Date(`${next}T12:00:00`), "EEE, MMM d")}.`)) return;
    onPatch(s.id, {
      next_service_date: next,
      notes: `${s.notes ? s.notes + " · " : ""}Skipped ${skipped} (admin)`,
    });
    toast.success(`Skipped — next visit ${format(new Date(`${next}T12:00:00`), "MMM d")}.`);
  };

  const endPlan = () => {
    if (!confirm(`End this recurring plan for ${s.email}? This stops all future auto-booked cleans (already-created bookings are not touched). This is different from Pause — use Pause for a temporary hold.`)) return;
    onPatch(s.id, {
      active: false,
      next_service_date: null,
      notes: `${s.notes ? s.notes + " · " : ""}Plan ended by admin ${new Date().toISOString().slice(0, 10)}`,
    });
    toast.success("Recurring plan ended.");
  };
  return (
    <Card className={cn("border", s.active ? "border-slate-200" : "border-slate-200 bg-slate-50/60")}>
      <CardContent className="py-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-slate-900 truncate">
              {`${s.first_name || ""} ${s.last_name || ""}`.trim() || s.email}
              <span className="text-slate-400 font-normal"> · {s.email}</span>
            </p>
            <p className="text-xs text-slate-500">
              {s.cadence} · next {s.next_service_date ? format(new Date(`${s.next_service_date}T12:00:00`), "EEE, MMM d") : "—"}
              {s.preferred_time_slot ? ` · ${s.preferred_time_slot}` : ""} · {cleanerName(s.preferred_cleaner_id)} · {fmtMoney(s.price_cents)}/clean
              {s.uses_credit ? " · membership credit" : ""}
            </p>
            {upcoming.length > 1 && (
              <p className="text-[11px] text-slate-400">
                Then: {upcoming.slice(1).map((d) => format(new Date(`${d}T12:00:00`), "MMM d")).join(" → ")} …
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(s.membership_plan || s.uses_credit) && (
              <Badge className="text-[11px] bg-violet-100 text-violet-700">
                {s.membership_plan ? `${s.membership_plan} member` : "member credit"}
              </Badge>
            )}
            <Badge className={cn("text-[11px]", s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
              {s.active ? "Active" : "Paused"}
            </Badge>
            <Button size="sm" variant="outline" className="h-8" disabled={working === `sms-${s.id}`} onClick={() => onTextLink(s.id)}
              title="Text the customer their self-service manage link (change date/time, skip, pause)">
              {working === `sms-${s.id}` ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiChat3Line className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => onCopyLink(s.manage_token)} title="Copy manage link">
              <RiLinkM className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              title="Send cleaning checklist"
              disabled={working === `cl-sched-${s.id}`}
              onClick={async () => {
                try {
                  // reuse parent working via toast-only local path
                  await sendCustomerChecklist({
                    email: s.email,
                    phone: s.phone,
                    firstName: s.first_name,
                    serviceType: s.service_type || "standard",
                    sendEmail: true,
                    sendSms: Boolean(s.phone),
                  });
                  toast.success("Checklist sent");
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              <RiFileList3Line className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-violet-200 text-violet-800"
              title="Send membership agreement"
              onClick={async () => {
                try {
                  await sendMembershipAgreement({
                    email: s.email,
                    name: `${s.first_name || ""} ${s.last_name || ""}`.trim() || undefined,
                    phone: s.phone || undefined,
                    plan: PLAN_LABELS[s.membership_plan || s.cadence] || s.cadence,
                    serviceAddress: [s.address, s.city, s.state, s.zip_code].filter(Boolean).join(", ") || undefined,
                    firstServiceDate: s.next_service_date || undefined,
                    membershipRateCents: undefined,
                    oneTimeRateCents: s.price_cents || undefined,
                    homeSizeId: s.home_size_id || undefined,
                    scheduleId: s.id,
                    holdPayment: false,
                    sendEmail: true,
                  });
                  toast.success("Membership agreement emailed");
                } catch (e) {
                  toast.error(errMsg(e));
                }
              }}
            >
              <RiMailLine className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={working === s.id} onClick={() => onGenerate(s.id)} title="Generate the next clean now">
              {working === s.id ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiFlashlightLine className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant={s.active ? "outline" : "default"} className="h-8" onClick={() => onPatch(s.id, { active: !s.active })}>
              {s.active ? <RiPauseLine className="w-4 h-4" /> : <RiPlayLine className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Edit"}</Button>
          </div>
        </div>

        {open && (
          <div className="mt-3 space-y-3 border-t pt-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <Label className="text-xs">Price per clean ($)</Label>
                <Input type="number" min={0} step="1" className="h-9"
                  defaultValue={s.price_cents != null ? (s.price_cents / 100).toFixed(0) : ""}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v) && Math.round(v * 100) !== s.price_cents) onPatch(s.id, { price_cents: Math.round(v * 100) });
                  }} />
              </div>
              <div className="lg:col-span-3">
                <Label className="text-xs">Service address</Label>
                <AddressAutocomplete
                  label=""
                  placeholder={s.address ? `${s.address}, ${s.city || ""} ${s.state || ""}` : "Type the customer's address…"}
                  onAddressSelect={(a) => onPatch(s.id, { address: a.street, city: a.city, state: a.state, zip_code: a.zipCode })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Notes (visible to office only)</Label>
              <Textarea rows={2} defaultValue={s.notes || ""} placeholder="Gate code, preferences, billing notes…"
                onBlur={(e) => e.target.value !== (s.notes || "") && onPatch(s.id, { notes: e.target.value || null })} />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={skipNext} disabled={!s.next_service_date}>
                Skip next visit
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs border-rose-200 text-rose-700" onClick={endPlan}>
                <RiStopCircleLine className="w-3.5 h-3.5 mr-1" /> End plan
              </Button>
              <span className="text-[11px] text-slate-400">
                Pause = temporary hold (resume anytime) · End = stops the plan and clears the next date.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Create flow (modeled on the internal booking form, recurring-aware) ───
function CreateForm({ cleaners, prefill, onCreated }: { cleaners: Cleaner[]; prefill: Partial<Schedule> | null; onCreated: () => void }) {
  const [f, setF] = useState({
    email: prefill?.email || "", first_name: prefill?.first_name || "", last_name: prefill?.last_name || "", phone: prefill?.phone || "",
    address: prefill?.address || "", city: prefill?.city || "", state: prefill?.state || "MD", zip_code: prefill?.zip_code || "",
    home_size_id: "1000_1500", service_type: "standard", preferred_time_slot: "9:00 AM - 10:00 AM",
    cadence: prefill?.cadence || "biweekly", preferred_cleaner_id: "auto", next_service_date: "",
    uses_credit: prefill?.uses_credit ?? false,
  });
  const [addOns, setAddOns] = useState<string[]>([]);
  const [priceOverrideDollars, setPriceOverrideDollars] = useState("");
  const [generateNow, setGenerateNow] = useState(true);
  const [textLink, setTextLink] = useState(true);
  const [sendChecklist, setSendChecklist] = useState(true);
  const [sendAgreement, setSendAgreement] = useState(true);
  const [createGlowLink, setCreateGlowLink] = useState(false);
  const [monthlyOverrideDollars, setMonthlyOverrideDollars] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const pricing = useMemo(
    () => calculatePrice(f.home_size_id, f.service_type, addOns, "none", f.uses_credit, "B"),
    [f.home_size_id, f.service_type, addOns, f.uses_credit],
  );
  const catalogPriceCents = Math.round((pricing.total || 0) * 100);
  const overrideCleanCents = priceOverrideDollars.trim()
    ? Math.round(parseFloat(priceOverrideDollars) * 100)
    : null;
  const priceCents =
    overrideCleanCents != null && Number.isFinite(overrideCleanCents) && overrideCleanCents >= 0
      ? overrideCleanCents
      : catalogPriceCents;
  const catalogMonthlyCents = Math.round(
    (MEMBERSHIP_PRICES[f.home_size_id]?.[
      (f.cadence === "weekly" || f.cadence === "monthly" ? f.cadence : "biweekly") as "weekly" | "biweekly" | "monthly"
    ] || 0) * 100,
  );
  const monthlyOverrideCents = monthlyOverrideDollars.trim()
    ? Math.round(parseFloat(monthlyOverrideDollars) * 100)
    : null;
  const upcoming = useMemo(
    () => previewDates(f.next_service_date, f.cadence, 4),
    [f.next_service_date, f.cadence],
  );

  const toggleAddOn = (id: string) =>
    setAddOns((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const create = async () => {
    if (!f.email || !f.next_service_date) { toast.error("Email and first service date are required."); return; }
    if (textLink && !f.phone) { toast.error("Add a phone number to text the manage link (or untick it)."); return; }
    setSaving(true);
    try {
      const { data: created, error } = await (supabase.from as any)("customer_recurring_schedules").insert({
        email: f.email.trim().toLowerCase(), first_name: f.first_name || null, last_name: f.last_name || null, phone: f.phone || null,
        address: f.address || null, city: f.city || null, state: f.state || null, zip_code: f.zip_code || null,
        home_size_id: f.home_size_id, service_type: f.service_type, add_ons: addOns,
        preferred_time_slot: f.preferred_time_slot,
        cadence: f.cadence, preferred_cleaner_id: f.preferred_cleaner_id === "auto" ? null : f.preferred_cleaner_id,
        price_cents: priceCents, uses_credit: f.uses_credit, next_service_date: f.next_service_date, active: true,
        membership_plan: prefill?.membership_plan || (createGlowLink ? f.cadence : null),
        notes: overrideCleanCents != null ? `Admin price override $${(priceCents / 100).toFixed(2)}/clean` : null,
      }).select("id").single();
      if (error) throw error;
      const scheduleId = created?.id as string | undefined;
      toast.success("Recurring plan created.");

      if (scheduleId && generateNow) {
        try {
          const { data, error: genErr } = await supabase.functions.invoke("customer-recurring-generate", {
            body: { scheduleId, force: true },
          });
          if (genErr) throw genErr;
          if ((data as any)?.error) throw new Error((data as any).error);
          const r = (data as any)?.results?.[0];
          toast.success(r?.status === "created" ? "First clean booked & cleaner assigned." : `Generator: ${r?.status || "done"}`);
        } catch (e) {
          toast.warning(`Plan saved, but first-clean generation failed: ${errMsg(e)}`);
        }
      }

      if (sendChecklist) {
        try {
          await sendCustomerChecklist({
            email: f.email.trim().toLowerCase(),
            phone: f.phone || undefined,
            firstName: f.first_name || undefined,
            serviceType: f.service_type,
            sendEmail: true,
            sendSms: Boolean(f.phone),
          });
          toast.success("Checklist sent to customer");
        } catch (e) {
          toast.warning(`Checklist send failed: ${errMsg(e)}`);
        }
      }

      let paymentUrl: string | undefined;
      if (createGlowLink) {
        try {
          const membershipPlan = f.cadence === "weekly" || f.cadence === "monthly" ? f.cadence : "biweekly";
          const priceOverride: { total?: number } = {};
          if (monthlyOverrideCents != null && Number.isFinite(monthlyOverrideCents) && monthlyOverrideCents >= 100) {
            priceOverride.total = monthlyOverrideCents;
          }
          const { data, error: coErr } = await supabase.functions.invoke("create-checkout", {
            body: {
              mode: "subscription",
              membershipPlan,
              homeSizeId: f.home_size_id,
              email: f.email.trim().toLowerCase(),
              firstName: f.first_name || undefined,
              lastName: f.last_name || undefined,
              phone: f.phone || undefined,
              address: f.address || undefined,
              city: f.city || undefined,
              state: f.state || undefined,
              zipCode: f.zip_code || undefined,
              firstServiceDate: f.next_service_date,
              firstTimeSlot: f.preferred_time_slot,
              priceOverride: Object.keys(priceOverride).length ? priceOverride : undefined,
              notifyCustomer: false,
              sendChecklistEmail: false,
            },
          });
          if (coErr) throw coErr;
          if ((data as any)?.error) throw new Error((data as any).error);
          paymentUrl = (data as any)?.url;
          toast.success("Glow payment link created (held until agreement is signed)");
        } catch (e) {
          toast.warning(`Glow payment link failed: ${errMsg(e)}`);
        }
      }

      if (sendAgreement || (createGlowLink && paymentUrl)) {
        try {
          const membershipPlan = f.cadence === "weekly" || f.cadence === "monthly" ? f.cadence : "biweekly";
          await sendMembershipAgreement({
            email: f.email.trim().toLowerCase(),
            name: `${f.first_name} ${f.last_name}`.trim() || undefined,
            phone: f.phone || undefined,
            plan: PLAN_LABELS[membershipPlan] || membershipPlan,
            serviceAddress: [f.address, f.city, f.state, f.zip_code].filter(Boolean).join(", ") || undefined,
            firstServiceDate: f.next_service_date,
            membershipRateCents:
              monthlyOverrideCents != null && Number.isFinite(monthlyOverrideCents)
                ? monthlyOverrideCents
                : catalogMonthlyCents || undefined,
            oneTimeRateCents: priceCents,
            homeSizeId: f.home_size_id,
            scheduleId,
            paymentUrl,
            holdPayment: Boolean(paymentUrl),
            sendEmail: true,
          });
          toast.success(
            paymentUrl
              ? "Membership agreement emailed — pay link releases after they sign"
              : "Membership agreement emailed for e-sign",
          );
        } catch (e) {
          toast.warning(`Agreement send failed: ${errMsg(e)}`);
        }
      }

      if (scheduleId && textLink && f.phone) {
        try {
          const { data, error: smsErr } = await supabase.functions.invoke("send-recurring-manage-link", {
            body: { scheduleId, context: "created" },
          });
          if (smsErr) throw smsErr;
          if ((data as any)?.error) throw new Error((data as any).error);
          toast.success("Customer texted their manage link.");
        } catch (e) {
          toast.warning(`Plan saved, but the manage-link SMS failed: ${errMsg(e)}`);
        }
      }
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-violet-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          New recurring plan{prefill?.email ? ` — ${prefill.email}` : ""}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Price override, checklist, and membership agreement (agree → pay) — same controls as Internal Booking for Glow.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Input placeholder="Email *" value={f.email} onChange={(e) => set("email", e.target.value)} />
          <Input placeholder="First name" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} />
          <Input placeholder="Last name" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} />
          <Input placeholder="Phone (for SMS link)" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <AddressAutocomplete
          label="Service address"
          placeholder="Start typing the customer's address…"
          initialValue={f.address}
          onAddressSelect={(a) => setF((p) => ({ ...p, address: a.street, city: a.city, state: a.state || p.state, zip_code: a.zipCode }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input placeholder="City" value={f.city} onChange={(e) => set("city", e.target.value)} />
          <Input placeholder="State" value={f.state} onChange={(e) => set("state", e.target.value)} />
          <Input placeholder="ZIP" value={f.zip_code} onChange={(e) => set("zip_code", e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
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
                <SelectItem value="weekly">Weekly (every 7 days)</SelectItem>
                <SelectItem value="biweekly">Bi-weekly (every 14 days)</SelectItem>
                <SelectItem value="monthly">Monthly (same day each month)</SelectItem>
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

        <div>
          <Label className="text-xs">Add-ons each visit ({addOns.length} selected{pricing.addOnsTotal ? ` · +$${pricing.addOnsTotal}` : ""})</Label>
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-44 overflow-y-auto pr-1">
            {Object.entries(ADD_ONS).map(([id, a]) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleAddOn(id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all",
                  addOns.includes(id as AddOnId)
                    ? "border-violet-500 bg-violet-50 text-violet-900 ring-1 ring-violet-200"
                    : "border-slate-200 bg-white text-slate-700 hover:border-violet-300",
                )}
              >
                <span className="font-medium">{a.label}</span> · ${a.price}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
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
            <Label className="text-xs">First service date *</Label>
            <Input type="date" className="h-9" value={f.next_service_date} onChange={(e) => set("next_service_date", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Price / clean override ($)</Label>
            <Input
              type="number"
              min={0}
              step="1"
              className="h-9"
              placeholder={(catalogPriceCents / 100).toFixed(0)}
              value={priceOverrideDollars}
              onChange={(e) => setPriceOverrideDollars(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" checked={f.uses_credit} onChange={(e) => set("uses_credit", e.target.checked)} />
            Membership credit
          </label>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="font-semibold text-slate-900">{fmtMoney(priceCents)}/clean</span>
          <span className="text-xs text-slate-500 ml-2">
            catalog {fmtMoney(catalogPriceCents)}
            {overrideCleanCents != null ? " · override applied" : ""}
            {catalogMonthlyCents > 0 ? ` · Glow catalog ${fmtMoney(catalogMonthlyCents)}/mo` : ""}
          </span>
        </div>

        {upcoming.length > 0 && (
          <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-900">
            <span className="font-semibold">Schedule preview ({f.cadence}):</span>{" "}
            {upcoming.map((d) => format(new Date(`${d}T12:00:00`), "EEE MMM d")).join("  →  ")} …
          </div>
        )}

        <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">Confirmation &amp; membership controls</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={generateNow} onChange={(e) => setGenerateNow(e.target.checked)} />
              Book &amp; assign the first clean now
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={textLink} onChange={(e) => setTextLink(e.target.checked)} />
              Text customer their manage link
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sendChecklist} onChange={(e) => setSendChecklist(e.target.checked)} />
              Send cleaning checklist (email/SMS)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sendAgreement} onChange={(e) => setSendAgreement(e.target.checked)} />
              Send membership agreement (DocuSeal)
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={createGlowLink} onChange={(e) => setCreateGlowLink(e.target.checked)} />
              Create Glow payment link (held until they sign — agree then pay)
            </label>
          </div>
          {createGlowLink && (
            <div className="max-w-xs">
              <Label className="text-xs">Monthly Glow override ($)</Label>
              <Input
                type="number"
                min={1}
                step="1"
                className="h-9 bg-white"
                placeholder={(catalogMonthlyCents / 100).toFixed(0)}
                value={monthlyOverrideDollars}
                onChange={(e) => setMonthlyOverrideDollars(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button onClick={create} disabled={saving} className="shrink-0">
            {saving ? <><RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> Creating…</> : "Create recurring plan"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

