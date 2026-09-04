"use client";

// ─── /admin/pnl ──────────────────────────────────────────────────────────────
//
// Live money picture that used to exist only in the branded Google Sheet.
// Collected = completed jobs. Pipeline = booked and not yet done (so Facebook
// jobs show up before they finish). Contribution = job profit − ads − paid
// expenses. The sheet is a one-way mirror of the same numbers.

import {
  RiExternalLinkLine,
  RiLineChartLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import ExpensesTab from "@/components/admin/payroll/ExpensesTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  dollars,
  formatRoas,
  sumMonths,
  type PnlAdRow,
  type PnlExpense,
  type PnlJobRow,
  type PnlMonth,
} from "@/lib/pnl";
import { cn } from "@/lib/utils";

type PnlResponse = {
  ok: boolean;
  error?: string;
  todayYmd: string;
  since: string;
  sheetUrl: string | null;
  months: PnlMonth[];
  selectedMonth: string;
  jobs: PnlJobRow[];
  ads: PnlAdRow[];
  expenses: PnlExpense[];
};

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-blue-100 text-blue-800 border-blue-200",
  confirmed: "bg-violet-100 text-violet-800 border-violet-200",
  assigned: "bg-indigo-100 text-indigo-800 border-indigo-200",
  pending_payment: "bg-amber-100 text-amber-800 border-amber-200",
  pending_details: "bg-slate-100 text-slate-700 border-slate-200",
};

function prettyStatus(status: string) {
  return status.replace(/_/g, " ");
}

function prettyService(s: string) {
  if (s === "moveInOut" || s === "move_in_out") return "Move-in/out";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  };
}

export default function AdminPnl() {
  const [month, setMonth] = useState("");
  const [data, setData] = useState<PnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextMonth?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = nextMonth ? `?month=${encodeURIComponent(nextMonth)}` : "";
      const res = await fetch(`/api/admin/pnl${q}`, { headers: await authHeaders() });
      const json = (await res.json().catch(() => ({}))) as PnlResponse;
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not load P&L");
      setData(json);
      setMonth(json.selectedMonth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load P&L");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => {
    if (!data) return null;
    if (data.selectedMonth === "all") return sumMonths(data.months);
    return data.months.find((m) => m.month === data.selectedMonth) || null;
  }, [data]);

  const facebook = (data?.ads || []).filter((a) => /facebook|meta/i.test(a.platform));

  const syncSheet = async () => {
    if (
      !window.confirm(
        "Overwrite the Google Sheet Daily Log, Expenses, Ad Spend, and EOD tabs with live Supabase numbers?",
      )
    ) {
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/pnl", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "sync_sheet" }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; jobs?: number };
      if (!res.ok || json.ok === false) throw new Error(json.error || "Sheet sync failed");
      toast.success(`Sheet updated (${json.jobs ?? 0} completed jobs).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sheet sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-[#5C0FFE]">Reporting</p>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight">Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Collected jobs, still-booked pipeline, ad spend, and contribution — Eastern Time, from
            May 2026 on. The Google Sheet is a mirror of these numbers, not the source.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-500" htmlFor="pnl-month">
            Month
          </label>
          <select
            id="pnl-month"
            aria-label="Month"
            className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
            value={month}
            disabled={loading || !data}
            onChange={(e) => void load(e.target.value)}
          >
            <option value="all">All months</option>
            {(data?.months || []).map((m) => (
              <option key={m.month} value={m.month}>
                {m.label}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(month || undefined)}>
            <RiRefreshLine className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          {data?.sheetUrl ? (
            <Button variant="outline" size="sm" asChild>
              <a href={data.sheetUrl} target="_blank" rel="noopener noreferrer">
                <RiExternalLinkLine className="w-4 h-4 mr-1.5" />
                Open Google Sheet
              </a>
            </Button>
          ) : null}
          <Button size="sm" className="bg-[#5C0FFE] hover:bg-[#4c0cd4] text-white" disabled={syncing} onClick={() => void syncSheet()}>
            {syncing ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiLineChartLine className="w-4 h-4 mr-1.5" />}
            Sync sheet
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-800">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi
          loading={loading}
          label="Collected"
          value={selected ? dollars(selected.collectedCents) : undefined}
          footer={selected ? `${selected.completedJobs} completed jobs` : undefined}
        />
        <Kpi
          loading={loading}
          label="Pipeline"
          value={selected ? dollars(selected.pipelineCents) : undefined}
          footer={selected ? `${selected.pipelineJobs} booked, not done` : undefined}
        />
        <Kpi
          loading={loading}
          label="Job profit"
          value={selected ? dollars(selected.jobProfitCents) : undefined}
          footer={selected ? `${dollars(selected.cleanerPayCents)} cleaner pay` : undefined}
        />
        <Kpi
          loading={loading}
          label="Ad spend"
          value={selected ? dollars(selected.adSpendCents) : undefined}
          footer="Logged in Ad Spend"
        />
        <Kpi
          loading={loading}
          label="Contribution"
          value={selected ? dollars(selected.contributionCents) : undefined}
          footer="Profit − ads − paid expenses"
          negative={(selected?.contributionCents || 0) < 0}
        />
        <Kpi
          loading={loading}
          label="Booked ROAS"
          value={selected ? formatRoas(selected.bookedRoas) : undefined}
          footer={`Collected ${selected ? formatRoas(selected.collectedRoas) : "—"}`}
        />
      </div>

      {facebook.length > 0 && selected ? (
        <Card className="border-violet-200 bg-violet-50/50">
          <CardContent className="p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">Facebook / Meta in this view</p>
            <p className="mt-1">
              {facebook
                .map((a) => `${a.date}: ${dollars(a.spend_cents)}${a.leads_calls != null ? ` · ${a.leads_calls} leads` : ""}${a.booked_jobs != null ? ` · ${a.booked_jobs} booked` : ""}`)
                .join(" · ")}
              . Booked ROAS uses collected + pipeline so jobs that are on the calendar (not yet
              completed) still count.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By month</CardTitle>
          <CardDescription>Completed revenue vs still-booked pipeline. Empty months stay visible.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Pipeline</TableHead>
                  <TableHead className="text-right">Job profit</TableHead>
                  <TableHead className="text-right">Ads</TableHead>
                  <TableHead className="text-right">Contribution</TableHead>
                  <TableHead className="text-right">Booked ROAS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.months || []).map((m) => (
                  <TableRow
                    key={m.month}
                    className={cn("cursor-pointer", m.month === data?.selectedMonth && "bg-brand-50/70")}
                    onClick={() => void load(m.month)}
                  >
                    <TableCell className="font-medium">{m.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(m.collectedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(m.pipelineCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(m.jobProfitCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(m.adSpendCents)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        m.contributionCents < 0 ? "text-rose-700" : "text-slate-900",
                      )}
                    >
                      {dollars(m.contributionCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRoas(m.bookedRoas)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Jobs</CardTitle>
            <CardDescription>
              Completed jobs count as collected. Confirmed / assigned / awaiting payment sit in
              pipeline until they finish. Re-cleans are $0.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : !data?.jobs.length ? (
              <p className="text-sm text-slate-500 py-8 text-center">No jobs in this month.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="font-mono text-xs text-slate-500">{j.serviceDate}</TableCell>
                      <TableCell>
                        <Link href="/admin/bookings" className="font-medium text-primary hover:underline">
                          {j.ref}
                        </Link>
                        <p className="text-[11px] text-slate-500">{prettyService(j.serviceType)}</p>
                      </TableCell>
                      <TableCell>{j.client}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] uppercase tracking-wide", STATUS_STYLE[j.status])}
                        >
                          {j.reclean ? "re-clean" : j.pipeline ? "pipeline" : prettyStatus(j.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{dollars(j.revenueCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {j.pipeline ? "—" : dollars(j.profitCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ad spend</CardTitle>
            <CardDescription>From the monthly ad-spend log. Empty months are not invented.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : !data?.ads.length ? (
              <p className="text-sm text-slate-500 py-8 text-center">No ad spend logged in this view.</p>
            ) : (
              <ul className="space-y-2">
                {data.ads.map((a) => (
                  <li key={`${a.date}|${a.platform}`} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{a.platform}</p>
                      <p className="text-sm tabular-nums font-semibold">{dollars(a.spend_cents)}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {a.date}
                      {a.leads_calls != null ? ` · ${a.leads_calls} leads` : ""}
                      {a.booked_jobs != null ? ` · ${a.booked_jobs} booked` : ""}
                      {` · booked ${formatRoas(a.bookedRoas)}`}
                    </p>
                    {a.campaign_notes ? <p className="text-xs text-slate-600 mt-1">{a.campaign_notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="font-jakarta text-lg font-semibold text-slate-900 mb-2">Expenses &amp; reimbursements</h2>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">
          Promised stays off profit. Flip to Paid when the money has actually moved — that is when
          it hits contribution.
        </p>
        <ExpensesTab onChanged={() => void load(month || undefined)} />
      </div>
    </div>
  );
}

function Kpi({
  loading,
  label,
  value,
  footer,
  negative,
}: {
  loading: boolean;
  label: string;
  value?: string;
  footer?: string;
  negative?: boolean;
}) {
  return (
    <Card className="panel">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-20 mt-1" />
        ) : (
          <p className={cn("text-xl font-heading font-bold truncate mt-1", negative ? "text-rose-700" : "text-foreground")}>
            {value ?? "—"}
          </p>
        )}
        {footer ? <p className="text-[11px] text-muted-foreground mt-2 truncate">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}
