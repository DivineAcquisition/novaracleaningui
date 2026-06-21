"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd, formatPeriod } from "@/lib/payroll";
import { type PayrollCleaner, type PayrollRunRow, cleanerName, STATUS_TONE } from "./shared";

export default function RunsTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [cleanerId, setCleanerId] = useState("all");
  const cleanerById = useMemo(() => new Map(cleaners.map((c) => [c.id, c])), [cleaners]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // deno-lint-ignore no-explicit-any
      let q = (supabase.from as any)("payroll_runs").select("*").order("pay_period_start", { ascending: false }).limit(500);
      if (status !== "all") q = q.eq("status", status);
      if (cleanerId !== "all") q = q.eq("cleaner_id", cleanerId);
      const { data, error } = await q;
      if (error) throw error;
      setRuns((data || []) as unknown as PayrollRunRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setLoading(false);
    }
  }, [status, cleanerId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Payroll runs ({runs.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["all", "draft", "approved", "sent", "cleared", "failed", "hold"].map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={cleanerId} onValueChange={setCleanerId}>
              <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cleaners</SelectItem>
                {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{cleanerName(c)}</SelectItem>)}
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
        ) : runs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No runs match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Jobs</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Bonus</TableHead>
                  <TableHead className="text-right">Deduction</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transfer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50/60">
                    <TableCell className="text-sm font-medium">{cleanerName(cleanerById.get(r.cleaner_id))}</TableCell>
                    <TableCell className="text-xs">{formatPeriod(r.pay_period_start)}</TableCell>
                    <TableCell className="text-right text-sm">{r.total_jobs}</TableCell>
                    <TableCell className="text-right text-sm">{usd(r.gross_cents)}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-700">{r.bonus_cents ? usd(r.bonus_cents) : "—"}</TableCell>
                    <TableCell className="text-right text-xs text-rose-600">{r.deduction_cents ? usd(r.deduction_cents) : "—"}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-violet-700">{usd(r.net_cents)}</TableCell>
                    <TableCell className="text-xs">{r.payment_method || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[r.status])}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-[10px] text-slate-400 max-w-[140px] truncate" title={r.stripe_transfer_id || ""}>
                      {r.stripe_transfer_id || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
