"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usd } from "@/lib/payroll";
import { type PayrollCleaner, type PayoutLedgerRow, loadPayoutLedger, STATUS_TONE } from "./shared";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

export default function RunsTab({ cleaners }: { cleaners: PayrollCleaner[] }) {
  const [rows, setRows] = useState<PayoutLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [cleanerId, setCleanerId] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await loadPayoutLedger());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load payouts");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (cleanerId !== "all" && r.cleanerId !== cleanerId) return false;
    return true;
  }), [rows, status, cleanerId]);

  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.status).filter(Boolean))) as string[], [rows]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Payout history ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={cleanerId} onValueChange={setCleanerId}>
              <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cleaners</SelectItem>
                {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{`${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner"}</SelectItem>)}
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
          <div className="p-10 text-center text-sm text-slate-500">No payouts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Job total</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transfer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50/60">
                    <TableCell className="text-xs">{fmtDate(r.processedAt || r.createdAt)}</TableCell>
                    <TableCell className="text-sm font-medium">{r.cleanerName}</TableCell>
                    <TableCell className="text-[11px] text-slate-500">{r.bookingNumber || "—"}</TableCell>
                    <TableCell className="text-right text-sm">{usd(r.totalBookingCents || 0)}</TableCell>
                    <TableCell className="text-right text-sm font-semibold text-violet-700">{usd(r.payoutCents || 0)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] capitalize", STATUS_TONE[r.status || ""] || "bg-slate-100 text-slate-700 border-slate-200")}>
                        {r.status || "—"}
                      </Badge>
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
  );
}
