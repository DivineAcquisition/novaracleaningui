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
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  RiLoader4Line, RiRepeatLine, RiAddLine, RiPlayLine, RiPauseLine, RiFlashlightLine,
  RiVipCrownLine, RiUserHeartLine, RiStopCircleLine, RiCalendarScheduleLine, RiChat3Line,
  RiSearchLine, RiLinkM, RiMailLine, RiFileList3Line, RiMoneyDollarCircleLine,
  RiCloseCircleLine, RiDeleteBin6Line, RiPhoneLine, RiFileCopyLine,
  RiLineChartLine, RiAlertLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { AddressAutocomplete } from "@/components/admin/AddressAutocomplete";
import { MEMBERSHIP_PRICES } from "@/lib/pricing";
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
  created_at?: string | null;
  member_since?: string | null;
  lifetime_revenue_cents?: number | null;
  membership_revenue_cents?: number | null;
  completed_cleans?: number | null;
  membership_cleans?: number | null;
  first_service_date?: string | null;
  last_completed_date?: string | null;
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

function memberName(m: Member): string {
  return `${m.customer?.first_name || ""} ${m.customer?.last_name || ""}`.trim() || m.email;
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "MMM d");
}

/** Monthly recurring revenue projection for a member (cents). */
function projectedMonthlyCents(m: Member): number | null {
  if (m.subscription_id && m.monthly_price_cents != null && m.monthly_price_cents > 0) {
    return m.monthly_price_cents;
  }
  const planKey =
    m.membership_plan === "weekly" || m.membership_plan === "biweekly" || m.membership_plan === "monthly"
      ? m.membership_plan
      : null;
  if (planKey && m.home_size_id && MEMBERSHIP_PRICES[m.home_size_id]?.[planKey] != null) {
    return Math.round(MEMBERSHIP_PRICES[m.home_size_id][planKey] * 100);
  }
  const s = m.schedules.find((x) => x.active) || m.schedules[0];
  if (!s?.price_cents || s.price_cents <= 0) return null;
  if (s.cadence === "weekly") return Math.round((s.price_cents * 52) / 12);
  if (s.cadence === "monthly") return s.price_cents;
  return Math.round((s.price_cents * 26) / 12); // biweekly default
}

function projectedAnnualCents(m: Member): number | null {
  const mo = projectedMonthlyCents(m);
  return mo == null ? null : mo * 12;
}

/** Actual membership LTV from completed membership/recurring cleans. */
function memberLtvCents(m: Member): number {
  if (m.membership_revenue_cents != null && m.membership_revenue_cents > 0) {
    return m.membership_revenue_cents;
  }
  return m.lifetime_revenue_cents ?? 0;
}

function tenureLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  const months = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  if (months < 1) return "<1 mo";
  if (months < 12) return `${months} mo`;
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${yrs}y ${rem}mo` : `${yrs}y`;
}

function riskFlags(m: Member): string[] {
  const flags: string[] = [];
  if (!m.period_active) flags.push("Inactive");
  const hasActiveSchedule = m.schedules.some((s) => s.active);
  if (m.period_active && !hasActiveSchedule) flags.push("No schedule");
  const last =
    m.last_completed_date ||
    m.last_booking?.service_date ||
    null;
  if (last) {
    const days = (Date.now() - new Date(`${last.includes("T") ? last : `${last}T12:00:00`}`).getTime()) / 86_400_000;
    const cadence = (m.schedules.find((s) => s.active)?.cadence || m.membership_plan || "").toLowerCase();
    const expected = cadence === "weekly" ? 14 : cadence === "monthly" ? 45 : 28;
    if (Number.isFinite(days) && days > expected) flags.push("Overdue clean");
  } else if (m.period_active) {
    flags.push("No cleans yet");
  }
  if (
    m.subscription_id &&
    m.credits_remaining != null &&
    m.credits_remaining > 0 &&
    m.current_period_end
  ) {
    const daysLeft =
      (new Date(m.current_period_end).getTime() - Date.now()) / 86_400_000;
    if (daysLeft >= 0 && daysLeft < 7) flags.push("Unused credits");
  }
  return flags;
}

function avgCleanCents(m: Member): number | null {
  const cleans = m.membership_cleans || m.completed_cleans || 0;
  const rev = memberLtvCents(m);
  if (!cleans || !rev) return null;
  return Math.round(rev / cleans);
}

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

async function attachBookingRevenue(list: Member[]): Promise<Member[]> {
  const emails = Array.from(new Set(list.map((m) => m.email).filter(Boolean)));
  if (emails.length === 0) return list;

  type Agg = {
    lifetime_revenue_cents: number;
    membership_revenue_cents: number;
    completed_cleans: number;
    membership_cleans: number;
    first_service_date: string | null;
    last_completed_date: string | null;
  };
  const byEmail = new Map<string, Agg>();

  for (let i = 0; i < emails.length; i += 80) {
    const chunk = emails.slice(i, i + 80);
    const { data } = await (supabase.from as any)("bookings")
      .select("email, status, final_charge_cents, total_estimate_cents, membership_plan, uses_credit, service_date")
      .in("email", chunk)
      .eq("status", "completed")
      .limit(3000);
    for (const b of (data || []) as Array<Record<string, unknown>>) {
      const key = String(b.email || "").toLowerCase().trim();
      if (!key) continue;
      let agg = byEmail.get(key);
      if (!agg) {
        agg = {
          lifetime_revenue_cents: 0,
          membership_revenue_cents: 0,
          completed_cleans: 0,
          membership_cleans: 0,
          first_service_date: null,
          last_completed_date: null,
        };
        byEmail.set(key, agg);
      }
      const charged = Number(b.final_charge_cents ?? b.total_estimate_cents ?? 0) || 0;
      const plan = b.membership_plan == null ? "" : String(b.membership_plan);
      const isMembership = (plan !== "" && plan !== "none") || b.uses_credit === true;
      agg.lifetime_revenue_cents += charged;
      agg.completed_cleans += 1;
      if (isMembership) {
        agg.membership_revenue_cents += charged;
        agg.membership_cleans += 1;
      }
      const sd = b.service_date ? String(b.service_date) : null;
      if (sd) {
        if (!agg.last_completed_date || sd > agg.last_completed_date) agg.last_completed_date = sd;
        if (!agg.first_service_date || sd < agg.first_service_date) agg.first_service_date = sd;
      }
    }
  }

  return list.map((m) => {
    const agg = byEmail.get(m.email.toLowerCase());
    if (!agg) {
      return {
        ...m,
        lifetime_revenue_cents: m.lifetime_revenue_cents ?? 0,
        membership_revenue_cents: m.membership_revenue_cents ?? 0,
        completed_cleans: m.completed_cleans ?? 0,
        membership_cleans: m.membership_cleans ?? 0,
      };
    }
    return {
      ...m,
      lifetime_revenue_cents: agg.lifetime_revenue_cents,
      membership_revenue_cents: agg.membership_revenue_cents,
      completed_cleans: agg.completed_cleans,
      membership_cleans: agg.membership_cleans,
      first_service_date: agg.first_service_date || m.first_service_date || null,
      last_completed_date: agg.last_completed_date || m.last_completed_date || null,
      member_since: m.member_since || m.created_at || agg.first_service_date || null,
    };
  });
}

export default function AdminRecurringSchedules() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersNotice, setMembersNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

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

    let nextMembers: Member[] = [];
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
            member_since: (row as Schedule & { created_at?: string }).created_at || null,
          };
          byEmail.set(email, entry);
        }
        entry.schedules.push({
          id: row.id, cadence: row.cadence, active: row.active,
          next_service_date: row.next_service_date, manage_token: row.manage_token,
          price_cents: row.price_cents,
        });
        if (row.active) entry.period_active = true;
        const created = (row as Schedule & { created_at?: string }).created_at;
        if (created && (!entry.member_since || created < entry.member_since)) {
          entry.member_since = created;
        }
      }
      nextMembers = Array.from(byEmail.values());
      setMembersNotice(
        "Stripe billing data unavailable (admin-memberships function not reachable) — showing recurring clients from schedules. Billing controls need the function deployed.",
      );
    } else {
      nextMembers = (mData.members as Member[]).map((m) => ({
        ...m,
        sources: Array.isArray(m.sources) ? m.sources : ["stripe"],
        schedules: Array.isArray(m.schedules) ? m.schedules : [],
      }));
    }

    // Attach / refresh LTV from completed bookings (works even if API omitted it).
    nextMembers = await attachBookingRevenue(nextMembers);
    setMembers(nextMembers);
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

  const startScheduleForMember = (m: Member) => {
    // Recurring plan creation now lives in the Internal Booking flow (toggle →
    // Recurring). Deep-link there with the member prefilled.
    const params = new URLSearchParams({ type: "recurring" });
    if (m.email) params.set("email", m.email);
    if (m.customer?.first_name) params.set("first_name", m.customer.first_name);
    if (m.customer?.last_name) params.set("last_name", m.customer.last_name);
    if (m.customer?.phone) params.set("phone", m.customer.phone);
    const cad = PLAN_CADENCE[m.membership_plan];
    if (cad) params.set("cadence", cad);
    if (m.subscription_id) params.set("uses_credit", "1");
    router.push(`/admin/csr?${params.toString()}`);
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
  const selectedMember = useMemo(
    () => members.find((m) => m.id === selectedMemberId) || null,
    [members, selectedMemberId],
  );
  const selectedMemberSchedules = useMemo(() => {
    if (!selectedMember) return [] as Schedule[];
    const email = selectedMember.email.toLowerCase();
    return schedules.filter((s) => s.email.toLowerCase() === email);
  }, [schedules, selectedMember]);
  const membersNeedingSchedule = useMemo(
    () => members.filter((m) => m.period_active && !m.schedules.some((s) => s.active)),
    [members],
  );

  const portfolio = useMemo(() => {
    const active = members.filter((m) => m.period_active);
    let mrr = 0;
    let mrrCount = 0;
    let ltv = 0;
    let atRisk = 0;
    for (const m of active) {
      const proj = projectedMonthlyCents(m);
      if (proj != null) {
        mrr += proj;
        mrrCount += 1;
      }
      ltv += memberLtvCents(m);
      if (riskFlags(m).length > 0) atRisk += 1;
    }
    return {
      activeCount: active.length,
      mrrCents: mrr,
      arrCents: mrr * 12,
      arpuCents: mrrCount > 0 ? Math.round(mrr / mrrCount) : 0,
      ltvCents: ltv,
      atRisk,
    };
  }, [members]);

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
        <Button className="shrink-0" onClick={() => router.push("/admin/csr?type=recurring")}>
          <RiAddLine className="w-4 h-4 mr-1.5" /> New recurring plan
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3">
        <InsightStat
          label="Active MRR"
          value={fmtMoney(portfolio.mrrCents)}
          hint={`${portfolio.activeCount} active · ARPU ${fmtMoney(portfolio.arpuCents)}`}
        />
        <InsightStat
          label="Active ARR"
          value={fmtMoney(portfolio.arrCents)}
          hint="Projected annual from active plans"
        />
        <InsightStat
          label="Portfolio LTV"
          value={fmtMoney(portfolio.ltvCents)}
          hint="Completed membership cleans"
        />
        <InsightStat
          label="Active members"
          value={String(portfolio.activeCount)}
          hint={`${members.length} total in hub`}
        />
        <InsightStat
          label="At risk"
          value={String(portfolio.atRisk)}
          hint="No schedule, overdue, or unused credits"
          warn={portfolio.atRisk > 0}
        />
      </div>

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
        <TabsContent value="members" className="mt-4 space-y-3">
          {membersNotice && (
            <Card className="border-amber-200 bg-amber-50/50">
              <CardContent className="py-3 text-xs text-amber-900">{membersNotice}</CardContent>
            </Card>
          )}

          <Card className="border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Name</th>
                    <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Plan</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-right px-4 py-3 font-semibold hidden md:table-cell">LTV</th>
                    <th className="text-right px-4 py-3 font-semibold hidden lg:table-cell">Projected</th>
                    <th className="text-left px-4 py-3 font-semibold hidden xl:table-cell">Next clean</th>
                    <th className="w-10 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-slate-500">
                        {q ? "No members match your search." : "No recurring clients yet."}
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map((m) => {
                      const activeSchedule = m.schedules.find((s) => s.active);
                      const isStripe = !!m.subscription_id;
                      const ltv = memberLtvCents(m);
                      const projMo = projectedMonthlyCents(m);
                      const risks = riskFlags(m);
                      return (
                        <tr
                          key={m.id}
                          onClick={() => setSelectedMemberId(m.id)}
                          className="cursor-pointer hover:bg-slate-50"
                        >
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{memberName(m)}</p>
                            <p className="text-xs text-slate-500 truncate max-w-[220px]">{m.email}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-700 hidden sm:table-cell">
                            {PLAN_LABELS[m.membership_plan] || m.membership_plan}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge className={cn("text-[11px]", m.period_active ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600")}>
                                {m.period_active ? (isStripe ? "Active" : "Recurring") : "Inactive"}
                              </Badge>
                              {risks.slice(0, 1).map((r) => (
                                <Badge key={r} className="text-[11px] bg-amber-100 text-amber-800">{r}</Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-900 font-semibold tabular-nums hidden md:table-cell">
                            {fmtMoney(ltv)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 tabular-nums hidden lg:table-cell text-xs">
                            {projMo != null ? (
                              <span>
                                {fmtMoney(projMo)}
                                <span className="text-slate-400">/mo</span>
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600 hidden xl:table-cell">
                            {fmtShortDate(activeSchedule?.next_service_date)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button size="sm" variant="ghost" className="text-violet-700">
                              Open
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <MemberSheet
            member={selectedMember}
            schedules={selectedMemberSchedules}
            working={working}
            onClose={() => setSelectedMemberId(null)}
            onChange={load}
            onStartSchedule={startScheduleForMember}
            onTextManageLink={textManageLink}
            onCopyManageLink={copyManageLink}
            setWorking={setWorking}
          />
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

// ─── Member profile side sheet (mirrors Customers sheet pattern) ─────────

function MemberSheet({
  member,
  schedules,
  working,
  onClose,
  onChange,
  onStartSchedule,
  onTextManageLink,
  onCopyManageLink,
  setWorking,
}: {
  member: Member | null;
  schedules: Schedule[];
  working: string | null;
  onClose: () => void;
  onChange: () => void;
  onStartSchedule: (m: Member) => void;
  onTextManageLink: (scheduleId: string) => void;
  onCopyManageLink: (token: string | null | undefined) => void;
  setWorking: (v: string | null) => void;
}) {
  const [priceDollars, setPriceDollars] = useState("");

  useEffect(() => {
    if (!member) return;
    setPriceDollars(
      member.monthly_price_cents != null ? (member.monthly_price_cents / 100).toFixed(0) : "",
    );
  }, [member]);

  const copyText = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  if (!member) {
    return (
      <Sheet open={false} onOpenChange={() => onClose()}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-white" />
      </Sheet>
    );
  }

  const name = memberName(member);
  const activeSchedule = member.schedules.find((s) => s.active) || null;
  const isStripe = !!member.subscription_id;
  const schedulePrice = activeSchedule?.price_cents ?? member.schedules[0]?.price_cents;
  const busy = working === member.id;
  const planLabel = PLAN_LABELS[member.membership_plan] || member.membership_plan;
  const ltvCents = memberLtvCents(member);
  const projMo = projectedMonthlyCents(member);
  const projYr = projectedAnnualCents(member);
  const avgClean = avgCleanCents(member);
  const risks = riskFlags(member);
  const cleansDone = member.membership_cleans ?? member.completed_cleans ?? 0;

  const memberAction = async (action: "pause" | "resume") => {
    if (!member.subscription_id) {
      toast.error("No Stripe subscription on this client — billing controls don't apply.");
      return;
    }
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} the ${planLabel} membership for ${member.email}?`)) return;
    setWorking(member.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: { action, subscriptionId: member.subscription_id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(action === "pause" ? "Membership billing paused." : "Membership billing resumed.");
      onChange();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const cancelMember = async () => {
    if (!confirm(
      `Cancel ${name}'s ${planLabel} membership?\n\n` +
      `• Recurring cleans stop\n` +
      `• Customer is notified by email${member.customer?.phone ? " & SMS" : ""}\n` +
      `${member.subscription_id ? "• Stripe billing cancels at the end of the current period" : "• No Stripe subscription to bill"}`,
    )) return;
    setWorking(member.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: {
          action: "cancel",
          subscriptionId: member.subscription_id || undefined,
          email: member.email,
          phone: member.customer?.phone || undefined,
          name: name || undefined,
          plan: planLabel,
          scheduleIds: member.schedules.map((s) => s.id).filter((id) => !String(id).startsWith("local-")),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Membership cancelled — customer notified.");
      onChange();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const deleteMember = async () => {
    if (!confirm(
      `DELETE ${name}'s membership entirely?\n\n` +
      `• Removes their recurring schedule\n` +
      `${member.subscription_id ? "• Cancels Stripe billing immediately\n" : ""}` +
      `• NO customer notification is sent\n\n` +
      `This cannot be undone.`,
    )) return;
    setWorking(member.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: {
          action: "delete",
          subscriptionId: member.subscription_id || undefined,
          email: member.email,
          scheduleIds: member.schedules.map((s) => s.id).filter((id) => !String(id).startsWith("local-")),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success("Membership deleted.");
      onChange();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const adjustMemberPrice = async () => {
    if (!member.subscription_id) { toast.error("No Stripe subscription on this member."); return; }
    const cents = Math.round(parseFloat(priceDollars) * 100);
    if (!Number.isFinite(cents) || cents < 100) { toast.error("Enter a valid monthly price ($1+)."); return; }
    if (!confirm(`Set ${member.email}'s Glow monthly rate to $${(cents / 100).toFixed(2)}? This updates Stripe (with proration).`)) return;
    setWorking(`price-${member.id}`);
    try {
      const { data, error } = await supabase.functions.invoke("admin-memberships", {
        body: { action: "adjust_price", subscriptionId: member.subscription_id, monthlyPriceCents: cents },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      toast.success(`Monthly price updated to $${(cents / 100).toFixed(2)}`);
      onChange();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const sendMemberChecklist = async () => {
    setWorking(`cl-${member.id}`);
    try {
      const data = await sendCustomerChecklist({
        email: member.email,
        phone: member.customer?.phone,
        firstName: member.customer?.first_name,
        serviceType: "standard",
        sendEmail: true,
        sendSms: Boolean(member.customer?.phone),
      });
      toast.success(data.smsSent ? "Checklist emailed and texted" : "Checklist emailed");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setWorking(null);
    }
  };

  const sendMemberAgreement = async () => {
    setWorking(`ag-${member.id}`);
    try {
      const planKey =
        member.membership_plan === "weekly" || member.membership_plan === "biweekly" || member.membership_plan === "monthly"
          ? member.membership_plan
          : "biweekly";
      const rate =
        member.monthly_price_cents ??
        (member.home_size_id && MEMBERSHIP_PRICES[member.home_size_id]
          ? Math.round((MEMBERSHIP_PRICES[member.home_size_id][planKey] || 0) * 100)
          : undefined);
      await sendMembershipAgreement({
        email: member.email,
        name,
        phone: member.customer?.phone || undefined,
        plan: planLabel,
        membershipRateCents: rate,
        homeSizeId: member.home_size_id || undefined,
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

  return (
    <Sheet open={Boolean(member)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto bg-white">
        <SheetHeader className="pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              <SheetTitle className="text-lg text-slate-900 truncate">{name}</SheetTitle>
              <SheetDescription className="text-slate-500">
                {planLabel}
                {member.customer?.city || member.customer?.state
                  ? ` · ${[member.customer?.city, member.customer?.state].filter(Boolean).join(", ")}`
                  : ""}
              </SheetDescription>
            </div>
            <div className="flex flex-wrap gap-1 justify-end shrink-0">
              <Badge className={cn("text-[11px]", member.period_active ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600")}>
                {member.period_active ? (isStripe ? "Active member" : "Active recurring") : "Inactive"}
              </Badge>
              {isStripe
                ? <Badge className="text-[11px] bg-sky-100 text-sky-700">Stripe</Badge>
                : <Badge className="text-[11px] bg-slate-100 text-slate-500">No Stripe</Badge>}
            </div>
          </div>
        </SheetHeader>

        <div className="py-4 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <ContactRow
              icon={RiMailLine}
              value={member.email}
              href={`mailto:${member.email}`}
              onCopy={() => copyText("Email", member.email)}
            />
            <ContactRow
              icon={RiPhoneLine}
              value={member.customer?.phone || "—"}
              href={member.customer?.phone ? `tel:${member.customer.phone}` : undefined}
              onCopy={member.customer?.phone ? () => copyText("Phone", member.customer!.phone!) : undefined}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <FactCell label="Plan" value={planLabel} />
            {isStripe && (
              <FactCell
                label="Monthly"
                value={member.monthly_price_cents != null ? `${fmtMoney(member.monthly_price_cents)}/mo` : "—"}
              />
            )}
            <FactCell label="Per clean" value={fmtMoney(schedulePrice)} />
            {isStripe && member.credits_per_month != null && (
              <FactCell label="Credits" value={`${member.credits_remaining ?? 0}/${member.credits_per_month} left`} />
            )}
            {isStripe && member.current_period_end && (
              <FactCell label="Renews" value={fmtShortDate(member.current_period_end)} />
            )}
            <FactCell label="Next clean" value={fmtShortDate(activeSchedule?.next_service_date)} />
            <FactCell label="Last clean" value={fmtShortDate(member.last_completed_date || member.last_booking?.service_date)} />
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <RiLineChartLine className="w-3.5 h-3.5" /> Revenue &amp; insights
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <FactCell label="Membership LTV" value={fmtMoney(ltvCents)} />
              <FactCell
                label="Projected /mo"
                value={projMo != null ? `${fmtMoney(projMo)}/mo` : "—"}
              />
              <FactCell
                label="1yr projected"
                value={projYr != null ? fmtMoney(projYr) : "—"}
              />
              <FactCell label="Completed cleans" value={String(cleansDone)} />
              <FactCell
                label="Avg / clean"
                value={avgClean != null ? fmtMoney(avgClean) : "—"}
              />
              <FactCell label="Tenure" value={tenureLabel(member.member_since || member.created_at || member.first_service_date)} />
            </div>
            {(member.lifetime_revenue_cents || 0) > ltvCents && (
              <p className="text-[11px] text-slate-400">
                All-time booking revenue (incl. one-time): {fmtMoney(member.lifetime_revenue_cents)}
              </p>
            )}
            {risks.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <RiAlertLine className="w-3.5 h-3.5 text-amber-600" />
                {risks.map((r) => (
                  <Badge key={r} className="text-[11px] bg-amber-100 text-amber-800">{r}</Badge>
                ))}
              </div>
            )}
            {isStripe && member.credits_per_month != null && (
              <p className="text-[11px] text-slate-500">
                Credit use this period: {member.credits_used ?? 0}/{member.credits_per_month}
                {member.credits_remaining != null ? ` · ${member.credits_remaining} left` : ""}
              </p>
            )}
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedule</h3>
            {schedules.length === 0 && member.schedules.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3 space-y-2">
                <p className="text-sm text-amber-900">No recurring schedule set — cleans won&apos;t auto-book.</p>
                <Button size="sm" variant="outline" className="border-amber-300 text-amber-900" onClick={() => onStartSchedule(member)}>
                  <RiCalendarScheduleLine className="w-3.5 h-3.5 mr-1.5" /> Set up schedule
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {schedules.length > 0
                  ? schedules.map((s) => (
                      <div key={s.id} className="rounded-lg border border-slate-200 px-3 py-2.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 capitalize">{s.cadence}</p>
                            <p className="text-xs text-slate-500">
                              Next {fmtShortDate(s.next_service_date)}
                              {s.preferred_time_slot ? ` · ${s.preferred_time_slot}` : ""}
                              {s.price_cents != null ? ` · ${fmtMoney(s.price_cents)}/clean` : ""}
                            </p>
                            {(s.address || s.city) && (
                              <p className="text-xs text-slate-400 truncate">
                                {[s.address, s.city, s.state, s.zip_code].filter(Boolean).join(", ")}
                              </p>
                            )}
                          </div>
                          <Badge className={cn("text-[11px] shrink-0", s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
                            {s.active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={working === `sms-${s.id}`}
                            onClick={() => onTextManageLink(s.id)}>
                            {working === `sms-${s.id}`
                              ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                              : <><RiChat3Line className="w-3.5 h-3.5 mr-1" />Text manage link</>}
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onCopyManageLink(s.manage_token)}>
                            <RiLinkM className="w-3.5 h-3.5 mr-1" /> Copy link
                          </Button>
                        </div>
                      </div>
                    ))
                  : member.schedules.map((s) => (
                      <div key={s.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-900 capitalize">{s.cadence}</p>
                            <p className="text-xs text-slate-500">Next {fmtShortDate(s.next_service_date)}</p>
                          </div>
                          <Badge className={cn("text-[11px]", s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
                            {s.active ? "Active" : "Paused"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                {!activeSchedule && (
                  <Button size="sm" variant="outline" className="border-amber-300 text-amber-900" onClick={() => onStartSchedule(member)}>
                    <RiCalendarScheduleLine className="w-3.5 h-3.5 mr-1.5" /> Set up schedule
                  </Button>
                )}
              </div>
            )}
          </section>

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Communications</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={working === `cl-${member.id}`} onClick={() => void sendMemberChecklist()}>
                {working === `cl-${member.id}`
                  ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                  : <><RiFileList3Line className="w-3.5 h-3.5 mr-1.5" />Send checklist</>}
              </Button>
              <Button size="sm" variant="outline" className="border-violet-200 text-violet-800" disabled={working === `ag-${member.id}`}
                onClick={() => void sendMemberAgreement()}>
                {working === `ag-${member.id}`
                  ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                  : <><RiMailLine className="w-3.5 h-3.5 mr-1.5" />Send agreement</>}
              </Button>
            </div>
          </section>

          {isStripe && (
            <>
              <Separator />
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stripe billing</h3>
                <div className="flex flex-wrap items-end gap-2 rounded-lg bg-violet-50/70 border border-violet-100 px-3 py-3">
                  <div className="min-w-[140px] flex-1">
                    <Label className="text-[10px] uppercase tracking-wide text-violet-700">Monthly Glow price ($)</Label>
                    <Input
                      type="number"
                      min={1}
                      step="1"
                      className="h-9 bg-white mt-1"
                      value={priceDollars}
                      onChange={(e) => setPriceDollars(e.target.value)}
                      placeholder="e.g. 199"
                    />
                  </div>
                  <Button size="sm" className="h-9 bg-violet-600 hover:bg-violet-700 text-white" disabled={working === `price-${member.id}`}
                    onClick={() => void adjustMemberPrice()}>
                    {working === `price-${member.id}`
                      ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                      : <><RiMoneyDollarCircleLine className="w-3.5 h-3.5 mr-1.5" />Update price</>}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void memberAction("pause")}>
                    <RiPauseLine className="w-3.5 h-3.5 mr-1.5" /> Pause billing
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void memberAction("resume")}>
                    <RiPlayLine className="w-3.5 h-3.5 mr-1.5" /> Resume billing
                  </Button>
                </div>
              </section>
            </>
          )}

          <Separator />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Danger zone</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-800" disabled={busy} onClick={() => void cancelMember()}>
                {busy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : <><RiCloseCircleLine className="w-3.5 h-3.5 mr-1.5" />Cancel membership</>}
              </Button>
              <Button size="sm" variant="outline" className="border-rose-200 text-rose-700" disabled={busy} onClick={() => void deleteMember()}>
                <RiDeleteBin6Line className="w-3.5 h-3.5 mr-1.5" />Delete membership
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              Cancel notifies the customer. Delete removes the plan with no notification.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InsightStat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <Card className={cn("border-slate-200", warn && "border-amber-300 bg-amber-50/40")}>
      <CardContent className="p-3 sm:p-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
        <p className={cn("text-xl sm:text-2xl font-semibold tabular-nums mt-1", warn ? "text-amber-900" : "text-slate-900")}>
          {value}
        </p>
        {hint ? <p className="text-[11px] text-slate-500 mt-1 leading-snug">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function FactCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  value,
  href,
  onCopy,
}: {
  icon: typeof RiMailLine;
  value: string;
  href?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700 border border-slate-200 rounded-md px-3 py-2">
      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
      {href ? (
        <a className="truncate hover:text-violet-700 flex-1" href={href}>{value}</a>
      ) : (
        <span className="truncate flex-1">{value}</span>
      )}
      {onCopy ? (
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCopy}>
          <RiFileCopyLine className="w-3.5 h-3.5 text-slate-500" />
        </Button>
      ) : null}
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
