"use client";

// Weekly Sales, Retention & Growth reports. Generation runs in the
// weekly-report-generate edge function (cron + on demand). This page lists
// history, opens the PDF, and lets admin change the Monday-morning window.

import {
  RiExternalLinkLine,
  RiFileChartLine,
  RiLoader4Line,
  RiPlayLine,
  RiRefreshLine,
  RiSettings3Line,
} from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type ReportRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  trigger: string;
  executive_summary: string | null;
  insight_model: string | null;
  insight_model_version: string | null;
  insights: Array<{ observation: string; numbers: string; hypothesis: string }>;
  watch_list: string[];
  unavailable_sources: string[];
  metrics?: {
    metrics?: Array<{ key: string; current?: { value: number | null; available: boolean } }>;
  };
  pdf_path: string | null;
  pdf_last_error: string | null;
  drive_url: string | null;
  generated_at: string | null;
  created_at: string;
};

type Settings = {
  enabled: boolean;
  timezone: string;
  run_weekday: number;
  run_hour: number;
  recipients: string[];
  max_insights: number;
  drive_root_folder_id: string;
  drive_folder_name: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(0)}`;
}

export default function WeeklyReport() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, invoked] = await Promise.all([
      (supabase as any)
        .from("weekly_reports")
        .select(
          "id, period_start, period_end, status, trigger, executive_summary, insight_model, insight_model_version, insights, watch_list, unavailable_sources, pdf_path, pdf_last_error, drive_url, generated_at, created_at, metrics",
        )
        .order("period_start", { ascending: false })
        .limit(24),
      supabase.functions.invoke("weekly-report-generate", { body: { action: "get_settings" } }),
    ]);
    if (error) toast.error(error.message);
    setRows((data || []) as ReportRow[]);
    if (!invoked.error && invoked.data?.settings) setSettings(invoked.data.settings as Settings);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invoke = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-report-generate", { body });
      if (error) throw error;
      if (data?.error && !data?.ok) throw new Error(data.error);
      toast.success(okMsg);
      await load();
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (row: ReportRow) => {
    if (row.drive_url) {
      window.open(row.drive_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!row.pdf_path) {
      toast.error("No PDF stored for this report yet.");
      return;
    }
    const { data, error } = await supabase.storage.from("weekly-reports").createSignedUrl(row.pdf_path, 3600);
    if (error || !data?.signedUrl) {
      toast.error(error?.message || "Could not sign PDF URL");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const saveSettings = async () => {
    if (!settings) return;
    await invoke({ action: "save_settings", settings }, "Schedule saved");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-[#5C0FFE]">Reporting</p>
          <h2 className="font-jakarta text-xl font-semibold text-slate-900 mt-0.5">
            Weekly Sales, Retention &amp; Growth
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Auto-generated Monday morning covering the prior Mon–Sun. Every figure is pulled from
            live systems; missing sources show as unavailable. Insights cite those numbers and do
            not change budgets or pricing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}>
            <RiSettings3Line className="w-4 h-4 mr-1.5" />
            Schedule
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
            <RiRefreshLine className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            disabled={busy}
            className="bg-[#5C0FFE] hover:bg-[#4c0cd4] text-white"
            onClick={() => void invoke({ action: "generate", force: true }, "Report generated")}
          >
            {busy ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiPlayLine className="w-4 h-4 mr-1.5" />}
            Generate last week
          </Button>
        </div>
      </div>

      {showSettings && settings && (
        <Card className="p-4 space-y-3 border-slate-200">
          <p className="text-sm font-semibold text-slate-900">When it runs</p>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-xs text-slate-600 space-y-1">
              <span>Weekday</span>
              <select
                className="w-full h-9 rounded-md border border-slate-200 px-2 text-sm"
                value={settings.run_weekday}
                onChange={(e) => setSettings({ ...settings, run_weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600 space-y-1">
              <span>Hour ({settings.timezone})</span>
              <Input
                type="number"
                min={0}
                max={23}
                value={settings.run_hour}
                onChange={(e) => setSettings({ ...settings, run_hour: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-end gap-2 text-sm text-slate-700 pb-1">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>
          <label className="text-xs text-slate-600 space-y-1 block">
            <span>Email recipients (comma-separated)</span>
            <Input
              value={settings.recipients.join(", ")}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  recipients: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
            />
          </label>
          <p className="text-xs text-slate-500">
            Drive folder: {settings.drive_folder_name || "NVC WeekLt Report & Forcast"}
          </p>
          <Button size="sm" onClick={() => void saveSettings()} disabled={busy}>
            Save schedule
          </Button>
        </Card>
      )}

      <Card className="p-4 border-slate-200 space-y-3">
        <Label className="text-xs text-slate-500">On-demand custom range (Mon–Sun recommended)</Label>
        <div className="flex flex-wrap gap-2 items-end">
          <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-40" />
          <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-40" />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !periodStart || !periodEnd}
            onClick={() =>
              void invoke(
                { action: "generate", force: true, periodStart, periodEnd },
                "Custom-range report generated",
              )
            }
          >
            Generate range
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500">Loading reports…</p>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500 border-dashed">
          No weekly reports yet. Generate last week to create the first PDF, or wait for Monday morning.
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const open = openId === row.id;
            const snap = row.metrics;
            const pick = (key: string) => snap?.metrics?.find((m) => m.key === key)?.current;
            return (
              <Card key={row.id} className="border-slate-200 overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left p-4 flex items-start gap-3"
                  onClick={() => setOpenId(open ? null : row.id)}
                >
                  <span className="w-9 h-9 rounded-lg bg-[#5C0FFE]/10 text-[#5C0FFE] inline-flex items-center justify-center shrink-0">
                    <RiFileChartLine className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">
                        {row.period_start} → {row.period_end}
                      </p>
                      <Badge variant="secondary" className={cn(
                        "capitalize",
                        row.status === "generated" && "bg-emerald-50 text-emerald-700",
                        row.status === "failed" && "bg-rose-50 text-rose-700",
                        row.status === "drive_pending" && "bg-amber-50 text-amber-800",
                      )}>
                        {row.status.replace("_", " ")}
                      </Badge>
                      <span className="text-[11px] text-slate-400">{row.trigger.replace("_", " ")}</span>
                    </div>
                    <p className="text-sm text-slate-600 mt-1 line-clamp-2">
                      {row.executive_summary || row.pdf_last_error || "Generating…"}
                    </p>
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void openPdf(row)}>
                        <RiExternalLinkLine className="w-4 h-4 mr-1.5" />
                        Open PDF
                      </Button>
                      {row.drive_url && (
                        <a
                          href={row.drive_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-[#5C0FFE] underline self-center"
                        >
                          Drive copy
                        </a>
                      )}
                    </div>
                    {pick && (
                      <p className="text-xs text-slate-500">
                        Booked {money(pick("revenue_booked_cents")?.available ? pick("revenue_booked_cents")?.value : null)}
                        {" · "}
                        Collected {money(pick("revenue_collected_cents")?.available ? pick("revenue_collected_cents")?.value : null)}
                        {" · "}
                        Bookings {pick("bookings_made")?.available ? pick("bookings_made")?.value : "unavailable"}
                      </p>
                    )}
                    {Array.isArray(row.insights) && row.insights.length > 0 && (
                      <ul className="space-y-2">
                        {row.insights.slice(0, 8).map((ins, i) => (
                          <li key={i} className="text-sm text-slate-700">
                            <span className="font-medium">{ins.observation}</span>
                            {" — "}
                            <span className="text-slate-500">{ins.numbers}</span>
                            {" — "}
                            <span>{ins.hypothesis}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.unavailable_sources?.length > 0 && (
                      <p className="text-xs text-amber-800">
                        Unavailable: {row.unavailable_sources.join(", ")}
                      </p>
                    )}
                    {row.insight_model && (
                      <p className="text-[11px] text-slate-400">
                        Insight model {row.insight_model}
                        {row.insight_model_version ? ` (${row.insight_model_version})` : ""}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
