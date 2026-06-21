"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line, RiSendPlaneLine, RiRefreshLine, RiAlertLine, RiCheckboxCircleFill,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd, thisWeekMonday, formatPeriod, payPeriodMonday } from "@/lib/payroll";
import {
  type PayrollCleaner, type OperationalJob, cleanerName, loadOperationalJobs, payoutBooking,
} from "./shared";

interface CleanerRun {
  cleanerId: string;
  jobs: OperationalJob[];
  owedCents: number;
  paidCents: number;
  totalCents: number;
  payableBookingIds: string[];
}

export default function RunPayrollTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [period, setPeriod] = useState(thisWeekMonday());
  const [jobs, setJobs] = useState<OperationalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const cleanerById = useMemo(() => new Map(cleaners.map((c) => [c.id, c])), [cleaners]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await loadOperationalJobs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const periodOptions = useMemo(() => {
    const opts: string[] = [];
    let m = thisWeekMonday();
    for (let i = 0; i < 12; i++) {
      opts.push(m);
      const d = new Date(`${m}T12:00:00`); d.setDate(d.getDate() - 7);
      m = payPeriodMonday(d);
    }
    return opts;
  }, []);

  // Group this week's COMPLETED jobs by assigned cleaner.
  const runs = useMemo<CleanerRun[]>(() => {
    const weekJobs = jobs.filter((j) => j.payPeriod === period && j.status === "completed");
    const byCleaner = new Map<string, CleanerRun>();
    for (const j of weekJobs) {
      for (const c of j.cleaners) {
        const r = byCleaner.get(c.id) || { cleanerId: c.id, jobs: [], owedCents: 0, paidCents: 0, totalCents: 0, payableBookingIds: [] };
        r.jobs.push(j);
        r.totalCents += c.payCents;
        if (j.paid) r.paidCents += c.payCents;
        else if (j.payable) { r.owedCents += c.payCents; r.payableBookingIds.push(j.bookingId); }
        byCleaner.set(c.id, r);
      }
    }
    return Array.from(byCleaner.values()).sort((a, b) => b.owedCents - a.owedCents);
  }, [jobs, period]);

  const summary = useMemo(() => ({
    cleaners: runs.length,
    gross: runs.reduce((a, r) => a + r.totalCents, 0),
    owed: runs.reduce((a, r) => a + r.owedCents, 0),
    paid: runs.reduce((a, r) => a + r.paidCents, 0),
  }), [runs]);

  const payCleaner = async (r: CleanerRun) => {
    const c = cleanerById.get(r.cleanerId);
    if (!c?.stripe_account_id) { toast.error("Cleaner has no Stripe Connect account."); return; }
    if (!c?.payouts_enabled) { toast.error("Payouts not enabled on this Stripe account."); return; }
    if (r.payableBookingIds.length === 0) { toast.info("Nothing owed this week."); return; }
    if (!confirm(`Release ${usd(r.owedCents)} to ${cleanerName(c)} for ${r.payableBookingIds.length} job(s)?`)) return;
    setBusyId(r.cleanerId);
    try {
      let ok = 0, fail = 0;
      for (const bid of r.payableBookingIds) {
        const res = await payoutBooking(bid);
        if (res.ok) ok++; else fail++;
      }
      toast.success(`Paid ${ok} job(s)${fail ? ` · ${fail} failed` : ""}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payout failed");
    } finally {
      setBusyId(null);
    }
  };

  const payAll = async () => {
    const allBookingIds = Array.from(new Set(runs.flatMap((r) => {
      const c = cleanerById.get(r.cleanerId);
      return c?.stripe_account_id && c?.payouts_enabled ? r.payableBookingIds : [];
    })));
    if (allBookingIds.length === 0) { toast.info("Nothing payable (or cleaners not Connect-ready)."); return; }
    if (!confirm(`Release payouts for ${allBookingIds.length} job(s) this week?`)) return;
    setBusyId("__all__");
    try {
      let ok = 0, fail = 0;
      for (const bid of allBookingIds) {
        const res = await payoutBooking(bid);
        if (res.ok) ok++; else fail++;
      }
      toast.success(`Paid ${ok} job(s)${fail ? ` · ${fail} failed` : ""}`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-600">Pay period (Mon–Sun)</p>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{periodOptions.map((m) => <SelectItem key={m} value={m}>{formatPeriod(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {summary.owed > 0 && (
            <Button onClick={payAll} disabled={busyId !== null} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {busyId === "__all__" ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSendPlaneLine className="w-4 h-4 mr-1.5" />}
              Pay all owed ({usd(summary.owed)})
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="ml-auto">
            <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cleaners" value={String(summary.cleaners)} />
        <Tile label="Gross (week)" value={usd(summary.gross)} />
        <Tile label="Owed" value={usd(summary.owed)} highlight />
        <Tile label="Paid" value={usd(summary.paid)} />
      </div>

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : runs.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No completed jobs for {formatPeriod(period)}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => {
            const c = cleanerById.get(r.cleanerId);
            const ready = !!c?.stripe_account_id && !!c?.payouts_enabled;
            return (
              <Card key={r.cleanerId} className="border-slate-200">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">{cleanerName(c)}</CardTitle>
                    {ready ? (
                      <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                        <RiCheckboxCircleFill className="w-3 h-3 mr-1" /> Connect ready
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                        <RiAlertLine className="w-3 h-3 mr-1" /> No Stripe Connect
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">{r.jobs.length} job(s) this week</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <Mini label="Owed" value={usd(r.owedCents)} tone="amber" />
                    <Mini label="Paid" value={usd(r.paidCents)} tone="emerald" />
                    <Mini label="Total" value={usd(r.totalCents)} tone="slate" />
                  </div>
                  <Button
                    size="sm"
                    disabled={busyId !== null || r.owedCents <= 0 || !ready}
                    onClick={() => payCleaner(r)}
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    {busyId === r.cleanerId ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSendPlaneLine className="w-4 h-4 mr-1.5" />}
                    Pay {usd(r.owedCents)}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Payouts release each completed booking via the same <code className="px-1 bg-slate-100 rounded">process-payout</code> flow
        used everywhere else (idempotent — re-paying a settled job is a no-op). Multi-cleaner jobs transfer at the booking level.
      </p>
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={cn("border", highlight ? "border-violet-200 bg-violet-50" : "border-slate-200")}>
      <CardContent className="p-4">
        <p className={cn("text-[11px] uppercase tracking-wider font-semibold", highlight ? "text-violet-700/80" : "text-slate-500")}>{label}</p>
        <p className={cn("text-lg font-bold mt-0.5", highlight ? "text-violet-700" : "text-slate-800")}>{value}</p>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: "amber" | "emerald" | "slate" }) {
  const t = { amber: "text-amber-700", emerald: "text-violet-700", slate: "text-slate-700" }[tone];
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</p>
      <p className={cn("text-sm font-bold", t)}>{value}</p>
    </div>
  );
}
