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
import { usd, payPctForTier } from "@/lib/payroll";
import { type PayrollCleaner, type PayoutLedgerRow, cleanerName, loadPayoutLedger, STATUS_TONE } from "./shared";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Aggregate {
  jobs_completed?: number;
  paid_cents?: number;
  owed_cents?: number;
  processing_cents?: number;
  last_paid_at?: string | null;
}

export default function CleanerDetailTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [cleanerId, setCleanerId] = useState<string>(cleaners[0]?.id || "");
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [ledger, setLedger] = useState<PayoutLedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const cleaner = useMemo(() => cleaners.find((c) => c.id === cleanerId), [cleaners, cleanerId]);

  useEffect(() => { if (!cleanerId && cleaners[0]) setCleanerId(cleaners[0].id); }, [cleaners, cleanerId]);

  useEffect(() => {
    if (!cleanerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: aggRow }, all] = await Promise.all([
          supabase.from("cleaner_payroll_v1" as never).select("*").eq("cleaner_id", cleanerId).maybeSingle(),
          loadPayoutLedger(),
        ]);
        if (cancelled) return;
        setAgg((aggRow || null) as unknown as Aggregate);
        setLedger(all.filter((p) => p.cleanerId === cleanerId));
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [cleanerId]);

  return (
    <div className="space-y-5">
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-slate-600">Cleaner</p>
          <Select value={cleanerId} onValueChange={setCleanerId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select a cleaner" /></SelectTrigger>
            <SelectContent>{cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{cleanerName(c)}</SelectItem>)}</SelectContent>
          </Select>
          {cleaner && (
            <span className="text-xs text-slate-500">
              {cleaner.pay_tier || "foundation"} · {cleaner.pay_percentage ?? payPctForTier(cleaner.pay_tier || "foundation")}% · {cleaner.payment_method || "stripe_connect"}
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Lifetime paid" value={usd(agg?.paid_cents || 0)} highlight />
        <Tile label="Owed now" value={usd(agg?.owed_cents || 0)} />
        <Tile label="Jobs completed" value={String(agg?.jobs_completed || 0)} />
        <Tile label="Last payout" value={fmtDate(agg?.last_paid_at || null)} />
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3"><CardTitle className="text-base">Payout history</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : ledger.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No payouts for this cleaner yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead className="text-right">Payout</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Transfer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50/60">
                      <TableCell className="text-xs">{fmtDate(r.processedAt || r.createdAt)}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{r.bookingNumber || "—"}</TableCell>
                      <TableCell className="text-right text-sm font-semibold text-violet-700">{usd(r.payoutCents || 0)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[r.status || ""] || "bg-slate-100 text-slate-700 border-slate-200")}>{r.status || "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-[10px] text-slate-400 max-w-[150px] truncate" title={r.stripeTransferId || ""}>{r.stripeTransferId || "—"}</TableCell>
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
