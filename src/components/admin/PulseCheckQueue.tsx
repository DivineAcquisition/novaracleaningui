"use client";

import { RiAlarmWarningLine, RiLoader4Line, RiPlayLine, RiRefreshLine } from "@remixicon/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { describeEdgeError } from "@/lib/edge-invoke";
import {
  DEFAULT_PULSE_CHECK_SETTINGS,
  type PulseCheckSettings,
} from "@/lib/pulse-check/settings";

interface PulseRow {
  entry_id: string;
  cycle_id: string;
  cycle_started_at: string;
  cleaner_id: string;
  cleaner_name: string | null;
  email: string | null;
  phone: string | null;
  outcome: string;
  sent_at: string | null;
  followup_sent_at: string | null;
  opened_at: string | null;
  submitted_at: string | null;
  answers: Record<string, unknown> | null;
  claimed_job_count: number;
  availability_updated: boolean;
  admin_reviewed_at: string | null;
  admin_note: string | null;
}

function authHeaders(): Promise<HeadersInit> {
  return supabase.auth.getSession().then(({ data }) => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.session?.access_token || ""}`,
  }));
}

function outcomeBadge(outcome: string) {
  if (outcome === "completed") return <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">completed</Badge>;
  if (outcome === "needs_review") return <Badge variant="destructive" className="text-[10px]">needs review</Badge>;
  if (outcome === "no_response") return <Badge variant="outline" className="text-[10px]">no response</Badge>;
  return <Badge variant="outline" className="text-[10px]">pending</Badge>;
}

function answerLine(answers: Record<string, unknown> | null): string {
  if (!answers) return "";
  const status = String(answers.status || "");
  const ability = String(answers.ability || "");
  const note = String(answers.abilityNote || answers.ability_note || "").trim();
  const bits = [
    status === "still_active" ? "still active" : status === "step_away" ? "stepping away" : status === "not_sure" ? "wants to talk" : "",
    ability === "blocked" ? "not able to work" : ability === "able" ? "able to work" : "",
    note ? `“${note.slice(0, 80)}”` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

export default function PulseCheckQueue({
  onSelectCleaner,
}: {
  onSelectCleaner?: (cleanerId: string) => void;
}) {
  const [rows, setRows] = useState<PulseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PulseCheckSettings>(DEFAULT_PULSE_CHECK_SETTINGS);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await (supabase.from as any)("cleaner_pulse_status_v1")
      .select("*")
      .order("cycle_started_at", { ascending: false })
      .order("outcome", { ascending: true })
      .limit(200);
    setLoadError(error ? error.message || "Couldn't load pulse checks." : null);
    setRows(error ? [] : ((data || []) as PulseRow[]));
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/pulse-check", { headers, cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (json?.settings) setSettings(json.settings);
    } catch {
      /* settings are optional on first paint */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async () => {
    setBusy("settings");
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/pulse-check", {
        method: "PUT",
        headers,
        body: JSON.stringify({ settings }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not save settings");
      if (json.settings) setSettings(json.settings);
      toast.success("Pulse check settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy("run");
    try {
      const { data, error } = await supabase.functions.invoke("pulse-check-runner", {
        body: { force: true, source: "admin" },
      });
      if (error) throw new Error(await describeEdgeError(error, data));
      const d = (data || {}) as { error?: string; sent?: number; qualified?: number; skippedCycle?: boolean };
      if (d.error) throw new Error(d.error);
      toast.success(
        d.skippedCycle
          ? "Follow-ups ran. A new cycle wasn't due yet."
          : `Cycle sent to ${d.sent ?? 0} of ${d.qualified ?? 0} idle contractors`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run pulse check");
    } finally {
      setBusy(null);
    }
  };

  const markReviewed = async (entryId: string) => {
    setBusy(entryId);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/pulse-check", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "review", entryId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not mark reviewed");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mark reviewed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;

  const latestCycleId = rows[0]?.cycle_id || null;
  const latest = latestCycleId ? rows.filter((r) => r.cycle_id === latestCycleId) : [];
  const review = latest.filter((r) => r.outcome === "needs_review" || r.outcome === "no_response");

  return (
    <Card className="border-sky-200 bg-sky-50/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-950">
            <RiAlarmWarningLine className="h-4 w-4" />
            Pulse check
            {latest.length > 0 ? (
              <span className="font-normal text-sky-800">
                · {latest.length} in this cycle
                {review.length ? ` · ${review.length} need a human look` : ""}
              </span>
            ) : (
              <span className="font-normal text-sky-800">· no cycle has run yet</span>
            )}
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy !== null}>
              <RiRefreshLine className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => void runNow()} disabled={busy !== null}>
              {busy === "run" ? (
                <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <RiPlayLine className="mr-1 h-3.5 w-3.5" /> Run cycle now
                </>
              )}
            </Button>
          </div>
        </div>

        {loadError ? (
          <p className="text-xs text-rose-800">{loadError} — treat this as unknown rather than clear.</p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[11px] text-slate-600">
            Cycle (days)
            <Input
              type="number"
              min={1}
              max={90}
              value={settings.interval_days}
              onChange={(e) => setSettings((s) => ({ ...s, interval_days: Number(e.target.value) }))}
              className="mt-1 h-8 bg-white"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Follow-up (days)
            <Input
              type="number"
              min={1}
              max={30}
              value={settings.followup_days}
              onChange={(e) => setSettings((s) => ({ ...s, followup_days: Number(e.target.value) }))}
              className="mt-1 h-8 bg-white"
            />
          </label>
          <label className="text-[11px] text-slate-600">
            Link window (days)
            <Input
              type="number"
              min={1}
              max={90}
              value={settings.token_ttl_days}
              onChange={(e) => setSettings((s) => ({ ...s, token_ttl_days: Number(e.target.value) }))}
              className="mt-1 h-8 bg-white"
            />
          </label>
          <div className="flex items-end">
            <Button size="sm" variant="outline" className="w-full" onClick={() => void saveSettings()} disabled={busy !== null}>
              {busy === "settings" ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : "Save schedule"}
            </Button>
          </div>
        </div>

        {latest.length === 0 ? (
          <p className="text-xs text-sky-900/80">
            Every {settings.interval_days} days, active contractors with zero assignments in that window get a
            tokenized status form plus jobs they can claim. Roster status never changes automatically.
          </p>
        ) : (
          <div className="space-y-1.5">
            {[...latest]
              .sort((a, b) => {
                const rank = (r: PulseRow) =>
                  r.outcome === "needs_review" ? 0 : r.outcome === "no_response" ? 1 : r.outcome === "pending" ? 2 : 3;
                return rank(a) - rank(b);
              })
              .map((r) => (
              <div
                key={r.entry_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-white px-3 py-2"
              >
                <div className="min-w-0 text-xs">
                  <button
                    type="button"
                    onClick={() => onSelectCleaner?.(r.cleaner_id)}
                    className="font-medium text-slate-900 underline decoration-dotted"
                  >
                    {r.cleaner_name || "Unnamed contractor"}
                  </button>
                  <span className="ml-1.5">{outcomeBadge(r.outcome)}</span>
                  {r.claimed_job_count > 0 ? (
                    <Badge className="ml-1.5 bg-emerald-100 text-emerald-800 text-[10px]">
                      claimed {r.claimed_job_count}
                    </Badge>
                  ) : null}
                  <span className="ml-1.5 text-slate-500">
                    {answerLine(r.answers) || (r.opened_at ? "opened, not submitted" : r.followup_sent_at ? "follow-up sent" : "sent")}
                  </span>
                </div>
                {(r.outcome === "needs_review" || r.outcome === "no_response") && !r.admin_reviewed_at ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void markReviewed(r.entry_id)}
                    disabled={busy !== null}
                  >
                    Mark reviewed
                  </Button>
                ) : r.admin_reviewed_at ? (
                  <span className="text-[11px] text-slate-400">reviewed</span>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-sky-900/80">
          One follow-up in the same cycle, then silence surfaces here. Nothing auto-deactivates a contractor.
        </p>
      </CardContent>
    </Card>
  );
}
