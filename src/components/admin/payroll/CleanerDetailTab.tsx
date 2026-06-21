"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd, formatPeriod, payPctForTier } from "@/lib/payroll";
import { type PayrollCleaner, type PayrollRunRow, cleanerName, STATUS_TONE } from "./shared";

export default function CleanerDetailTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [cleanerId, setCleanerId] = useState<string>(cleaners[0]?.id || "");
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const cleaner = useMemo(() => cleaners.find((c) => c.id === cleanerId), [cleaners, cleanerId]);

  useEffect(() => {
    if (!cleanerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // deno-lint-ignore no-explicit-any
        const { data, error } = await (supabase.from as any)("payroll_runs").select("*").eq("cleaner_id", cleanerId)
          .order("pay_period_start", { ascending: false });
        if (error) throw error;
        if (!cancelled) setRuns((data || []) as unknown as PayrollRunRow[]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cleanerId]);

  const stats = useMemo(() => {
    const paid = runs.filter((r) => ["sent", "cleared"].includes(r.status));
    const lifetime = paid.reduce((a, r) => a + (r.net_cents || 0), 0);
    const jobs = runs.reduce((a, r) => a + (r.total_jobs || 0), 0);
    const last = paid.map((r) => r.sent_at).filter(Boolean).sort().reverse()[0] || null;
    return { lifetime, jobs, last, runCount: runs.length };
  }, [runs]);

  return (
    <div className="space-y-5">
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-slate-600">Cleaner</p>
          <Select value={cleanerId} onValueChange={setCleanerId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select a cleaner" /></SelectTrigger>
            <SelectContent>
              {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{cleanerName(c)}</SelectItem>)}
            </SelectContent>
          </Select>
          {cleaner && (
            <span className="text-xs text-slate-500">
              {cleaner.pay_tier || "foundation"} · {cleaner.pay_percentage ?? payPctForTier(cleaner.pay_tier || "foundation")}% · {cleaner.payment_method || "stripe_connect"}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Lifetime paid" value={usd(stats.lifetime)} highlight />
        <Tile label="Runs" value={String(stats.runCount)} />
        <Tile label="Total jobs" value={String(stats.jobs)} />
        <Tile label="Last payout" value={stats.last ? new Date(stats.last).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"} />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3"><CardTitle className="text-base">Run history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : runs.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No runs for this cleaner yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead>Cleared</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs">{formatPeriod(r.pay_period_start)}</TableCell>
                      <TableCell className="text-right text-sm">{r.total_jobs}</TableCell>
                      <TableCell className="text-right text-sm">{usd(r.gross_cents)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-violet-700">{usd(r.net_cents)}</TableCell>
                      <TableCell><Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[r.status])}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-500">{r.sent_at ? new Date(r.sent_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs text-slate-500">{r.cleared_at ? new Date(r.cleared_at).toLocaleDateString() : "—"}</TableCell>
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
