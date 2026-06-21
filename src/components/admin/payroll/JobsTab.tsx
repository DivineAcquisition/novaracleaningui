"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  RiAddLine, RiCheckLine, RiDeleteBinLine, RiLoader4Line, RiPencilLine, RiCheckDoubleLine,
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  computeJobPay, payPctForTier, usd, PAYROLL_SERVICE_TYPES, thisWeekMonday, formatPeriod, payPeriodMonday,
} from "@/lib/payroll";
import {
  type PayrollCleaner, type PayrollJobRow, payrollAction, cleanerName, STATUS_TONE,
} from "./shared";

const todayLocalYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function JobsTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [jobs, setJobs] = useState<PayrollJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState<string>(thisWeekMonday());
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dateCompleted, setDateCompleted] = useState(todayLocalYmd());
  const [customerName, setCustomerName] = useState("");
  const [serviceType, setServiceType] = useState<string>("Standard");
  const [amount, setAmount] = useState("");
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const cleanerById = useMemo(
    () => new Map(cleaners.map((c) => [c.id, c])),
    [cleaners],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // payroll_* tables aren't in the generated Supabase types yet — use the
      // repo's established `(supabase.from as any)` escape hatch.
      // deno-lint-ignore no-explicit-any
      let q = (supabase.from as any)("payroll_jobs")
        .select("*, payroll_job_cleaners(cleaner_id, pay_cents, payment_status)")
        .order("date_completed", { ascending: false })
        .limit(500);
      if (periodFilter !== "all") q = q.eq("pay_period", periodFilter);
      if (statusFilter !== "all") q = q.eq("payment_status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      setJobs((data || []) as unknown as PayrollJobRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [periodFilter, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  // Live preview of the pay split.
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const preview = useMemo(() => {
    const pcts = selectedCleaners.map((id) => cleanerById.get(id)?.pay_percentage ?? payPctForTier(cleanerById.get(id)?.pay_tier || "foundation"));
    return computeJobPay(amountCents, pcts);
  }, [amountCents, selectedCleaners, cleanerById]);

  const resetForm = () => {
    setEditingId(null);
    setCustomerName("");
    setServiceType("Standard");
    setAmount("");
    setSelectedCleaners([]);
    setNotes("");
  };

  const toggleCleaner = (id: string) => {
    setSelectedCleaners((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async (keepOpen: boolean) => {
    if (amountCents <= 0) { toast.error("Enter the customer-paid amount."); return; }
    if (selectedCleaners.length === 0) { toast.error("Select at least one cleaner."); return; }
    setBusy(true);
    try {
      const payload = {
        jobId: editingId || undefined,
        dateCompleted: new Date(`${dateCompleted}T12:00:00`).toISOString(),
        customerName: customerName.trim() || null,
        serviceType,
        customerPaidCents: amountCents,
        cleanerIds: selectedCleaners,
        notes: notes.trim() || null,
      };
      await payrollAction(editingId ? "update_job" : "create_job", payload);
      toast.success(editingId ? "Job updated" : "Job added");
      if (keepOpen) {
        // Quick bulk entry: keep the date, clear the rest.
        setCustomerName("");
        setAmount("");
        setNotes("");
        setEditingId(null);
      } else {
        resetForm();
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (j: PayrollJobRow) => {
    setEditingId(j.id);
    setDateCompleted(j.date_completed.slice(0, 10));
    setCustomerName(j.customer_name || "");
    setServiceType(j.service_type);
    setAmount((j.customer_paid_cents / 100).toString());
    setSelectedCleaners((j.payroll_job_cleaners || []).map((l) => l.cleaner_id));
    setNotes(j.notes || "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const del = async (j: PayrollJobRow) => {
    if (!confirm("Delete this pending job?")) return;
    setBusy(true);
    try {
      await payrollAction("delete_job", { jobId: j.id });
      toast.success("Job deleted");
      if (editingId === j.id) resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const approveOne = async (j: PayrollJobRow) => {
    setBusy(true);
    try {
      await payrollAction("approve_jobs", { jobIds: [j.id] });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const approveAll = async () => {
    const pendingIds = jobs.filter((j) => j.payment_status === "pending").map((j) => j.id);
    if (pendingIds.length === 0) { toast.info("No pending jobs to approve."); return; }
    setBusy(true);
    try {
      const res = await payrollAction<{ approved: number }>("approve_jobs", { jobIds: pendingIds });
      toast.success(`Approved ${res.approved} job(s)`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed");
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

  return (
    <div className="space-y-5">
      {/* Manual entry */}
      <Card className="border-violet-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RiAddLine className="w-4 h-4 text-violet-600" />
            {editingId ? "Edit job" : "Add completed job"}
          </CardTitle>
          <CardDescription>
            Pay is computed and the tier % is locked at save. Mixed-tier teams use the highest tier.
          </CardDescription>
        </CardHeader>
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
                <SelectContent>
                  {PAYROLL_SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Customer paid ($)</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="239.00" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Assigned cleaner(s)</Label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {cleaners.length === 0 && <span className="text-xs text-slate-400 p-1">No cleaners found.</span>}
              {cleaners.map((c) => {
                const on = selectedCleaners.includes(c.id);
                const pct = c.pay_percentage ?? payPctForTier(c.pay_tier || "foundation");
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCleaner(c.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-xs font-medium transition-colors",
                      on ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:border-violet-300",
                    )}
                  >
                    {cleanerName(c)} · {pct}%
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
          </div>

          {/* Live preview */}
          {selectedCleaners.length > 0 && amountCents > 0 && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Tier applied" value={`${preview.tierPct}%`} />
              <Stat label="Pay pool" value={usd(preview.poolCents)} />
              <Stat label="Cleaners" value={String(preview.cleanerCount)} />
              <Stat label="Each cleaner gets" value={usd(preview.perCleanerCents)} highlight />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(false)} disabled={busy} className="bg-violet-600 hover:bg-violet-700 text-white">
              {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiCheckLine className="w-4 h-4 mr-1.5" />}
              {editingId ? "Save changes" : "Save job"}
            </Button>
            {!editingId && (
              <Button variant="outline" onClick={() => save(true)} disabled={busy}>
                <RiAddLine className="w-4 h-4 mr-1.5" /> Save &amp; add another
              </Button>
            )}
            {editingId && (
              <Button variant="ghost" onClick={resetForm} disabled={busy}>Cancel edit</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Jobs table */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Jobs ({jobs.length})</CardTitle>
              <CardDescription className="text-xs">
                {periodFilter === "all" ? "All periods" : `Week of ${formatPeriod(periodFilter)}`}
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
                  {["all", "pending", "approved", "paid", "disputed", "hold"].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={approveAll} disabled={busy}>
                <RiCheckDoubleLine className="w-4 h-4 mr-1.5" /> Approve all reviewed
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : jobs.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No jobs in this view.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>Cleaners</TableHead>
                    <TableHead className="text-right">Tier</TableHead>
                    <TableHead className="text-right">Each</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => (
                    <TableRow key={j.id} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs">{j.date_completed.slice(0, 10)}</TableCell>
                      <TableCell className="text-sm">{j.customer_name || "—"}</TableCell>
                      <TableCell className="text-xs">{j.service_type}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{usd(j.customer_paid_cents)}</TableCell>
                      <TableCell className="text-xs">
                        {(j.payroll_job_cleaners || []).map((l) => cleanerName(cleanerById.get(l.cleaner_id))).join(", ") || "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">{j.tier_pct_locked}%</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-violet-700">{usd(j.pay_per_cleaner_cents)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[j.payment_status])}>
                          {j.payment_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {j.payment_status === "pending" && (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-700" onClick={() => approveOne(j)} disabled={busy}>
                                <RiCheckLine className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => startEdit(j)} disabled={busy}>
                                <RiPencilLine className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-rose-600" onClick={() => del(j)} disabled={busy}>
                                <RiDeleteBinLine className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                          {j.locked && <span className="text-[10px] text-slate-400">locked</span>}
                        </div>
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-violet-700/70 font-semibold">{label}</p>
      <p className={cn("font-bold", highlight ? "text-lg text-violet-700" : "text-sm text-slate-800")}>{value}</p>
    </div>
  );
}
