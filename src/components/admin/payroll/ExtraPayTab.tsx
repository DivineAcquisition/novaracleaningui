"use client";

// ─── Extra Pay — per-job supplies / mileage / surge / overtime payouts ──────
//
// Replaces the old read-only "Cleaner Detail" tab. Works like Custom Payout:
// pick the cleaner, pick the JOB the extra pay belongs to, enter any mix of
//   • supply reimbursement ($)
//   • mileage (miles × rate, default $0.70/mi)
//   • surge pay ($)
//   • overtime (hours × $/hr)
//   • job value increase ($ — job turned out bigger than booked)
// and one click records the payment against that job in job_extra_pay.
// Stripe Connect sends the exact cents from Extra Pay or Run Payroll.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiLoader4Line, RiRefreshLine, RiSendPlaneLine, RiMoneyDollarCircleLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd } from "@/lib/payroll";
import {
  type PayrollCleaner, type OperationalJob, cleanerName, loadOperationalJobs,
} from "./shared";

interface ExtraPayment {
  id: string;
  booking_id: string | null;
  cleaner_id: string;
  supply_cents: number;
  mileage_miles: number;
  mileage_rate_cents: number;
  mileage_cents: number;
  surge_cents: number;
  overtime_hours: number;
  overtime_rate_cents: number;
  overtime_cents: number;
  job_value_cents: number;
  total_cents: number;
  note: string | null;
  status: string;
  failure_reason: string | null;
  stripe_transfer_id: string | null;
  paid_at: string | null;
  created_at: string;
  booking_ref: string | null;
  customer: string | null;
  service_date: string | null;
  cleaner_name: string | null;
}

const toCents = (dollars: string): number => Math.max(0, Math.round((parseFloat(dollars) || 0) * 100));
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function ExtraPayTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [cleanerId, setCleanerId] = useState<string>("");
  const [jobs, setJobs] = useState<OperationalJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string>("");

  const [supplies, setSupplies] = useState("");
  const [miles, setMiles] = useState("");
  const [mileRate, setMileRate] = useState("0.70");
  const [surge, setSurge] = useState("");
  const [otHours, setOtHours] = useState("");
  const [otRate, setOtRate] = useState("");
  const [jobValue, setJobValue] = useState("");
  const [note, setNote] = useState("");
  const [paying, setPaying] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);

  const [history, setHistory] = useState<ExtraPayment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const cleaner = useMemo(() => cleaners.find((c) => c.id === cleanerId), [cleaners, cleanerId]);

  // Jobs this cleaner was on (newest first).
  const cleanerJobs = useMemo(
    () => jobs.filter((j) => j.cleaners.some((c) => c.id === cleanerId)),
    [jobs, cleanerId],
  );
  const selectedJob = useMemo(() => cleanerJobs.find((j) => j.bookingId === bookingId) || null, [cleanerJobs, bookingId]);

  const supplyCents = toCents(supplies);
  const mileageMiles = Math.max(0, parseFloat(miles) || 0);
  const mileageRateCents = toCents(mileRate) || 70;
  const mileageCents = Math.round(mileageMiles * mileageRateCents);
  const surgeCents = toCents(surge);
  const overtimeHours = Math.max(0, parseFloat(otHours) || 0);
  const overtimeRateCents = toCents(otRate);
  const overtimeCents = Math.round(overtimeHours * overtimeRateCents);
  const jobValueCents = toCents(jobValue);
  const totalCents = supplyCents + mileageCents + surgeCents + overtimeCents + jobValueCents;

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      setJobs(await loadOperationalJobs());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (forCleaner?: string) => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-extra-pay", {
        body: { action: "list", ...(forCleaner ? { cleanerId: forCleaner } : {}), limit: 60 },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      setHistory(((data as { payments?: ExtraPayment[] }).payments) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load extra-pay history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); void loadHistory(); }, [loadJobs, loadHistory]);
  useEffect(() => {
    setBookingId("");
    void loadHistory(cleanerId || undefined);
  }, [cleanerId, loadHistory]);

  const resetForm = () => {
    setSupplies(""); setMiles(""); setSurge(""); setOtHours(""); setOtRate(""); setJobValue(""); setNote("");
  };

  const pay = async () => {
    if (!cleanerId) { toast.error("Pick a cleaner first."); return; }
    if (totalCents <= 0) { toast.error("Enter at least one amount."); return; }
    const jobLabel = selectedJob
      ? `${selectedJob.bookingNumber || "job"} (${selectedJob.customer || "customer"})`
      : "no specific job";
    if (!confirm(
      `Record ${usd(totalCents)} extra pay for ${cleanerName(cleaner)} — ${jobLabel}?\n\n` +
      [
        supplyCents > 0 ? `• Supplies ${usd(supplyCents)}` : "",
        mileageCents > 0 ? `• Mileage ${mileageMiles} mi × ${usd(mileageRateCents)}/mi = ${usd(mileageCents)}` : "",
        surgeCents > 0 ? `• Surge ${usd(surgeCents)}` : "",
        overtimeCents > 0 ? `• Overtime ${overtimeHours} h × ${usd(overtimeRateCents)}/h = ${usd(overtimeCents)}` : "",
        jobValueCents > 0 ? `• Job value increase ${usd(jobValueCents)}` : "",
      ].filter(Boolean).join("\n"),
    )) return;

    setPaying(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-extra-pay", {
        body: {
          action: "pay",
          cleanerId,
          bookingId: bookingId || undefined,
          supplyCents,
          mileageMiles,
          mileageRateCents,
          surgeCents,
          overtimeHours,
          overtimeRateCents,
          jobValueCents,
          note: note.trim() || undefined,
        },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string; smsSent?: boolean };
      if (d?.error || d?.ok === false) throw new Error(d?.error || "Failed to record extra pay");
      toast.success(
        `Recorded ${usd(totalCents)} extra pay for ${cleanerName(cleaner)}${d.smsSent ? " — they've been texted" : ""}. Pay it via Stripe Connect below or from Run Payroll.`,
      );
      resetForm();
      await loadHistory(cleanerId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record extra pay");
    } finally {
      setPaying(false);
    }
  };

  const payViaStripe = async (id: string) => {
    setMarkingPaid(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not signed in");
      const res = await fetch("/api/payroll/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: "execute_pending", extraPayId: id }),
      });
      const json = await res.json();
      if (!res.ok || json?.error || json?.halted) throw new Error(json?.error || "Stripe could not send this payout");
      if (!json.paidCount) throw new Error("Nothing was paid — check Stripe Connect and available balance.");
      toast.success("Paid via Stripe Connect.");
      await loadHistory(cleanerId || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pay via Stripe");
    } finally {
      setMarkingPaid(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="border-violet-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RiMoneyDollarCircleLine className="w-4 h-4 text-violet-600" /> Extra pay — per job
          </CardTitle>
          <CardDescription className="text-xs">Supply reimbursement, mileage, surge pay, overtime &amp; job value increases — recorded per job. Pay via Stripe Connect here or from Run Payroll (same amounts).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Cleaner + job */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Cleaner</Label>
              <Select value={cleanerId} onValueChange={setCleanerId}>
                <SelectTrigger><SelectValue placeholder="Select a cleaner" /></SelectTrigger>
                <SelectContent>
                  {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{cleanerName(c)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Job (this cleaner&apos;s bookings)</Label>
              <Select value={bookingId} onValueChange={setBookingId} disabled={!cleanerId || jobsLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={jobsLoading ? "Loading jobs…" : cleanerJobs.length === 0 ? "No jobs found for this cleaner" : "Select the job"} />
                </SelectTrigger>
                <SelectContent>
                  {cleanerJobs.map((j) => (
                    <SelectItem key={j.bookingId} value={j.bookingId}>
                      {(j.bookingNumber || "Job")} · {j.customer || "Customer"} · {fmtDate(j.serviceDate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <Label className="text-xs font-semibold">Supply reimbursement</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <Input type="number" inputMode="decimal" min="0" step="0.01" value={supplies} onChange={(e) => setSupplies(e.target.value)} className="pl-6" placeholder="0.00" />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <Label className="text-xs font-semibold">Mileage</Label>
              <div className="flex gap-1.5">
                <Input type="number" inputMode="decimal" min="0" step="0.1" value={miles} onChange={(e) => setMiles(e.target.value)} placeholder="miles" />
                <div className="relative w-24 shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                  <Input type="number" inputMode="decimal" min="0" step="0.01" value={mileRate} onChange={(e) => setMileRate(e.target.value)} className="pl-5" title="Rate per mile" />
                </div>
              </div>
              <p className="text-[10px] text-slate-400">= {usd(mileageCents)} ({usd(mileageRateCents)}/mi)</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <Label className="text-xs font-semibold">Surge pay</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <Input type="number" inputMode="decimal" min="0" step="0.01" value={surge} onChange={(e) => setSurge(e.target.value)} className="pl-6" placeholder="0.00" />
              </div>
              <p className="text-[10px] text-slate-400">Difficult / last-minute job bump</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <Label className="text-xs font-semibold">Overtime</Label>
              <div className="flex gap-1.5">
                <Input type="number" inputMode="decimal" min="0" step="0.25" value={otHours} onChange={(e) => setOtHours(e.target.value)} placeholder="hours" />
                <div className="relative w-24 shrink-0">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                  <Input type="number" inputMode="decimal" min="0" step="0.01" value={otRate} onChange={(e) => setOtRate(e.target.value)} className="pl-5" title="Rate per hour" />
                </div>
              </div>
              <p className="text-[10px] text-slate-400">= {usd(overtimeCents)} ({usd(overtimeRateCents)}/h)</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
              <Label className="text-xs font-semibold">Job value increase</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <Input type="number" inputMode="decimal" min="0" step="0.01" value={jobValue} onChange={(e) => setJobValue(e.target.value)} className="pl-6" placeholder="0.00" />
              </div>
              <p className="text-[10px] text-slate-400">Job was bigger than booked — pay bump</p>
            </div>
          </div>

          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what was this for?) — optional" />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-violet-50 border border-violet-200 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-violet-700/70 font-semibold">Total extra pay</p>
              <p className="text-2xl font-bold text-violet-700">{usd(totalCents)}</p>
            </div>
            <Button
              onClick={pay}
              disabled={paying || !cleanerId || totalCents <= 0}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {paying
                ? <><RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> Recording…</>
                : <><RiSendPlaneLine className="w-4 h-4 mr-2" /> Record &amp; notify {cleaner ? cleanerName(cleaner) : "cleaner"}</>}
            </Button>
          </div>
          <p className="text-[11px] text-slate-400">
            Records extra pay against the selected job. Run Payroll (or Pay via Stripe below) sends the exact amount through Stripe Connect when funds are available.
          </p>
        </CardContent>
      </Card>

      {/* History */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Extra-pay history{cleaner ? ` — ${cleanerName(cleaner)}` : ""}</CardTitle>
              <CardDescription className="text-xs">Every supplies / mileage / surge / overtime / job-value payment, per job.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void loadHistory(cleanerId || undefined)} disabled={historyLoading}>
              <RiRefreshLine className={cn("w-4 h-4", historyLoading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {historyLoading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : history.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No extra payments yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Cleaner</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="text-right">Supplies</TableHead>
                    <TableHead className="text-right">Mileage</TableHead>
                    <TableHead className="text-right">Surge</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Job value</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(p.paid_at || p.created_at)}</TableCell>
                      <TableCell className="text-sm">{p.cleaner_name || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-slate-700">{p.booking_ref || "—"}</span>
                        {p.customer ? <span className="text-slate-400"> · {p.customer}</span> : null}
                        {p.note ? <p className="text-[10px] text-slate-400 max-w-[200px] truncate" title={p.note}>{p.note}</p> : null}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.supply_cents ? usd(p.supply_cents) : "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {p.mileage_cents ? <>{usd(p.mileage_cents)}<span className="text-slate-400"> ({p.mileage_miles}mi)</span></> : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.surge_cents ? usd(p.surge_cents) : "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {p.overtime_cents ? <>{usd(p.overtime_cents)}<span className="text-slate-400"> ({p.overtime_hours}h)</span></> : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{p.job_value_cents ? usd(p.job_value_cents) : "—"}</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-violet-700 tabular-nums">{usd(p.total_cents)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn(
                            "text-[10px] capitalize",
                            p.status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : p.status === "failed" ? "bg-rose-50 text-rose-700 border-rose-200"
                                : "bg-amber-50 text-amber-700 border-amber-200",
                          )}>
                            {p.status}
                          </Badge>
                          {p.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[10px] border-violet-200 text-violet-700 hover:bg-violet-50"
                              disabled={markingPaid === p.id}
                              onClick={() => void payViaStripe(p.id)}
                            >
                              {markingPaid === p.id ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Pay via Stripe"}
                            </Button>
                          )}
                        </div>
                        {p.status === "failed" && p.failure_reason ? (
                          <p className="text-[10px] text-rose-600 max-w-[180px] mt-0.5" title={p.failure_reason}>{p.failure_reason}</p>
                        ) : null}
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
