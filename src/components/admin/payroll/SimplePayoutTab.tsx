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
  RiBankCardLine,
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

const usd = (cents: number) =>
  ((Number(cents) || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [s, j] = await Promise.all([
        callApi<Summary>("summary"),
        callApi<{ jobs: JobOption[] }>("jobs"),
      ]);
      setSummary(s);
      setJobs(j.jobs || []);
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
      const res = await callApi<{ payout: { emailSent: number; smsSent: number; airtableSynced: boolean; cleanerCount: number } }>(
        "submit",
        {
          bookingId: selected.bookingId,
          cleaners,
          note: note.trim() || undefined,
        },
      );
      const { emailSent, smsSent, airtableSynced, cleanerCount } = res.payout;
      toast.success(
        `Payout logged for ${cleanerCount} cleaner(s). ${emailSent ? `${emailSent} email(s).` : ""} ${smsSent ? `${smsSent} SMS.` : ""}${airtableSynced ? " Synced to Airtable." : ""}`.trim(),
      );
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

  const payViaStripe = async (p: RecentRow) => {
    if (
      !confirm(
        `Send ${usd(p.amountCents)} to ${p.cleanerName || "this cleaner"} via Stripe now?\n\nThis transfers the exact amount to their Connect account.`,
      )
    ) {
      return;
    }
    setPayingId(p.id);
    try {
      const res = await callApi<{ ok?: boolean; sentCount?: number }>("mark_paid", { id: p.id });
      toast.success(`Paid ${usd(p.amountCents)} to ${p.cleanerName || "cleaner"} via Stripe.`);
      void res;
      await load({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payout failed");
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
            Pick a job, type a payout, and we notify the contractor + sync to Airtable. Profit and % paid out are calculated for you.
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
            <CardTitle className="text-base">Log a payout</CardTitle>
            <CardDescription className="text-xs">Connected to live job data. Type any custom amount.</CardDescription>
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

                {/* Crew + pay per cleaner */}
                <div>
                  <Label className="text-xs">Who was on this job &amp; pay per cleaner</Label>
                  {selected.crew.length === 0 ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1">
                      No cleaner is assigned to this job. Assign one in Bookings first.
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
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between px-1 pt-1">
                        <span className="text-xs text-slate-500">Total payout</span>
                        <span className="text-sm font-bold tabular-nums">{usd(totalCents)}</span>
                      </div>
                    </div>
                  )}
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
                    <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                  ) : (
                    <><RiSendPlaneLine className="w-4 h-4 mr-2" /> Submit payout & notify {selectedCrew.length || ""} contractor{selectedCrew.length === 1 ? "" : "s"}</>
                  )}
                </Button>
                <p className="text-[11px] text-slate-400 text-center">
                  Emails + texts each selected cleaner that their payout is pending for their amount, and syncs to Airtable.
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
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                            disabled={payingId === p.id}
                            onClick={() => payViaStripe(p)}
                          >
                            {payingId === p.id ? (
                              <RiLoader4Line className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <><RiBankCardLine className="w-3.5 h-3.5 mr-1" /> Pay via Stripe</>
                            )}
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
