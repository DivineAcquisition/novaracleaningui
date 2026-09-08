"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiFlashlightLine, RiLoader4Line, RiRefreshLine } from "@remixicon/react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { callUrgentHire } from "@/lib/urgent-hire-client";
import { parseUrgentHireSettings, URGENT_HIRE_DEFAULTS, type UrgentHireSettings } from "@/lib/urgent-hire";
import { cn } from "@/lib/utils";

interface BroadcastRow {
  id: string;
  job_id: string;
  status: string;
  radius_miles: number;
  pay_percent: number;
  first_job_only: boolean;
  fill_deadline_at: string;
  eligible_count: number;
  reached_count: number;
  filled_at: string | null;
  unfilled_at: string | null;
  job_snapshot: {
    ref?: string;
    serviceType?: string;
    dateLabel?: string;
    zone?: string;
  } | null;
  created_at: string;
}

interface OfferRow {
  id: string;
  broadcast_id: string;
  applicant_name: string | null;
  status: string;
  distance_miles: number | null;
  had_valid_checklist: boolean;
  last_step: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
}

const STATUS_TONE: Record<string, string> = {
  open: "bg-violet-100 text-violet-800",
  sending: "bg-slate-100 text-slate-700",
  filled: "bg-emerald-100 text-emerald-800",
  unfilled: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

function elapsed(from: string, to: string | null) {
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return `${mins} min`;
  return `${(mins / 60).toFixed(1)} hr`;
}

export default function UrgentHireLog({ onChanged }: { onChanged?: () => void }) {
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [settings, setSettings] = useState<UrgentHireSettings>(URGENT_HIRE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [logRes, setRes] = await Promise.all([
      callUrgentHire<{ broadcasts: BroadcastRow[]; offers: OfferRow[] }>({ action: "log" }),
      callUrgentHire<{ settings: UrgentHireSettings }>({ action: "get_settings" }),
    ]);
    setLoading(false);
    if (!logRes.ok) return void toast.error(logRes.data.error || "Could not load Urgent Hire log.");
    setBroadcasts(logRes.data.broadcasts || []);
    setOffers(logRes.data.offers || []);
    if (setRes.ok && setRes.data.settings) setSettings(parseUrgentHireSettings(setRes.data.settings));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const offersByBroadcast = useMemo(() => {
    const map = new Map<string, OfferRow[]>();
    for (const o of offers) {
      const list = map.get(o.broadcast_id) || [];
      list.push(o);
      map.set(o.broadcast_id, list);
    }
    return map;
  }, [offers]);

  const unfilled = broadcasts.filter((b) => b.status === "unfilled");
  const open = broadcasts.filter((b) => b.status === "open" || b.status === "sending");

  const saveSettings = async () => {
    setSaving(true);
    const { ok, data } = await callUrgentHire({ action: "save_settings", settings });
    setSaving(false);
    if (!ok) return void toast.error(data.error || "Could not save settings.");
    toast.success("Urgent Hire settings saved.");
    onChanged?.();
  };

  const cancel = async (id: string) => {
    const { ok, data } = await callUrgentHire({ action: "cancel", broadcastId: id });
    if (!ok) return void toast.error(data.error || "Could not cancel.");
    toast.success("Broadcast cancelled. Applicants keep any onboarding progress.");
    void load();
  };

  return (
    <div className="space-y-4">
      {unfilled.length > 0 ? (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-900">Still needs coverage</CardTitle>
            <CardDescription className="text-xs text-red-800">
              Urgent Hire is one tool in the path, not a guaranteed fill. These windows closed with
              nobody accepting — tell the customer or try another option.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {unfilled.map((b) => (
              <div key={b.id} className="text-sm text-red-900">
                <span className="font-semibold">{b.job_snapshot?.ref || b.job_id.slice(0, 8)}</span>
                {" · "}
                {b.reached_count} reached · closed {elapsed(b.created_at, b.unfilled_at)} after send
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {open.length} open · {broadcasts.length} total
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {loading && broadcasts.length === 0 ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <RiLoader4Line className="h-4 w-4 animate-spin" />
          Loading log…
        </div>
      ) : broadcasts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-500">
            No Urgent Hire broadcasts yet. Launch one from Dispatch or a coverage card when the
            backup pool can&apos;t fill a job.
          </CardContent>
        </Card>
      ) : (
        broadcasts.map((b) => {
          const list = offersByBroadcast.get(b.id) || [];
          const progressed = list.filter((o) =>
            ["viewed", "progressing", "accepted"].includes(o.status),
          ).length;
          const winner = list.find((o) => o.status === "accepted");
          return (
            <Card key={b.id} className="border-slate-200">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      {b.job_snapshot?.ref || "Job"}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", STATUS_TONE[b.status] || STATUS_TONE.sending)}>
                        {b.status}
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {b.job_snapshot?.serviceType} · {b.job_snapshot?.dateLabel} · {b.job_snapshot?.zone}
                    </CardDescription>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <div>{b.reached_count}/{b.eligible_count} reached</div>
                    <div>{progressed} engaged</div>
                    <div>
                      {b.status === "filled"
                        ? `Filled in ${elapsed(b.created_at, b.filled_at)}`
                        : b.status === "unfilled"
                          ? `Unfilled after ${elapsed(b.created_at, b.unfilled_at)}`
                          : `Window ${elapsed(new Date().toISOString(), b.fill_deadline_at).replace(/^-/, "")} left`}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {winner ? (
                  <p className="text-sm text-emerald-800">
                    Filled by <span className="font-semibold">{winner.applicant_name}</span> at {b.pay_percent}%
                    {b.first_job_only ? " (first job only)" : ""}.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setExpanded((id) => (id === b.id ? null : b.id))}>
                    {expanded === b.id ? "Hide recipients" : `Recipients (${list.length})`}
                  </Button>
                  {b.status === "open" || b.status === "sending" ? (
                    <Button size="sm" variant="ghost" className="text-slate-600" onClick={() => void cancel(b.id)}>
                      Cancel broadcast
                    </Button>
                  ) : null}
                </div>
                {expanded === b.id ? (
                  <ul className="divide-y rounded-md border border-slate-200 text-xs">
                    {list.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                        <span className="font-medium text-slate-800">{o.applicant_name || "Applicant"}</span>
                        <span className="text-slate-500">
                          {o.status}
                          {o.distance_miles != null ? ` · ${Number(o.distance_miles).toFixed(1)} mi` : ""}
                          {o.had_valid_checklist ? "" : " · checklist pending"}
                          {o.last_step ? ` · on ${o.last_step}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          );
        })
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RiFlashlightLine className="h-4 w-4 text-violet-700" />
            Urgent Hire settings
          </CardTitle>
          <CardDescription className="text-xs">
            Radius uses the same geo-matching as normal dispatch. The 45% figure and first-job-only
            framing are both configurable. Background check stays off for this pathway.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Radius (miles)</Label>
            <Input
              inputMode="numeric"
              value={String(settings.radius_miles)}
              onChange={(e) =>
                setSettings((s) => ({ ...s, radius_miles: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 }))
              }
            />
            <p className="text-[11px] text-slate-500">Default 25 (spec range 20–30).</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Premium pay %</Label>
            <Input
              inputMode="numeric"
              value={String(settings.pay_percent)}
              onChange={(e) =>
                setSettings((s) => ({ ...s, pay_percent: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fill window (minutes)</Label>
            <Input
              inputMode="numeric"
              value={String(settings.fill_window_minutes)}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  fill_window_minutes: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                }))
              }
            />
            <p className="text-[11px] text-slate-500">Unfilled windows surface back here as still needing coverage.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Supply checklist freshness (days)</Label>
            <Input
              inputMode="numeric"
              value={String(settings.checklist_freshness_days)}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  checklist_freshness_days: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                }))
              }
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              checked={settings.first_job_only}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, first_job_only: v }))}
            />
            <span className="text-xs text-slate-700">
              State and enforce this rate as first-job-only (standing tier after)
            </span>
          </div>
          <div className="sm:col-span-2">
            <Button size="sm" onClick={() => void saveSettings()} disabled={saving}>
              {saving ? <RiLoader4Line className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
