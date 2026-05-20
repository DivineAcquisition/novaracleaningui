"use client";

import { useState, useEffect, useCallback } from "react";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RiDownloadLine, RiRefreshLine } from "@remixicon/react";

type ReportKey =
  | "daily"
  | "weekly"
  | "monthly"
  | "funnel"
  | "recurring"
  | "payroll"
  | "heatmap_leads"
  | "heatmap_bookings"
  | "heatmap_cleaners"
  | "compliance";

interface ReportConfig {
  key: ReportKey;
  label: string;
  description: string;
  needsRange: boolean;
}

const REPORTS: ReportConfig[] = [
  { key: "daily", label: "Daily Metrics", description: "Day-by-day funnel: leads, SMS, bookings, revenue.", needsRange: true },
  { key: "weekly", label: "Weekly", description: "52-week rollup of every funnel metric.", needsRange: false },
  { key: "monthly", label: "Monthly + Conversion", description: "Monthly metrics with conversion%.", needsRange: false },
  { key: "funnel", label: "Lead Funnel by Source", description: "Per-source conversion over 180 days.", needsRange: false },
  { key: "recurring", label: "Recurring Customers", description: "Active / paused / at-risk / churned with LTV.", needsRange: false },
  { key: "payroll", label: "Cleaner Payroll", description: "Pay-period earnings per cleaner. Read-only; does NOT execute payouts.", needsRange: true },
  { key: "heatmap_leads", label: "Heatmap: Leads by ZIP", description: "Lead volume + no-response density.", needsRange: true },
  { key: "heatmap_bookings", label: "Heatmap: Bookings by ZIP", description: "Booking count + revenue.", needsRange: true },
  { key: "heatmap_cleaners", label: "Heatmap: Cleaner Density", description: "Active cleaners per ZIP.", needsRange: false },
  { key: "compliance", label: "Compliance Alerts", description: "Cleaners with expiring background/insurance.", needsRange: false },
];

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") {
    return value.toLocaleString();
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return format(new Date(value), "MMM d, yyyy h:mm a");
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return format(new Date(value + "T00:00:00"), "MMM d, yyyy");
  }
  return String(value);
}

function maybeCents(key: string, value: unknown): string {
  if (typeof value !== "number") return formatCell(value);
  if (/_cents$/.test(key)) return `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (/^revenue|gross|net|fee/.test(key) && key.includes("cents")) return `$${(value / 100).toLocaleString()}`;
  return value.toLocaleString();
}

export default function AdminReports() {
  const [active, setActive] = useState<ReportKey>("daily");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [error, setError] = useState<string | null>(null);

  const config = REPORTS.find((r) => r.key === active) ?? REPORTS[0];

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      if (config.needsRange || active === "compliance") {
        params.start = startDate;
        params.end = endDate;
      }
      if (active === "compliance") params.flag = "expiring_soon";
      const { data, error: invokeErr } = await supabase.functions.invoke("report-export", {
        body: { report: active, format: "json", params },
      });
      if (invokeErr) throw invokeErr;
      const resp = data as { rows?: Record<string, unknown>[]; error?: string };
      if (resp.error) throw new Error(resp.error);
      setRows(resp.rows || []);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setRows([]);
      toast.error(`Report failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [active, config, startDate, endDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const downloadCsv = async () => {
    try {
      const params: Record<string, unknown> = {};
      if (config.needsRange || active === "compliance") {
        params.start = startDate;
        params.end = endDate;
      }
      if (active === "compliance") params.flag = "expiring_soon";
      const { data, error: invokeErr } = await supabase.functions.invoke("report-export", {
        body: { report: active, format: "csv", params },
      });
      if (invokeErr) throw invokeErr;
      const csv = (data as { csv?: string }).csv ?? "";
      if (!csv) {
        toast.warning("Report is empty.");
        return;
      }
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `novara-${active}-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded.");
    } catch (e) {
      toast.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-7xl">
        <header>
          <h1 className="text-2xl font-bold text-white">Reports</h1>
          <p className="text-sm text-slate-400 mt-1">Phase 5: all reads from the canonical reporting views/RPCs. CSV export available for every report.</p>
        </header>

        <Tabs value={active} onValueChange={(v) => setActive(v as ReportKey)}>
          <TabsList className="bg-slate-900 border border-white/10 flex-wrap h-auto">
            {REPORTS.map((r) => (
              <TabsTrigger key={r.key} value={r.key} className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-300">
                {r.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {REPORTS.map((r) => (
            <TabsContent key={r.key} value={r.key} className="mt-4">
              <Card className="bg-slate-900 border-white/10">
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-white">{r.label}</CardTitle>
                    <p className="text-sm text-slate-400 mt-1">{r.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(r.needsRange || r.key === "compliance") && (
                      <>
                        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-800 border-white/10 text-white w-40" />
                        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-800 border-white/10 text-white w-40" />
                      </>
                    )}
                    <Button onClick={fetchReport} variant="outline" size="sm" className="border-white/10 text-slate-200 hover:bg-white/5">
                      <RiRefreshLine className="w-4 h-4 mr-1" /> Refresh
                    </Button>
                    <Button onClick={downloadCsv} size="sm" className="bg-amber-500 text-slate-950 hover:bg-amber-400">
                      <RiDownloadLine className="w-4 h-4 mr-1" /> CSV
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-sm mb-3">{error}</div>
                  )}
                  {loading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 bg-slate-800" />
                      ))}
                    </div>
                  ) : rows.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4">No rows for the selected range.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <Badge variant="outline" className="border-amber-500/30 text-amber-300">{rows.length} rows</Badge>
                      </div>
                      <div className="overflow-x-auto border border-white/10 rounded-lg">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-800/50">
                            <tr>
                              {headers.map((h) => (
                                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-300 uppercase tracking-wide whitespace-nowrap">
                                  {h.replace(/_/g, " ")}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {rows.map((row, i) => (
                              <tr key={i} className="hover:bg-slate-800/40">
                                {headers.map((h) => (
                                  <td key={h} className="px-3 py-2 text-slate-200 whitespace-nowrap">
                                    {maybeCents(h, row[h])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
