"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line, RiCheckLine, RiSendPlaneLine, RiBuilding2Line, RiCheckDoubleLine, RiAlertLine, RiRefreshLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd, thisWeekMonday, formatPeriod, payPeriodMonday } from "@/lib/payroll";
import {
  type PayrollCleaner, type PayrollRunRow, payrollAction, cleanerName, STATUS_TONE,
} from "./shared";

export default function RunPayrollTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [period, setPeriod] = useState(thisWeekMonday());
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const cleanerById = useMemo(() => new Map(cleaners.map((c) => [c.id, c])), [cleaners]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      const from = supabase.from as any;
      const [{ data: runRows }, { count }] = await Promise.all([
        from("payroll_runs").select("*").eq("pay_period_start", period).order("created_at", { ascending: true }),
        from("payroll_jobs").select("id", { count: "exact", head: true }).eq("pay_period", period).eq("payment_status", "pending"),
      ]);
      setRuns((runRows || []) as unknown as PayrollRunRow[]);
      setPendingCount(count || 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: string, payload: Record<string, unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      const res = await payrollAction<Record<string, unknown>>(action, payload);
      if (okMsg) toast.success(okMsg);
      await load();
      return res;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const periodOptions = useMemo(() => {
    const opts: string[] = [];
    let m = thisWeekMonday();
    for (let i = 0; i < 10; i++) {
      opts.push(m);
      const d = new Date(`${m}T12:00:00`);
      d.setDate(d.getDate() - 7);
      m = payPeriodMonday(d);
    }
    return opts;
  }, []);

  const summary = useMemo(() => {
    const gross = runs.reduce((a, r) => a + (r.gross_cents || 0), 0);
    const net = runs.reduce((a, r) => a + (r.net_cents || 0), 0);
    const toDisburse = runs.filter((r) => ["draft", "approved", "hold"].includes(r.status)).reduce((a, r) => a + (r.net_cents || 0), 0);
    return { cleaners: runs.length, gross, net, toDisburse };
  }, [runs]);

  const approvedCount = runs.filter((r) => r.status === "approved").length;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-600">Pay period (Mon–Sun)</p>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodOptions.map((m) => <SelectItem key={m} value={m}>{formatPeriod(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => run("approve_jobs", { payPeriod: period }, "Reviewed jobs approved")} disabled={busy}>
            <RiCheckDoubleLine className="w-4 h-4 mr-1.5" />
            Approve all reviewed{pendingCount ? ` (${pendingCount})` : ""}
          </Button>
          <Button onClick={() => run("build_runs", { payPeriod: period }, "Runs built")} disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiBuilding2Line className="w-4 h-4 mr-1.5" />}
            Build runs
          </Button>
          {approvedCount > 0 && (
            <Button
              onClick={() => {
                if (!confirm(`Send ${approvedCount} approved payout(s) for ${formatPeriod(period)}?`)) return;
                run("send_all", { payPeriod: period }, "Payouts dispatched");
              }}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <RiSendPlaneLine className="w-4 h-4 mr-1.5" /> Send all approved ({approvedCount})
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="ml-auto">
            <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cleaners" value={String(summary.cleaners)} />
        <Tile label="Gross" value={usd(summary.gross)} />
        <Tile label="Net" value={usd(summary.net)} />
        <Tile label="To disburse" value={usd(summary.toDisburse)} highlight />
      </div>

      {/* Runs */}
      {loading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : runs.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="py-10 text-center text-sm text-slate-500">
            No runs yet for this week. Approve reviewed jobs, then <strong>Build runs</strong>.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <RunCard key={r.id} run={r} cleaner={cleanerById.get(r.cleaner_id)} busy={busy} onAction={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run, cleaner, busy, onAction,
}: {
  run: PayrollRunRow;
  cleaner?: PayrollCleaner;
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>, okMsg?: string) => Promise<unknown>;
}) {
  const [bonus, setBonus] = useState((run.bonus_cents / 100).toString());
  const [deduction, setDeduction] = useState((run.deduction_cents / 100).toString());
  const editable = ["draft", "approved", "hold"].includes(run.status);
  const liveNet = run.gross_cents + Math.round((parseFloat(bonus) || 0) * 100) - Math.round((parseFloat(deduction) || 0) * 100);

  const saveAdjust = () =>
    onAction("update_run", {
      runId: run.id,
      bonusCents: Math.round((parseFloat(bonus) || 0) * 100),
      deductionCents: Math.round((parseFloat(deduction) || 0) * 100),
    }, "Adjustment saved");

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{cleanerName(cleaner)}</CardTitle>
          <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[run.status])}>{run.status}</Badge>
        </div>
        <CardDescription className="text-xs">
          {run.total_jobs} job(s) · {run.payment_method || "stripe_connect"}
          {run.status === "hold" && (
            <span className="text-rose-600 inline-flex items-center gap-1 ml-2">
              <RiAlertLine className="w-3 h-3" /> No Stripe Connect account
            </span>
          )}
          {run.failure_reason && <span className="text-rose-600 ml-2">· {run.failure_reason}</span>}
          {run.stripe_transfer_id && <span className="text-slate-400 ml-2">· {run.stripe_transfer_id}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Gross</p>
            <p className="text-sm font-semibold text-slate-800">{usd(run.gross_cents)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Bonus ($)</p>
            <Input type="number" min="0" step="0.01" value={bonus} disabled={!editable || busy}
              onChange={(e) => setBonus(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Deduction ($)</p>
            <Input type="number" min="0" step="0.01" value={deduction} disabled={!editable || busy}
              onChange={(e) => setDeduction(e.target.value)} className="h-8" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Net pay</p>
            <p className="text-lg font-bold text-violet-700">{usd(editable ? liveNet : run.net_cents)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button size="sm" variant="outline" onClick={saveAdjust} disabled={busy}>
              Save adjustment
            </Button>
          )}
          {(run.status === "draft" || run.status === "hold") && (
            <Button size="sm" onClick={() => onAction("approve_run", { runId: run.id }, "Run approved")} disabled={busy}
              className="bg-sky-600 hover:bg-sky-700 text-white">
              <RiCheckLine className="w-4 h-4 mr-1.5" /> Approve
            </Button>
          )}
          {run.status === "approved" && (
            <Button size="sm" onClick={() => {
              if (!confirm(`Send ${usd(run.net_cents)} to ${cleanerName(cleaner)}?`)) return;
              onAction("send_payout", { runId: run.id }, "Payout sent");
            }} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <RiSendPlaneLine className="w-4 h-4 mr-1.5" /> Send payout
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
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
