"use client";

// Tax Forms (1099) — calendar-year NEC prep report for admin payroll.
// Aggregates every pay rail, flags the $600 threshold, and links to Stripe's
// Connect Tax Reporting dashboard for actual filing/delivery.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiDownloadLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiLoader4Line,
  RiRefreshLine,
  RiAlertLine,
  RiCheckboxCircleFill,
} from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { CleanerAgg, Tax1099Report } from "@/lib/payroll-1099";
import { reportToCsv } from "@/lib/payroll-1099";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const nameOf = (r: CleanerAgg) =>
  `${r.firstName || ""} ${r.lastName || ""}`.trim() || "Cleaner";

async function fetchReport(taxYear: number): Promise<Tax1099Report> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");
  const res = await fetch("/api/payroll/1099", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ taxYear }),
  });
  const json = await res.json();
  if (!res.ok || json?.error) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as Tax1099Report;
}

export default function Tax1099Tab() {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => [currentYear, currentYear - 1, currentYear - 2], [currentYear]);
  const [taxYear, setTaxYear] = useState(currentYear);
  const [report, setReport] = useState<Tax1099Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      else setRefreshing(true);
      try {
        const data = await fetchReport(taxYear);
        setReport(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load 1099 report");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [taxYear],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const downloadCsv = () => {
    if (!report) return;
    const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novara-1099-nec-prep-${report.taxYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !report) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-12 justify-center">
        <RiLoader4Line className="w-4 h-4 animate-spin" /> Building tax-year report…
      </div>
    );
  }

  const t = report?.totals;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-jakarta text-lg font-semibold text-slate-900 flex items-center gap-2">
            <RiFileTextLine className="w-5 h-5 text-slate-700" />
            Tax Forms (1099-NEC)
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Calendar-year contractor pay prep. File and deliver forms in Stripe Connect Tax Reporting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(Number(v))}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue placeholder="Tax year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load({ silent: true })} disabled={refreshing}>
            {refreshing ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : <RiRefreshLine className="w-4 h-4" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!report?.cleaners.length}>
            <RiDownloadLine className="w-4 h-4" />
            CSV
          </Button>
          <Button size="sm" asChild>
            <a href={report?.stripeTaxFormsUrl || "https://dashboard.stripe.com/connect/taxes/forms"} target="_blank" rel="noreferrer">
              <RiExternalLinkLine className="w-4 h-4" />
              Stripe Tax Forms
            </a>
          </Button>
        </div>
      </div>

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label={`Reportable (${taxYear})`} value={usd(t.reportableCents)} hint={`${t.cleanersPaid} cleaner${t.cleanersPaid === 1 ? "" : "s"}`} />
          <Kpi
            label="At / over $600"
            value={String(t.meetsNecThreshold)}
            hint="Likely 1099-NEC required"
            tone={t.meetsNecThreshold > 0 ? "amber" : "emerald"}
          />
          <Kpi
            label="On Stripe transfers"
            value={usd(t.stripeTrackedCents)}
            hint="Visible to Stripe Tax Reporting"
            tone="sky"
          />
          <Kpi
            label="Off-Connect ledger"
            value={usd(t.offConnectCents)}
            hint="Won’t auto-file in Stripe"
            tone={t.offConnectCents > 0 ? "rose" : "slate"}
          />
        </div>
      )}

      {t && t.offConnectCents > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex gap-2">
          <RiAlertLine className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="font-medium">Most Custom Payout rows are ledger-only</p>
            <p className="text-amber-900/80 mt-0.5 text-[13px] leading-relaxed">
              Marking a Custom Payout as paid does not create a Stripe Transfer. Stripe’s 1099 product only
              auto-counts Connect transfers. Import/adjust those amounts in{" "}
              <a
                className="underline underline-offset-2"
                href={report?.stripeTaxFormsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Stripe Tax Forms
              </a>{" "}
              (or file outside Stripe) using the CSV export. Extra Pay sent through Run Payroll is the
              Connect rail that Stripe will file automatically.
            </p>
          </div>
        </div>
      )}

      {t && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Source mix · {taxYear}</CardTitle>
            <CardDescription className="text-xs">
              Reimbursements excluded from reportable where identifiable ({usd(t.reimbursementCents)} tracked separately).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <SourceStat label="Connect payouts" cents={t.bySource.connect_payouts} />
            <SourceStat label="Custom payouts" cents={t.bySource.manual_payouts} />
            <SourceStat label="Payroll runs" cents={t.bySource.payroll_runs} />
            <SourceStat label="Extra pay" cents={t.bySource.extra_pay} />
            <SourceStat label="Tips" cents={t.bySource.tips} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contractors · tax year {taxYear}</CardTitle>
          <CardDescription className="text-xs">
            Federal 1099-NEC threshold is {usd(report?.necThresholdCents || 60_000)}. Configure payer details &amp; delivery in{" "}
            <a
              className="underline underline-offset-2"
              href={report?.stripeTaxSettingsUrl || "https://dashboard.stripe.com/settings/connect/tax_forms"}
              target="_blank"
              rel="noreferrer"
            >
              tax form settings
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!report?.cleaners.length ? (
            <p className="text-sm text-slate-500 py-8 text-center">No paid contractor compensation recorded for {taxYear}.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cleaner</TableHead>
                  <TableHead>Connect</TableHead>
                  <TableHead className="text-right">Reportable</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Stripe</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Off-Connect</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Reimb.</TableHead>
                  <TableHead>1099</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.cleaners.map((r) => (
                  <TableRow key={r.cleanerId}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{nameOf(r)}</div>
                      <div className="text-[11px] text-slate-400">{r.email || "—"}</div>
                    </TableCell>
                    <TableCell>
                      {r.payoutsEnabled ? (
                        <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">
                          <RiCheckboxCircleFill className="w-3 h-3 mr-1" /> Ready
                        </Badge>
                      ) : r.stripeAccountId ? (
                        <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50">
                          Incomplete
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500">
                          None
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{usd(r.reportableCents)}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-600 hidden md:table-cell">
                      {usd(r.stripeTrackedCents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums hidden md:table-cell",
                        r.offConnectCents > 0 ? "text-rose-700" : "text-slate-600",
                      )}
                    >
                      {usd(r.offConnectCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500 hidden lg:table-cell">
                      {usd(r.reimbursementCents)}
                    </TableCell>
                    <TableCell>
                      {r.meetsNecThreshold ? (
                        <Badge className="bg-amber-600 hover:bg-amber-600">File NEC</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">Under $600</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {report?.notes?.length ? (
        <ul className="text-[12px] text-slate-500 space-y-1.5 list-disc pl-5">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "slate" | "emerald" | "amber" | "sky" | "rose";
}) {
  const toneCls = {
    slate: "bg-slate-50 border-slate-200",
    emerald: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50 border-amber-200",
    sky: "bg-sky-50 border-sky-200",
    rose: "bg-rose-50 border-rose-200",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-3 py-3", toneCls)}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-medium">{label}</p>
      <p className="text-lg font-semibold text-slate-900 tabular-nums mt-0.5">{value}</p>
      {hint ? <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p> : null}
    </div>
  );
}

function SourceStat({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="font-medium tabular-nums text-slate-900">{usd(cents)}</p>
    </div>
  );
}
