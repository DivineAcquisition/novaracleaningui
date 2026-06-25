"use client";

// ─── Auto Payroll — Review → Approve & Pay ──────────────────────────────────
//
// The human approval gate for the automated payroll run. The weekly
// payroll-draft cron (or the "Rebuild draft" button) computes one Draft run
// per cleaner. The admin reviews lines, tweaks bonus/deduction, then clicks
// ONE button — "Approve & Pay" — and payroll-execute fires every payable
// Stripe transfer automatically (server-side, idempotent). No per-cleaner clicks.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line, RiRefreshLine, RiAlertLine, RiCheckboxCircleFill,
  RiSecurePaymentLine, RiHammerLine, RiCloseCircleLine, RiTimeLine,
} from "@remixicon/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd, thisWeekMonday, formatPeriod, payPeriodMonday } from "@/lib/payroll";
import {
  type PayrollCleaner, type PreviewLine, type PreviewResult, type ExecuteResult,
  loadPeriodPreview, executePayrollPeriod, buildDraftRuns, updateRunAdjustments,
} from "./shared";

const toCents = (dollars: string): number => Math.max(0, Math.round(parseFloat(dollars || "0") * 100) || 0);
const toDollars = (cents: number): string => (cents / 100).toFixed(2);

export default function AutoPayrollTab({ cleaners: _cleaners }: { cleaners: PayrollCleaner[] }) {
  const [period, setPeriod] = useState(() => {
    // Default to the prior completed week — that's what the cron drafts.
    const d = new Date(`${thisWeekMonday()}T12:00:00`); d.setDate(d.getDate() - 7);
    return payPeriodMonday(d);
  });
  const [data, setData] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [edits, setEdits] = useState<Record<string, { bonus: string; deduction: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [results, setResults] = useState<ExecuteResult | null>(null);

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

  const load = useCallback(async () => {
    setLoading(true);
    setResults(null);
    try {
      const res = await loadPeriodPreview(period);
      setData(res);
      setEdits(Object.fromEntries(res.lines.map((l) => [l.runId, { bonus: toDollars(l.bonusCents), deduction: toDollars(l.deductionCents) }])));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load payroll");
    } finally {
      setLoading(false);
    }
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  const rebuild = async () => {
    setBuilding(true);
    try {
      const { runs } = await buildDraftRuns(period);
      toast.success(runs > 0 ? `Drafted ${runs} cleaner run(s).` : "No approved jobs to draft for this period.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build draft");
    } finally {
      setBuilding(false);
    }
  };

  const saveAdjustments = async (line: PreviewLine) => {
    const e = edits[line.runId];
    if (!e) return;
    setSavingId(line.runId);
    try {
      await updateRunAdjustments(line.runId, toCents(e.bonus), toCents(e.deduction));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save adjustment");
    } finally {
      setSavingId(null);
    }
  };

  const liveNet = (line: PreviewLine): number => {
    const e = edits[line.runId];
    if (!e) return line.netCents;
    return line.grossCents + toCents(e.bonus) - toCents(e.deduction);
  };

  const isDirty = (line: PreviewLine): boolean => {
    const e = edits[line.runId];
    return !!e && (toCents(e.bonus) !== line.bonusCents || toCents(e.deduction) !== line.deductionCents);
  };

  const approveAndPay = async () => {
    if (!data) return;
    const t = data.totals;
    if (t.payable === 0) { toast.info("Nothing payable in this period."); return; }
    if (Object.values(edits).some((_e) => false)) { /* noop */ }
    const anyDirty = data.lines.some(isDirty);
    if (anyDirty && !confirm("You have unsaved bonus/deduction edits that won't be included. Continue anyway?")) return;
    if (!confirm(`Approve & Pay ${usd(t.netPayable)} to ${t.payable} cleaner(s)?\n\nThis fires every payable Stripe transfer automatically and cannot be undone.`)) return;

    setExecuting(true);
    setResults(null);
    try {
      const res = await executePayrollPeriod(period);
      setResults(res);
      if (res.halted) {
        toast.error("Execution halted", { description: res.reason });
      } else {
        const tt = res.totals;
        toast.success(`Paid ${tt.paidCount} (${usd(tt.netPaidCents)})${tt.failedCount ? ` · ${tt.failedCount} failed` : ""}${tt.blocked ? ` · ${tt.blocked} blocked` : ""}`);
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setExecuting(false);
    }
  };

  const totals = data?.totals;
  const resultById = useMemo(() => {
    const m = new Map<string, ExecuteResult["results"][number]>();
    for (const r of results?.results || []) m.set(r.runId, r);
    return m;
  }, [results]);

  return (
    <div className="space-y-5">
      {/* Controls */}
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-600">Pay period (Mon–Sun)</p>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>{periodOptions.map((m) => <SelectItem key={m} value={m}>{formatPeriod(m)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={rebuild} disabled={building || executing}>
            {building ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiHammerLine className="w-4 h-4 mr-1.5" />}
            Rebuild draft
          </Button>
          {totals && totals.payable > 0 && (
            <Button onClick={approveAndPay} disabled={executing || loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {executing ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSecurePaymentLine className="w-4 h-4 mr-1.5" />}
              Approve &amp; Pay {usd(totals.netPayable)} to {totals.payable} cleaner{totals.payable === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} className="ml-auto">
            <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
          </Button>
        </CardContent>
      </Card>

      {/* Totals bar */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Net to pay" value={usd(totals.netPayable)} highlight />
          <Tile label="Payable cleaners" value={String(totals.payable)} />
          <Tile label="Blocked" value={String(totals.blocked)} tone={totals.blocked > 0 ? "rose" : undefined} />
          <Tile label="Already paid" value={`${data?.totals.done ?? 0} · ${usd(totals.netDone)}`} />
        </div>
      )}

      {/* Halt / result banner */}
      {results?.halted && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 flex items-start gap-2 text-sm text-rose-800">
            <RiAlertLine className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div><p className="font-semibold">Execution halted — no transfers sent.</p><p className="text-xs mt-0.5">{results.reason}</p></div>
          </CardContent>
        </Card>
      )}

      {/* Lines */}
      <Card className="border-slate-200">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : !data || data.lines.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No draft runs for {formatPeriod(period)}. Click <strong>Rebuild draft</strong> after approving this week's jobs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cleaner</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="text-right">Deduction</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => {
                    const e = edits[l.runId] || { bonus: "0.00", deduction: "0.00" };
                    const editable = l.flag !== "done" && !["processing", "sent", "paid", "cleared"].includes(l.status);
                    const rr = resultById.get(l.runId);
                    return (
                      <TableRow key={l.runId} className="hover:bg-slate-50/60">
                        <TableCell>
                          <p className="font-medium text-slate-900 text-sm">{l.cleanerName}</p>
                          <p className="text-[11px] text-slate-500">{l.paymentMethod}</p>
                        </TableCell>
                        <TableCell className="text-right text-sm">{l.totalJobs}</TableCell>
                        <TableCell className="text-right text-sm">{usd(l.grossCents)}</TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              value={e.bonus}
                              onChange={(ev) => setEdits((p) => ({ ...p, [l.runId]: { ...e, bonus: ev.target.value } }))}
                              inputMode="decimal"
                              className="h-8 w-20 text-right text-sm ml-auto"
                            />
                          ) : <span className="text-sm text-slate-500">{usd(l.bonusCents)}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <Input
                              value={e.deduction}
                              onChange={(ev) => setEdits((p) => ({ ...p, [l.runId]: { ...e, deduction: ev.target.value } }))}
                              inputMode="decimal"
                              className="h-8 w-20 text-right text-sm ml-auto"
                            />
                          ) : <span className="text-sm text-slate-500">{usd(l.deductionCents)}</span>}
                        </TableCell>
                        <TableCell className="text-right text-sm font-semibold text-slate-900">{usd(liveNet(l))}</TableCell>
                        <TableCell className="text-center">
                          <FlagBadge line={l} result={rr} />
                        </TableCell>
                        <TableCell className="text-right">
                          {editable && isDirty(l) && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={savingId === l.runId} onClick={() => saveAdjustments(l)}>
                              {savingId === l.runId ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400">
        Computation is automatic (weekly <code className="px-1 bg-slate-100 rounded">payroll-draft</code> cron). Sending requires this one approval; after the click,
        <code className="mx-1 px-1 bg-slate-100 rounded">payroll-execute</code> fires every payable transfer automatically with a per-cleaner Stripe idempotency key,
        a platform-balance check, and a per-run processing lock. Transfer outcomes reconcile via the Stripe webhook.
      </p>
    </div>
  );
}

function FlagBadge({ line, result }: { line: PreviewLine; result?: ExecuteResult["results"][number] }) {
  if (result) {
    if (result.status === "paid") return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"><RiCheckboxCircleFill className="w-3 h-3 mr-1" />Paid</Badge>;
    if (result.status === "failed") return <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200" title={result.reason}><RiCloseCircleLine className="w-3 h-3 mr-1" />Failed</Badge>;
    if (result.status === "blocked") return <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200" title={result.reason}><RiAlertLine className="w-3 h-3 mr-1" />Blocked</Badge>;
    return <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200">Skipped</Badge>;
  }
  if (line.flag === "done") return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"><RiCheckboxCircleFill className="w-3 h-3 mr-1" />{line.status}</Badge>;
  if (line.flag === "blocked") return <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200" title={line.flagReason}><RiAlertLine className="w-3 h-3 mr-1" />Blocked</Badge>;
  if (line.flag === "skip") return <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200" title={line.flagReason}><RiTimeLine className="w-3 h-3 mr-1" />Skip</Badge>;
  return <Badge variant="outline" className="text-[10px] bg-sky-50 text-sky-700 border-sky-200">Payable</Badge>;
}

function Tile({ label, value, highlight, tone }: { label: string; value: string; highlight?: boolean; tone?: "rose" }) {
  return (
    <Card className={cn("border", highlight ? "border-emerald-200 bg-emerald-50" : tone === "rose" ? "border-rose-200 bg-rose-50" : "border-slate-200")}>
      <CardContent className="p-4">
        <p className={cn("text-[11px] uppercase tracking-wider font-semibold", highlight ? "text-emerald-700/80" : tone === "rose" ? "text-rose-700/80" : "text-slate-500")}>{label}</p>
        <p className={cn("text-lg font-bold mt-0.5", highlight ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-800")}>{value}</p>
      </CardContent>
    </Card>
  );
}
