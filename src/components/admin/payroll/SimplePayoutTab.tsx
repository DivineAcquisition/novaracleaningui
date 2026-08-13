"use client";

// ─── Simplified Payroll: Custom Payout ─────────────────────────────────────
//
// A streamlined payout workflow:
//   • A dashboard roster showing payout totals for the week / month / year
//     (per cleaner + org-wide) plus our profit.
//   • A form tied to real job data: pick a completed job, type a custom payout
//     amount, see live profit + % paid out, and submit.
//   • On submit we record the payout, notify the contractor (email + SMS that
//     their payout is pending for that amount), and sync to Airtable.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiMoneyDollarCircleLine,
  RiLineChartLine,
  RiTimeLine,
  RiRefreshLine,
  RiSearchLine,
  RiSendPlaneLine,
  RiLoader4Line,
  RiCheckboxCircleLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { parseServiceDate } from "@/lib/service-date";

const usd = (cents: number) =>
  ((Number(cents) || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    // Called with bare service dates, which parse to UTC midnight and would
    // show the previous day.
    return (parseServiceDate(iso) as Date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

interface CrewMember {
  id: string;
  name: string;
  hasContact: boolean;
  suggestedPayoutCents: number;
  alreadyPaid: boolean;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
}

interface JobOption {
  bookingId: string;
  bookingNumber: string | null;
  status: string;
  serviceType: string | null;
  serviceDate: string | null;
  customer: string;
  revenueCents: number;
  cleanerCount: number;
  crew: CrewMember[];
  existingPayout: { amountCents: number; status: string; pctPaid: number } | null;
}

interface RosterRow {
  cleanerId: string | null;
  cleanerName: string;
  week: number;
  month: number;
  year: number;
  all: number;
  jobs: number;
}

interface RecentRow {
  id: string;
  bookingId: string | null;
  cleanerName: string | null;
  serviceDate: string | null;
  revenueCents: number;
  amountCents: number;
  profitCents: number;
  pctPaid: number;
  status: string;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface Summary {
  totals: { week: number; month: number; year: number; all: number };
  revenueTotals: { week: number; month: number; year: number; all: number };
  profitTotals: { week: number; month: number; year: number; all: number };
  pending: { count: number; cents: number };
  roster: RosterRow[];
  recent: RecentRow[];
}

async function callApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const res = await fetch("/api/payroll/custom", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export default function SimplePayoutTab() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<JobOption | null>(null);
  // Per-cleaner pay form: cleanerId → { selected, dollars }
  const [crewPay, setCrewPay] = useState<Record<string, { selected: boolean; dollars: string }>>({});
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [period, setPeriod] = useState<"week" | "month" | "year">("month");
  // Inline job-cost (revenue) adjust on the selected job.
  const [editingCost, setEditingCost] = useState(false);
  const [costDraft, setCostDraft] = useState("");
  const [savingCost, setSavingCost] = useState(false);
  // Crew management — assign/unassign right from payroll, using the SAME
  // canonical endpoints as Bookings/Dispatch so every page stays in sync.
  const [allCleaners, setAllCleaners] = useState<{ id: string; name: string }[]>([]);
  const [assignPick, setAssignPick] = useState("");
  const [crewWorking, setCrewWorking] = useState<string | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [s, j, c] = await Promise.all([
        callApi<Summary>("summary"),
        callApi<{ jobs: JobOption[] }>("jobs"),
        (supabase.from as any)("cleaners").select("id, first_name, last_name").eq("status", "active").order("first_name"),
      ]);
      setSummary(s);
      setJobs(j.jobs || []);
      setAllCleaners(
        ((c?.data as { id: string; first_name: string | null; last_name: string | null }[]) || []).map((x) => ({
          id: x.id,
          name: `${x.first_name || ""} ${x.last_name || ""}`.trim() || "Cleaner",
        })),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load payouts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-select the same job after an assign/unassign so the crew list reflects
  // the fresh server state (jobs payload carries the crew).
  const refreshSelected = useCallback(async (bookingId: string) => {
    try {
      const j = await callApi<{ jobs: JobOption[] }>("jobs");
      setJobs(j.jobs || []);
      const fresh = (j.jobs || []).find((x) => x.bookingId === bookingId) || null;
      setSelected(fresh);
      if (fresh) {
        const init: Record<string, { selected: boolean; dollars: string }> = {};
        for (const c of fresh.crew) {
          init[c.id] = { selected: true, dollars: ((c.suggestedPayoutCents || 0) / 100).toFixed(2) };
        }
        setCrewPay(init);
      }
    } catch { /* list refresh is best-effort */ }
  }, []);

  const assignCleaner = async () => {
    if (!selected || !assignPick) { toast.error("Pick a cleaner to assign."); return; }
    setCrewWorking("assign");
    try {
      const { data, error } = await supabase.functions.invoke("admin-booking-assign", {
        body: { bookingId: selected.bookingId, cleanerIds: [assignPick], mode: "add", notify: true },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      toast.success("Cleaner assigned — notified, and synced everywhere (Bookings, Dispatch, portals, GHL).");
      setAssignPick("");
      await refreshSelected(selected.bookingId);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Assign failed");
    } finally {
      setCrewWorking(null);
    }
  };

  const unassignCleaner = async (cleanerId: string, name: string) => {
    if (!selected) return;
    if (!confirm(`Unassign ${name} from this job? They drop off the job everywhere (dashboards, dispatch, payroll crew).`)) return;
    setCrewWorking(cleanerId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/admin/unassign-job", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ bookingId: selected.bookingId, cleanerId }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Unassign failed");
      toast.success(`${name} unassigned — reflected across Bookings, Dispatch, and portals.`);
      await refreshSelected(selected.bookingId);
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Unassign failed");
    } finally {
      setCrewWorking(null);
    }
  };

  const filteredJobs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? jobs.filter((j) =>
          [j.bookingNumber, j.customer, j.serviceType, j.serviceDate, ...j.crew.map((c) => c.name)]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle)),
        )
      : jobs;
    return list.slice(0, 40);
  }, [jobs, search]);

  const revenueCents = selected?.revenueCents || 0;
  const selectedCrew = useMemo(
    () => (selected?.crew || []).filter((c) => crewPay[c.id]?.selected),
    [selected, crewPay],
  );
  const totalCents = selectedCrew.reduce(
    (s, c) => s + Math.round((parseFloat(crewPay[c.id]?.dollars || "0") || 0) * 100),
    0,
  );
  const profitCents = revenueCents - totalCents;
  const pctPaid = revenueCents > 0 ? Math.round((totalCents / revenueCents) * 1000) / 10 : 0;

  const pickJob = (j: JobOption) => {
    setSelected(j);
    setEditingCost(false);
    setCostDraft(((j.revenueCents || 0) / 100).toFixed(2));
    const init: Record<string, { selected: boolean; dollars: string }> = {};
    for (const c of j.crew) {
      init[c.id] = { selected: true, dollars: ((c.suggestedPayoutCents || 0) / 100).toFixed(2) };
    }
    setCrewPay(init);
  };

  const saveJobCost = async () => {
    if (!selected) return;
    const newCents = Math.round((parseFloat(costDraft) || 0) * 100);
    if (!Number.isFinite(newCents) || newCents < 0) {
      toast.error("Enter a valid job cost");
      return;
    }
    setSavingCost(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/admin/adjust-job-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ bookingId: selected.bookingId, newJobCostCents: newCents }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Adjust failed");
      toast.success(`Job cost set to ${usd(newCents)} (GHL + Airtable synced)`);
      setSelected({ ...selected, revenueCents: newCents });
      setEditingCost(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to adjust job cost");
    } finally {
      setSavingCost(false);
    }
  };

  const setMemberPay = (id: string, dollars: string) =>
    setCrewPay((prev) => ({ ...prev, [id]: { ...(prev[id] || { selected: true }), dollars } }));
  const toggleMember = (id: string) =>
    setCrewPay((prev) => ({ ...prev, [id]: { ...(prev[id] || { dollars: "" }), selected: !prev[id]?.selected } }));

  const submit = async () => {
    if (!selected) {
      toast.error("Pick a job first.");
      return;
    }
    const cleaners = selectedCrew.map((c) => ({
      cleanerId: c.id,
      amountCents: Math.round((parseFloat(crewPay[c.id]?.dollars || "0") || 0) * 100),
    }));
    if (cleaners.length === 0) {
      toast.error("Select at least one cleaner to pay.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await callApi<{
        payout: {
          emailSent: number;
          airtableSynced: boolean;
          cleanerCount: number;
          status: string;
          stripe?: {
            halted?: boolean;
            error?: string | null;
            paidCount?: number;
            failedCount?: number;
            availableUsd?: number;
            neededCents?: number;
          };
        };
      }>(
        "submit",
        {
          bookingId: selected.bookingId,
          cleaners,
          note: note.trim() || undefined,
        },
      );
      const { emailSent, airtableSynced, cleanerCount, status, stripe } = res.payout;
      if (stripe?.halted || stripe?.error) {
        toast.error(stripe.error || "Stripe could not send this payout yet", {
          description: status === "pending"
            ? "Amount is confirmed. Pay it from Run Payroll once funds are available."
            : undefined,
        });
      } else if (status === "paid") {
        toast.success(
          `Paid ${cleanerCount} contractor(s) via Stripe Connect.${emailSent ? ` ${emailSent} email(s) sent.` : ""}${airtableSynced ? " Synced to Airtable." : ""}`.trim(),
        );
      } else {
        toast.success(
          `Confirmed for ${cleanerCount} contractor(s). ${stripe?.paidCount ? `${stripe.paidCount} sent.` : "Queued for Run Payroll."}${airtableSynced ? " Synced to Airtable." : ""}`.trim(),
        );
      }
      setSelected(null);
      setCrewPay({});
      setNote("");
      await load({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit payout");
    } finally {
      setSubmitting(false);
    }
  };

  const payPending = async (id: string) => {
    setPayingId(id);
    try {
      const res = await callApi<{
        ok: boolean; halted?: boolean; error?: string | null; paidCount: number;
      }>("execute_pending", { payoutId: id });
      if (res.halted || res.error) throw new Error(res.error || "Stripe could not send this payout");
      toast.success(`Paid via Stripe Connect (${res.paidCount} transfer${res.paidCount === 1 ? "" : "s"}).`);
      await load({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPayingId(null);
    }
  };

  const payoutTotal = summary?.totals[period] ?? 0;
  const profitTotal = summary?.profitTotals[period] ?? 0;
  const revenueTotal = summary?.revenueTotals[period] ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="font-jakarta text-xl font-bold text-slate-900 tracking-tight">Custom Payouts</h2>
          <p className="text-sm text-slate-500 mt-1">
            Confirm the payout for a job. If Stripe has available funds and the contractor is Connect-ready, we transfer immediately and email you + the contractor (CC contact@ and dispatch@).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load({ silent: true })} disabled={refreshing}>
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Dashboard */}
      <div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
          <TabsList>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="month">This Month</TabsTrigger>
            <TabsTrigger value="year">This Year</TabsTrigger>
          </TabsList>
          <TabsContent value={period} className="mt-4">
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi label={`Paid out (${period})`} value={usd(payoutTotal)} tone="violet" icon={RiMoneyDollarCircleLine} />
                <Kpi label={`Revenue (${period})`} value={usd(revenueTotal)} tone="sky" icon={RiLineChartLine} />
                <Kpi label={`Profit (${period})`} value={usd(profitTotal)} tone="emerald" icon={RiLineChartLine} hint={revenueTotal > 0 ? `${Math.round((profitTotal / revenueTotal) * 100)}% margin` : undefined} />
                <Kpi label="Pending payouts" value={usd(summary?.pending.cents ?? 0)} tone="amber" icon={RiTimeLine} hint={`${summary?.pending.count ?? 0} awaiting`} />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Payout form */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Confirm a payout</CardTitle>
            <CardDescription className="text-xs">Connected to live job data. Confirming sends a Stripe Connect transfer when funds are available.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selected ? (
              <>
                <div className="relative">
                  <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search jobs by #, customer, or cleaner…"
                    className="pl-10 h-9 bg-white border-slate-200"
                  />
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1.5">
                  {loading ? (
                    <>
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </>
                  ) : filteredJobs.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-6">No matching jobs.</p>
                  ) : (
                    filteredJobs.map((j) => (
                      <button
                        key={j.bookingId}
                        type="button"
                        onClick={() => pickJob(j)}
                        className="w-full text-left rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 px-3 py-2 transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {j.customer || "Customer"}
                            {j.bookingNumber ? <span className="text-slate-400 ml-1.5">{j.bookingNumber}</span> : null}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">{usd(j.revenueCents)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-500">
                            {fmtDate(j.serviceDate)} · {j.cleanerCount} cleaner{j.cleanerCount === 1 ? "" : "s"} · {j.status?.replaceAll("_", " ")}
                          </span>
                          {j.existingPayout && (
                            <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                              paid out {usd(j.existingPayout.amountCents)}
                            </Badge>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{selected.customer || "Customer"}</span>
                    <button className="text-xs text-violet-700 hover:underline" onClick={() => setSelected(null)}>
                      Change
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {selected.bookingNumber} · {fmtDate(selected.serviceDate)} · {selected.serviceType?.replaceAll("_", " ")}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs items-center">
                    <span className="text-slate-500">Revenue (job cost)</span>
                    {editingCost ? (
                      <div className="flex items-center justify-end gap-1">
                        <div className="relative w-24">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={costDraft}
                            onChange={(e) => setCostDraft(e.target.value)}
                            className="pl-5 h-7 text-xs"
                          />
                        </div>
                        <Button size="sm" className="h-7 px-2 text-xs bg-violet-600 hover:bg-violet-700 text-white" disabled={savingCost} onClick={saveJobCost}>
                          {savingCost ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Save"}
                        </Button>
                        <button className="text-[11px] text-slate-400 hover:text-slate-600" onClick={() => setEditingCost(false)}>Cancel</button>
                      </div>
                    ) : (
                      <span className="text-right tabular-nums font-semibold flex items-center justify-end gap-2">
                        {usd(selected.revenueCents)}
                        <button className="text-[11px] text-violet-700 hover:underline font-normal" onClick={() => { setCostDraft((selected.revenueCents / 100).toFixed(2)); setEditingCost(true); }}>
                          Adjust
                        </button>
                      </span>
                    )}
                    <span className="text-slate-500">Cleaners on job</span>
                    <span className="text-right font-semibold">{selected.cleanerCount}</span>
                  </div>
                </div>

                {/* Crew + pay per cleaner (with real assign/unassign controls) */}
                <div>
                  <Label className="text-xs">Who was on this job &amp; pay per cleaner</Label>
                  {selected.crew.length === 0 ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1">
                      No cleaner is assigned to this job — assign one below.
                    </p>
                  ) : (
                    <div className="mt-1 space-y-2">
                      {selected.crew.map((c) => {
                        const state = crewPay[c.id] || { selected: false, dollars: "" };
                        return (
                          <div
                            key={c.id}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                              state.selected ? "border-violet-200 bg-violet-50/40" : "border-slate-200 opacity-70",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={!!state.selected}
                              onChange={() => toggleMember(c.id)}
                              className="h-4 w-4 accent-violet-600"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{c.name}</p>
                              {!c.hasContact && (
                                <p className="text-[10px] text-amber-600">No email/phone — won't be notified</p>
                              )}
                              {c.payoutsEnabled && c.stripeAccountId ? (
                                <p className="text-[10px] text-emerald-700">Stripe Connect ready</p>
                              ) : (
                                <p className="text-[10px] text-rose-600">Needs Stripe Connect</p>
                              )}
                            </div>
                            <div className="relative w-28">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                disabled={!state.selected}
                                value={state.dollars}
                                onChange={(e) => setMemberPay(c.id, e.target.value)}
                                className="pl-6 h-9 text-sm font-semibold"
                                placeholder="0.00"
                              />
                            </div>
                            <button
                              type="button"
                              title={`Unassign ${c.name} from this job`}
                              onClick={() => unassignCleaner(c.id, c.name)}
                              disabled={crewWorking !== null}
                              className="text-slate-300 hover:text-rose-600 transition-colors shrink-0 p-1"
                            >
                              {crewWorking === c.id
                                ? <RiLoader4Line className="w-4 h-4 animate-spin" />
                                : <span className="text-base leading-none">✕</span>}
                            </button>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span className="text-xs text-slate-500">Total payout</span>
                        <span className="text-sm font-bold tabular-nums">{usd(totalCents)}</span>
                      </div>
                    </div>
                  )}

                  {/* Assign a cleaner — same canonical endpoint as Bookings/Dispatch */}
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={assignPick}
                      onChange={(e) => setAssignPick(e.target.value)}
                      className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm"
                    >
                      <option value="">Assign a cleaner to this job…</option>
                      {allCleaners
                        .filter((c) => !selected.crew.some((m) => m.id === c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0"
                      onClick={assignCleaner}
                      disabled={!assignPick || crewWorking !== null}
                    >
                      {crewWorking === "assign" ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : "Assign"}
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Assign/unassign here updates the booking, dispatch job, cleaner dashboards, GHL &amp; Airtable — the same as doing it from Bookings.
                  </p>
                </div>

                {/* Live calculations */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Our profit</p>
                    <p className={cn("text-lg font-bold", profitCents >= 0 ? "text-emerald-800" : "text-rose-700")}>
                      {usd(profitCents)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold">% paid out</p>
                    <p className="text-lg font-bold text-violet-800">{pctPaid}%</p>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Note (optional)</Label>
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bonus, deduction reason, etc." className="mt-1" />
                </div>

                <Button onClick={submit} disabled={submitting || selectedCrew.length === 0} className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                  {submitting ? (
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                  ) : (
                    <><RiSendPlaneLine className="w-4 h-4 mr-2" /> Confirm &amp; pay {selectedCrew.length || ""} contractor{selectedCrew.length === 1 ? "" : "s"} via Stripe</>
                  )}
                </Button>
                <p className="text-[11px] text-slate-400 text-center">
                  Transfers from Novara&apos;s Stripe balance to each contractor&apos;s Connect account. Emails you, the contractor, and CCs contact@novaracleaning.com + dispatch@novaracleaning.com.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roster */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Roster — payout by cleaner</CardTitle>
            <CardDescription className="text-xs">Week / month / year totals.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (summary?.roster.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No payouts logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cleaner</TableHead>
                      <TableHead className="text-right">Week</TableHead>
                      <TableHead className="text-right">Month</TableHead>
                      <TableHead className="text-right">Year</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary!.roster.map((r) => (
                      <TableRow key={r.cleanerId || r.cleanerName}>
                        <TableCell>
                          <span className="font-medium text-slate-900 text-sm">{r.cleanerName}</span>
                          <span className="text-[11px] text-slate-500 ml-1">({r.jobs})</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{usd(r.week)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{usd(r.month)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-semibold">{usd(r.year)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent payouts */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent payouts</CardTitle>
          <CardDescription className="text-xs">Latest custom payouts with profit + % paid out.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (summary?.recent.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">No payouts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cleaner</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Payout</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">% out</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary!.recent.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm font-medium">{p.cleanerName || "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500">{fmtDate(p.serviceDate || p.createdAt)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{usd(p.revenueCents)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-semibold">{usd(p.amountCents)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums text-sm", p.profitCents >= 0 ? "text-emerald-700" : "text-rose-700")}>
                        {usd(p.profitCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{p.pctPaid}%</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] capitalize",
                            p.status === "paid"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-amber-50 text-amber-700 border-amber-200",
                          )}
                        >
                          {p.status === "paid" ? <RiCheckboxCircleLine className="w-3 h-3 mr-0.5" /> : <RiTimeLine className="w-3 h-3 mr-0.5" />}
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {p.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={payingId === p.id} onClick={() => payPending(p.id)}>
                            {payingId === p.id ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Pay via Stripe"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  tone: "violet" | "emerald" | "sky" | "amber";
  icon: typeof RiMoneyDollarCircleLine;
  hint?: string;
}) {
  const tones: Record<string, { bg: string; text: string; icon: string }> = {
    violet: { bg: "border-violet-200 bg-violet-50", text: "text-violet-900", icon: "bg-violet-100 text-violet-700" },
    emerald: { bg: "border-emerald-200 bg-emerald-50", text: "text-emerald-900", icon: "bg-emerald-100 text-emerald-700" },
    sky: { bg: "border-sky-200 bg-sky-50", text: "text-sky-900", icon: "bg-sky-100 text-sky-700" },
    amber: { bg: "border-amber-200 bg-amber-50", text: "text-amber-900", icon: "bg-amber-100 text-amber-700" },
  };
  const t = tones[tone];
  return (
    <Card className={cn("border", t.bg)}>
      <CardContent className="p-4 flex items-start gap-3">
        <span className={cn("w-9 h-9 rounded-lg flex items-center justify-center", t.icon)}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[11px] font-semibold uppercase tracking-wider opacity-80", t.text)}>{label}</p>
          <p className={cn("text-lg font-bold mt-0.5", t.text)}>{value}</p>
          {hint && <p className={cn("text-[10px] mt-1 opacity-70", t.text)}>{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
