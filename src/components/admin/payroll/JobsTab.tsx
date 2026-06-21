"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  RiAddLine, RiCheckLine, RiLoader4Line, RiRefreshLine, RiArrowDownSLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  computeJobPay, payPctForTier, usd, PAYROLL_SERVICE_TYPES, thisWeekMonday, formatPeriod, payPeriodMonday,
} from "@/lib/payroll";
import {
  type PayrollCleaner, type OperationalJob, payrollAction, cleanerName, loadOperationalJobs, STATUS_TONE,
} from "./shared";

const todayLocalYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function JobsTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [jobs, setJobs] = useState<OperationalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setJobs(await loadOperationalJobs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load operational jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const periodOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) set.add(j.payPeriod);
    return Array.from(set).sort().reverse();
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (periodFilter !== "all" && j.payPeriod !== periodFilter) return false;
      if (statusFilter === "payable" && !j.payable) return false;
      if (statusFilter === "paid" && !j.paid) return false;
      if (statusFilter === "completed" && j.status !== "completed") return false;
      if (statusFilter === "upcoming" && j.status === "completed") return false;
      return true;
    });
  }, [jobs, periodFilter, statusFilter]);

  return (
    <div className="space-y-5">
      <ManualEntry cleaners={cleaners} onSaved={load} />

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Live &amp; past jobs ({filtered.length})</CardTitle>
              <CardDescription className="text-xs">
                Pulled straight from operations — every booking with an assigned cleaner appears here automatically.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All periods</SelectItem>
                  {periodOptions.map((m) => <SelectItem key={m} value={m}>{formatPeriod(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["all", "payable", "paid", "completed", "upcoming"].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No jobs in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Cleaner pay</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((j) => (
                    <TableRow key={j.bookingId} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs whitespace-nowrap">{(j.serviceDate || "").slice(0, 10)}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{j.bookingNumber || "—"}</TableCell>
                      <TableCell className="text-sm">{j.customer || "—"}</TableCell>
                      <TableCell className="text-xs capitalize">{(j.serviceType || "").replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{usd(j.customerPaidCents)}</TableCell>
                      <TableCell className="text-xs">
                        {j.cleaners.length === 0 ? (
                          <span className="text-slate-400">Unassigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {j.cleaners.map((c) => (
                              <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                                {c.name} · <span className="font-semibold text-violet-700">{usd(c.payCents)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-[10px] capitalize",
                          j.paid ? STATUS_TONE.paid : j.payable ? STATUS_TONE.approved : STATUS_TONE.pending,
                        )}>
                          {j.paid ? "paid" : j.payable ? "payable" : j.status}
                        </Badge>
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

// ─── Manual / off-platform job entry (supplements operational jobs) ────────
function ManualEntry({ cleaners, onSaved }: { cleaners: PayrollCleaner[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dateCompleted, setDateCompleted] = useState(todayLocalYmd());
  const [customerName, setCustomerName] = useState("");
  const [serviceType, setServiceType] = useState<string>("Standard");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const cleanerById = useMemo(() => new Map(cleaners.map((c) => [c.id, c])), [cleaners]);
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const preview = useMemo(() => computeJobPay(
    amountCents,
    selected.map((id) => cleanerById.get(id)?.pay_percentage ?? payPctForTier(cleanerById.get(id)?.pay_tier || "foundation")),
  ), [amountCents, selected, cleanerById]);

  const save = async () => {
    if (amountCents <= 0) { toast.error("Enter the customer-paid amount."); return; }
    if (selected.length === 0) { toast.error("Select at least one cleaner."); return; }
    setBusy(true);
    try {
      await payrollAction("create_job", {
        dateCompleted: new Date(`${dateCompleted}T12:00:00`).toISOString(),
        customerName: customerName.trim() || null,
        serviceType,
        customerPaidCents: amountCents,
        cleanerIds: selected,
        notes: notes.trim() || null,
        entrySource: "manual",
      });
      toast.success("Manual job added");
      setCustomerName(""); setAmount(""); setSelected([]); setNotes("");
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(
        /payroll_jobs|relation|does not exist|schema cache/i.test(msg)
          ? "Manual entry needs the payroll migration applied. Operational jobs below work without it."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-violet-200">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <RiAddLine className="w-4 h-4 text-violet-600" /> Add off-platform job (manual)
                </CardTitle>
                <CardDescription>For cash/outside jobs not in the booking system. On-platform jobs flow in automatically.</CardDescription>
              </div>
              <RiArrowDownSLine className={cn("w-4 h-4 text-slate-400 transition-transform", open && "rotate-180")} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date completed</Label>
                <Input type="date" value={dateCompleted} onChange={(e) => setDateCompleted(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Customer name</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Jane Doe" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Service type</Label>
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAYROLL_SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Customer paid ($)</Label>
                <Input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="239.00" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Assigned cleaner(s)</Label>
              <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {cleaners.map((c) => {
                  const on = selected.includes(c.id);
                  const pct = c.pay_percentage ?? payPctForTier(c.pay_tier || "foundation");
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setSelected((p) => p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id])}
                      className={cn("px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                        on ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-violet-300")}>
                      {cleanerName(c)} · {pct}%
                    </button>
                  );
                })}
              </div>
            </div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" />
            {selected.length > 0 && amountCents > 0 && (
              <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Tier applied" value={`${preview.tierPct}%`} />
                <Stat label="Pool" value={usd(preview.poolCents)} />
                <Stat label="Cleaners" value={String(preview.cleanerCount)} />
                <Stat label="Each gets" value={usd(preview.perCleanerCents)} highlight />
              </div>
            )}
            <Button onClick={save} disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
              Save manual job
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-violet-700/70 font-semibold">{label}</p>
      <p className={cn("font-bold", highlight ? "text-lg text-violet-700" : "text-sm text-slate-800")}>{value}</p>
    </div>
  );
}
