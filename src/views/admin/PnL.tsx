"use client";

// ─── /admin/pnl — P&L data capture + sheet sync ──────────────────────────────
//
// The in-app home for the three human-entered P&L data sets. Everything
// writes to Supabase (system of record) with canonical dropdown values; the
// daily pl-sheet-sync mirrors all four data sets (incl. the automated job
// log) into the branded Google Sheet.
//
//   • Expenses & Reimbursements — VA. Rule: log as "Promised" when committed
//     (shows as OWED, doesn't hit profit); flip to "Paid" when actually paid.
//   • Ad Spend — founder/manager manual entry.
//   • EOD Report — VA daily report (due 5:30 PM), mirrors the VA KPIs.

import { useCallback, useEffect, useState } from "react";
import {
  RiAdvertisementLine,
  RiCheckboxCircleFill,
  RiFileChartLine,
  RiLoader4Line,
  RiMoneyDollarCircleLine,
  RiRefreshLine,
  RiSunLine,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const EXPENSE_TYPES = ["Promised", "Reimbursement", "One-off Expense", "Other"];
const EXPENSE_STATUSES = ["Promised", "Approved", "Paid", "Denied"];
const PLATFORMS = ["Facebook", "LSA", "Google", "Instagram", "Other"];

const todayYmd = () => new Date().toISOString().slice(0, 10);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const STATUS_STYLE: Record<string, string> = {
  Promised: "bg-amber-100 text-amber-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Denied: "bg-rose-100 text-rose-700",
};

export default function PnL() {
  const [tab, setTab] = useState("expenses");
  const [syncing, setSyncing] = useState(false);

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("pl-sheet-sync", { body: {} });
      if (error) throw error;
      const d = data as { ok?: boolean; skipped?: string; error?: string; jobs?: number; expenses?: number; ad_spend?: number; eod?: number };
      if (d?.skipped) {
        toast.warning("Sheet not configured yet — set PL_SHEET_ID (the workbook id) to enable the mirror.");
      } else if (!d?.ok) {
        throw new Error(d?.error || "Sync failed");
      } else {
        toast.success(`Sheet mirrored: ${d.jobs} jobs · ${d.expenses} expenses · ${d.ad_spend} ad spend · ${d.eod} EOD.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-1 sm:px-4 py-2 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RiFileChartLine className="w-6 h-6 text-violet-600" /> P&amp;L Data
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Expenses, ad spend &amp; EOD reports — Supabase is the record; the branded Google Sheet
            mirrors daily at 9:30 UTC (jobs sync automatically).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void syncNow()} disabled={syncing}>
          {syncing ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiRefreshLine className="w-4 h-4 mr-1.5" />}
          Sync sheet now
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="expenses" className="gap-1.5">
            <RiMoneyDollarCircleLine className="w-4 h-4" /> Expenses &amp; Reimb
          </TabsTrigger>
          <TabsTrigger value="adspend" className="gap-1.5">
            <RiAdvertisementLine className="w-4 h-4" /> Ad Spend
          </TabsTrigger>
          <TabsTrigger value="eod" className="gap-1.5">
            <RiSunLine className="w-4 h-4" /> EOD Report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="expenses" className="mt-4">{tab === "expenses" && <ExpensesTab />}</TabsContent>
        <TabsContent value="adspend" className="mt-4">{tab === "adspend" && <AdSpendTab />}</TabsContent>
        <TabsContent value="eod" className="mt-4">{tab === "eod" && <EodTab />}</TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Expenses & Reimbursements ───────────────────────────────────────────────

interface ExpenseRow {
  id: string;
  date: string;
  type: string;
  who: string;
  description: string;
  amount_cents: number;
  status: string;
  paid_date: string | null;
}

function ExpensesTab() {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [f, setF] = useState({ date: todayYmd(), type: "Promised", who: "", description: "", amount: "", status: "Promised" });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("pl_expenses")
      .select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(100);
    setRows((data || []) as ExpenseRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const amount = Math.round(parseFloat(f.amount) * 100);
    if (!f.date || !f.who.trim() || !f.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Date, who, description, and a valid amount are required.");
      return;
    }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase.from as any)("pl_expenses").insert({
        date: f.date, type: f.type, who: f.who.trim(), description: f.description.trim(),
        amount_cents: amount, status: f.status,
        paid_date: f.status === "Paid" ? f.date : null,
        created_by: u.user?.id || null,
      });
      if (error) throw error;
      toast.success("Expense logged — mirrors to the sheet on the next sync.");
      setF({ date: todayYmd(), type: "Promised", who: "", description: "", amount: "", status: "Promised" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (row: ExpenseRow, status: string) => {
    setBusyId(row.id);
    try {
      const { error } = await (supabase.from as any)("pl_expenses").update({
        status,
        paid_date: status === "Paid" ? (row.paid_date || todayYmd()) : null,
      }).eq("id", row.id);
      if (error) throw error;
      toast.success(status === "Paid" ? "Marked Paid — now hits True Net." : `Status → ${status}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800">Log an expense / reimbursement</p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          VA rule: log as <strong>Promised</strong> when committed (shows as OWED, doesn't hit profit) —
          flip to <strong>Paid</strong> once actually paid (then it hits True Net).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Date *</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1" /></div>
          <div>
            <Label>Type *</Label>
            <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Amount ($) *</Label><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="mt-1" /></div>
          <div>
            <Label>Status *</Label>
            <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{EXPENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Who (Cleaner / VA / Vendor) *</Label><Input value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} placeholder="e.g. Issac Bell" className="mt-1" /></div>
          <div><Label>Description *</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. supplies reimbursement — mop heads" className="mt-1" /></div>
        </div>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />}
          Log expense
        </Button>
      </CardContent></Card>

      {loading ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-slate-400">{r.date}</span>
              <Badge variant="outline">{r.type}</Badge>
              <span className="font-medium text-slate-800">{r.who}</span>
              <span className="text-slate-500 truncate max-w-[240px]">{r.description}</span>
              <span className="ml-auto font-semibold">{money(r.amount_cents)}</span>
              <Select value={r.status} onValueChange={(v) => void setStatus(r, v)} disabled={busyId === r.id}>
                <SelectTrigger className={cn("h-7 w-[110px] text-xs border-0", STATUS_STYLE[r.status])}><SelectValue /></SelectTrigger>
                <SelectContent>{EXPENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          {rows.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-slate-500">No expenses logged yet.</CardContent></Card>}
        </div>
      )}
    </div>
  );
}

// ─── Ad Spend ────────────────────────────────────────────────────────────────

interface AdRow { id: string; date: string; platform: string; spend_cents: number; leads_calls: number | null; booked_jobs: number | null; campaign_notes: string | null }

function AdSpendTab() {
  const [rows, setRows] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({ date: todayYmd(), platform: "Facebook", spend: "", leads: "", booked: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("pl_ad_spend")
      .select("*").order("date", { ascending: false }).limit(100);
    setRows((data || []) as AdRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    const spend = Math.round(parseFloat(f.spend) * 100);
    if (!f.date || !Number.isFinite(spend) || spend <= 0) { toast.error("Date and a valid spend are required."); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await (supabase.from as any)("pl_ad_spend").insert({
        date: f.date, platform: f.platform, spend_cents: spend,
        leads_calls: f.leads ? parseInt(f.leads, 10) : null,
        booked_jobs: f.booked ? parseInt(f.booked, 10) : null,
        campaign_notes: f.notes.trim() || null,
        created_by: u.user?.id || null,
      });
      if (error) throw error;
      toast.success("Ad spend logged.");
      setF({ date: todayYmd(), platform: "Facebook", spend: "", leads: "", booked: "", notes: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800">Log ad spend (founder/manager)</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div><Label>Date *</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1" /></div>
          <div>
            <Label>Platform *</Label>
            <Select value={f.platform} onValueChange={(v) => setF({ ...f, platform: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Spend ($) *</Label><Input type="number" min={0} step="0.01" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} className="mt-1" /></div>
          <div><Label>Leads / calls</Label><Input type="number" min={0} value={f.leads} onChange={(e) => setF({ ...f, leads: e.target.value })} className="mt-1" /></div>
          <div><Label>Booked jobs</Label><Input type="number" min={0} value={f.booked} onChange={(e) => setF({ ...f, booked: e.target.value })} className="mt-1" /></div>
        </div>
        <div><Label>Campaign / notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. July deep-clean promo" className="mt-1" /></div>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />}
          Log spend
        </Button>
      </CardContent></Card>

      {loading ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-slate-400">{r.date}</span>
              <Badge variant="outline">{r.platform}</Badge>
              <span className="font-semibold">{money(r.spend_cents)}</span>
              {r.leads_calls != null && <span className="text-xs text-slate-500">{r.leads_calls} leads</span>}
              {r.booked_jobs != null && <span className="text-xs text-slate-500">{r.booked_jobs} booked</span>}
              {r.campaign_notes && <span className="text-xs text-slate-400 truncate max-w-[240px] ml-auto">{r.campaign_notes}</span>}
            </div>
          ))}
          {rows.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-slate-500">No ad spend logged yet.</CardContent></Card>}
        </div>
      )}
    </div>
  );
}

// ─── EOD Report ──────────────────────────────────────────────────────────────

interface EodRow {
  id: string; date: string; va_name: string; inbound_leads: number; bookings_closed: number;
  outbound_calls: number; apps_reviewed: number; phone_screens: number; complaints_issues: number;
  revenue_booked_cents: number; blockers_notes: string | null;
}

function EodTab() {
  const [rows, setRows] = useState<EodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    date: todayYmd(), va_name: "", inbound: "0", closed: "0", calls: "0",
    apps: "0", screens: "0", complaints: "0", revenue: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase.from as any)("pl_eod_reports")
      .select("*").order("date", { ascending: false }).limit(60);
    setRows((data || []) as EodRow[]);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!f.date || !f.va_name.trim()) { toast.error("Date and VA name are required."); return; }
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const n = (v: string) => Math.max(0, parseInt(v, 10) || 0);
      const payload = {
        date: f.date, va_name: f.va_name.trim(),
        inbound_leads: n(f.inbound), bookings_closed: n(f.closed), outbound_calls: n(f.calls),
        apps_reviewed: n(f.apps), phone_screens: n(f.screens), complaints_issues: n(f.complaints),
        revenue_booked_cents: Math.round((parseFloat(f.revenue) || 0) * 100),
        blockers_notes: f.notes.trim() || null,
        created_by: u.user?.id || null,
      };
      // One report per VA per day — resubmitting the same day updates it.
      const { error } = await (supabase.from as any)("pl_eod_reports")
        .upsert(payload, { onConflict: "date,va_name" });
      if (error && String(error.message).includes("no unique")) {
        const { error: insErr } = await (supabase.from as any)("pl_eod_reports").insert(payload);
        if (insErr) throw insErr;
      } else if (error) {
        throw error;
      }
      toast.success("EOD report submitted.");
      setF({ date: todayYmd(), va_name: f.va_name, inbound: "0", closed: "0", calls: "0", apps: "0", screens: "0", complaints: "0", revenue: "", notes: "" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800">End-of-day report <span className="text-xs font-normal text-slate-400">— due 5:30 PM daily · mirrors the VA KPIs (5-min response, close rate, 30 calls, 5 apps, 2 screens)</span></p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><Label>Date *</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1" /></div>
          <div><Label>VA name *</Label><Input value={f.va_name} onChange={(e) => setF({ ...f, va_name: e.target.value })} className="mt-1" /></div>
          <div><Label>Inbound leads handled</Label><Input type="number" min={0} value={f.inbound} onChange={(e) => setF({ ...f, inbound: e.target.value })} className="mt-1" /></div>
          <div><Label>Bookings closed</Label><Input type="number" min={0} value={f.closed} onChange={(e) => setF({ ...f, closed: e.target.value })} className="mt-1" /></div>
          <div><Label>Outbound calls</Label><Input type="number" min={0} value={f.calls} onChange={(e) => setF({ ...f, calls: e.target.value })} className="mt-1" /></div>
          <div><Label>Applications reviewed</Label><Input type="number" min={0} value={f.apps} onChange={(e) => setF({ ...f, apps: e.target.value })} className="mt-1" /></div>
          <div><Label>Phone screens</Label><Input type="number" min={0} value={f.screens} onChange={(e) => setF({ ...f, screens: e.target.value })} className="mt-1" /></div>
          <div><Label>Complaints / issues</Label><Input type="number" min={0} value={f.complaints} onChange={(e) => setF({ ...f, complaints: e.target.value })} className="mt-1" /></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Revenue booked ($)</Label><Input type="number" min={0} step="0.01" value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })} className="mt-1" /></div>
          <div><Label>Blockers / notes</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={1} className="mt-1" /></div>
        </div>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckboxCircleFill className="w-4 h-4 mr-1.5" />}
          Submit EOD report
        </Button>
      </CardContent></Card>

      {loading ? <Skeleton className="h-40 w-full" /> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{r.date}</span>
                <span className="font-semibold text-slate-800">{r.va_name}</span>
                <span className="ml-auto font-semibold">{money(r.revenue_booked_cents)} booked</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {r.inbound_leads} leads · {r.bookings_closed} closed · {r.outbound_calls} calls ·
                {" "}{r.apps_reviewed} apps · {r.phone_screens} screens · {r.complaints_issues} complaints
                {r.blockers_notes ? ` · ${r.blockers_notes}` : ""}
              </p>
            </div>
          ))}
          {rows.length === 0 && <Card><CardContent className="p-8 text-center text-sm text-slate-500">No EOD reports yet.</CardContent></Card>}
        </div>
      )}
    </div>
  );
}
