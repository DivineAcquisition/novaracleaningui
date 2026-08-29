"use client";

// ─── /admin/model-control — AI model routing ───────────────────────────────
//
// Which model answers, per tier. Saving takes effect on the next request:
// the edge functions read this row at call time, so there is nothing to
// redeploy and no cache to clear.
//
// No API key is entered, displayed, or stored here. Keys live in the
// deployment's secrets store and are resolved by name at call time — this
// screen only reports whether one is present, so "not configured" is
// distinguishable from "configured but failing".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAlertLine,
  RiCheckboxCircleFill,
  RiInformationLine,
  RiKey2Line,
  RiLoader4Line,
  RiSaveLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_MODEL_CONTROL,
  MODEL_TIERS,
  TIER_COPY,
  fallbackIsDistinct,
  type LlmProvider,
  type ModelControlSettings,
  type ModelTier,
} from "@/lib/model-control";
import { cn } from "@/lib/utils";

interface VersionRow {
  id: string;
  version: number;
  settings: ModelControlSettings;
  change_summary: string | null;
  changed_by_name: string | null;
  created_at: string;
}

interface InvocationRow {
  id: string;
  surface: string;
  intent: string | null;
  provider: string;
  requested_tier: string;
  served_tier: string;
  served_model: string | null;
  resolved_model: string | null;
  fell_back: boolean;
  fallback_reason: string | null;
  latency_ms: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
}

interface Health {
  sampled: number;
  failures: number;
  fallbacks: number;
  medianLatencyMs: number | null;
}

async function api(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out as Record<string, unknown>;
}

export default function ModelControl() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ModelControlSettings>(DEFAULT_MODEL_CONTROL);
  const [saved, setSaved] = useState<ModelControlSettings>(DEFAULT_MODEL_CONTROL);
  const [summary, setSummary] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [invocations, setInvocations] = useState<InvocationRow[]>([]);
  const [keys, setKeys] = useState<{ anthropic: boolean; openai: boolean }>({
    anthropic: false,
    openai: false,
  });
  const [health, setHealth] = useState<Health | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api("/api/admin/model-control");
      const s = out.settings as ModelControlSettings;
      setSettings(s);
      setSaved(s);
      setVersions((out.versions as VersionRow[]) || []);
      setInvocations((out.invocations as InvocationRow[]) || []);
      setKeys(out.keys as { anthropic: boolean; openai: boolean });
      setHealth(out.health as Health);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load model settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(saved),
    [settings, saved],
  );
  const keyPresent = settings.provider === "openai" ? keys.openai : keys.anthropic;
  const keyName = settings.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/admin/model-control", {
        method: "PUT",
        body: JSON.stringify({ settings, changeSummary: summary }),
      });
      toast.success("Saved — the next request uses it. No redeploy needed.");
      setSummary("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setTier = (tier: ModelTier, value: string) =>
    setSettings((s) => ({ ...s, tiers: { ...s.tiers, [tier]: value } }));

  if (loading) {
    return (
      <p className="text-sm text-slate-500 flex items-center gap-2">
        <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-1 sm:px-4 py-2 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">AI models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which model answers, per tier. Saving applies on the next request — no redeploy.
        </p>
      </div>

      <div
        className={cn(
          "rounded-xl border px-4 py-3 text-sm flex items-start gap-2",
          keyPresent
            ? "border-emerald-200 bg-emerald-50/60 text-slate-700"
            : "border-amber-300 bg-amber-50/70 text-slate-800",
        )}
      >
        <RiKey2Line className={cn("w-4 h-4 mt-0.5 shrink-0", keyPresent ? "text-emerald-700" : "text-amber-700")} />
        <p>
          {keyPresent ? (
            <>
              <span className="font-semibold">{keyName} is configured.</span> The key lives in the
              secrets store and is read by name at call time. It is never shown here, stored in
              this configuration, or committed to the repo.
            </>
          ) : (
            <>
              <span className="font-semibold">{keyName} is not configured.</span> Add it to the
              deployment&apos;s secrets store (Supabase Edge Function secrets or the
              <code className="mx-1 rounded bg-white/70 px-1">app_secrets</code> table). Until
              then, insight generation falls back to counts-only output. Never paste a key into
              this screen — it is rejected.
            </>
          )}
        </p>
      </div>

      {/* Tiers */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <Label className="text-xs">Provider</Label>
              <Select
                value={settings.provider}
                onValueChange={(v) => setSettings((s) => ({ ...s, provider: v as LlmProvider }))}
              >
                <SelectTrigger className="mt-1 h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Timeout (ms)</Label>
              <Input
                type="number"
                min={5000}
                step={1000}
                value={settings.timeout_ms}
                onChange={(e) => setSettings((s) => ({ ...s, timeout_ms: Number(e.target.value) }))}
                className="mt-1 h-8 w-[120px] text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Max tokens</Label>
              <Input
                type="number"
                min={256}
                step={256}
                value={settings.max_tokens}
                onChange={(e) => setSettings((s) => ({ ...s, max_tokens: Number(e.target.value) }))}
                className="mt-1 h-8 w-[120px] text-xs"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {MODEL_TIERS.map((tier) => (
              <div key={tier} className="rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-semibold text-slate-900">{TIER_COPY[tier].label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug min-h-[52px]">
                  {TIER_COPY[tier].detail}
                </p>
                <Input
                  value={settings.tiers[tier]}
                  onChange={(e) => setTier(tier, e.target.value)}
                  className="mt-2 h-8 text-xs font-mono"
                  placeholder="model id"
                />
              </div>
            ))}
          </div>

          {!fallbackIsDistinct(settings) && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <RiAlertLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Fallback is the same model as Strongest. A retry on the same model repeats the same
              outage, so this configuration has no safety net — set a different model to get one.
            </p>
          )}

          <div>
            <Label className="text-xs">
              Money-adjacent intents — these route to Strongest
            </Label>
            <Input
              value={settings.money_adjacent_intents.join(", ")}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  money_adjacent_intents: e.target.value
                    .split(",")
                    .map((v) => v.trim().toLowerCase())
                    .filter(Boolean),
                }))
              }
              className="mt-1 h-8 text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              An assistant question whose intent contains any of these is answered by the Strongest
              tier. A wrong price or pay figure gets quoted to a customer or a contractor.
            </p>
          </div>

          <div>
            <Label className="text-xs">What changed and why</Label>
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Kept in configuration history"
              className="mt-1 h-8 text-xs"
            />
          </div>

          <Button size="sm" disabled={!dirty || !summary.trim() || saving} onClick={() => void save()}>
            {saving ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiSaveLine className="w-3.5 h-3.5 mr-1.5" />}
            Save routing
          </Button>
        </CardContent>
      </Card>

      {/* Health */}
      {health && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-bold text-slate-800 mb-2">
              Last {health.sampled} call{health.sampled === 1 ? "" : "s"}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Failures" value={String(health.failures)} tone={health.failures ? "bad" : "good"} />
              <Stat label="Fallbacks" value={String(health.fallbacks)} tone={health.fallbacks ? "warn" : "good"} />
              <Stat
                label="Median latency"
                value={health.medianLatencyMs ? `${(health.medianLatencyMs / 1000).toFixed(1)}s` : "—"}
              />
              <Stat label="Provider" value={settings.provider} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invocation log */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-bold text-slate-800 mb-1">Recent responses</p>
          <p className="text-xs text-slate-500 mb-3">
            Every AI response records the model that actually produced it. A fallback shows the
            tier it was asked for and the tier that answered.
          </p>
          {invocations.length === 0 ? (
            <p className="text-sm text-slate-500">No AI calls recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-600">
                    <th className="py-1.5 pr-3 font-semibold">When</th>
                    <th className="py-1.5 pr-3 font-semibold">Surface</th>
                    <th className="py-1.5 pr-3 font-semibold">Tier</th>
                    <th className="py-1.5 pr-3 font-semibold">Model that answered</th>
                    <th className="py-1.5 pr-3 font-semibold">Latency</th>
                    <th className="py-1.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {invocations.slice(0, 40).map((row) => (
                    <tr key={row.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-700">
                        {row.surface}
                        {row.intent ? <span className="text-slate-400"> · {row.intent}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        {row.fell_back ? (
                          <span className="text-amber-700">
                            {row.requested_tier} → {row.served_tier}
                          </span>
                        ) : (
                          <span className="text-slate-700">{row.served_tier}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-800">
                        {row.resolved_model || row.served_model || "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600">
                        {row.latency_ms ? `${(row.latency_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-1.5">
                        {row.ok ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <RiCheckboxCircleFill className="w-3 h-3" /> ok
                          </span>
                        ) : (
                          <span className="text-rose-700" title={row.error || ""}>failed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Config history */}
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-bold text-slate-800 mb-1">Configuration history</p>
          <p className="text-xs text-slate-500 mb-3 flex items-start gap-1.5">
            <RiInformationLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            &quot;Which model wrote this in March?&quot; needs the configuration as it stood in
            March, not as it stands today.
          </p>
          {versions.length === 0 ? (
            <p className="text-sm text-slate-500">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="text-xs border-l-2 border-slate-200 pl-3">
                  <p className="text-slate-800">
                    <Badge variant="outline" className="mr-1.5">v{v.version}</Badge>
                    default <span className="font-mono">{v.settings?.tiers?.default}</span> · strongest{" "}
                    <span className="font-mono">{v.settings?.tiers?.strongest}</span> · fallback{" "}
                    <span className="font-mono">{v.settings?.tiers?.fallback}</span>
                  </p>
                  <p className="text-slate-500 mt-0.5">
                    {v.change_summary}
                    {v.changed_by_name ? ` — ${v.changed_by_name}` : ""} ·{" "}
                    {new Date(v.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
      <p
        className={cn(
          "text-sm font-semibold mt-0.5",
          tone === "bad" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-slate-900",
        )}
      >
        {value}
      </p>
    </div>
  );
}
