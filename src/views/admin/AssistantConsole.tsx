"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RiAlertLine,
  RiLoader4Line,
  RiPlayLine,
  RiSparklingLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import AssistantKnowledge from "@/views/admin/AssistantKnowledge";

type InsightRow = {
  id: string;
  topic_key: string;
  topic_label: string;
  cycle_start: string;
  cycle_end: string;
  not_helpful_count: number;
  dont_know_count: number;
  escalation_gap_count: number;
  escalation_policy_count: number;
  example_questions: Array<{ question?: string; note?: string | null; kind?: string }>;
  observation: string;
  numbers: string;
  hypothesis: string;
  suggested_gap: string;
  model: string | null;
  status: string;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
};

type HealthDaily = {
  day: string;
  answers: number;
  helpful: number;
  not_helpful: number;
  escalations: number;
  genuine_answers: number;
  did_not_know: number;
};

type HealthRollup = {
  last_change_at: string | null;
  answers: number;
  helpful: number;
  not_helpful: number;
  escalations: number;
  genuine_answers: number;
  answers_before_change: number;
  helpful_before_change: number;
  not_helpful_before_change: number;
  escalations_before_change: number;
  answers_after_change: number;
  helpful_after_change: number;
  not_helpful_after_change: number;
  escalations_after_change: number;
};

type PromptVersion = {
  id: string;
  version: number;
  change_summary: string;
  source_insight_id: string | null;
  changed_by_name: string | null;
  created_at: string;
};

async function headers(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (data.session?.access_token) h.Authorization = `Bearer ${data.session.access_token}`;
  return h;
}

function rate(helpful: number, notHelpful: number): string {
  const n = helpful + notHelpful;
  if (!n) return "—";
  return `${Math.round((helpful / n) * 100)}% helpful (${helpful}/${n})`;
}

function gapLabel(gap: string): string {
  switch (gap) {
    case "prompt_gap":
      return "system-prompt gap";
    case "missing_capability":
      return "missing data-access capability";
    case "correctly_escalating":
      return "correctly escalating — may not need a fix";
    default:
      return "missing or unclear documentation";
  }
}

export default function AssistantConsole() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">Ops Assistant</p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">Assistant</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Policy articles, the review queue (nothing changes until you act), and Assistant Health.
          How-the-tool-works answers still come from the generated guides — regenerate those by
          editing the docs and shipping, the same cycle as before.
        </p>
      </header>
      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="articles">Policy articles</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <ReviewQueue />
        </TabsContent>
        <TabsContent value="health" className="mt-4">
          <HealthPanel />
        </TabsContent>
        <TabsContent value="articles" className="mt-4">
          <AssistantKnowledge />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReviewQueue() {
  const [status, setStatus] = useState("open");
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [promptBody, setPromptBody] = useState("");
  const [promptVersion, setPromptVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [aggregating, setAggregating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/assistant/insights?status=${encodeURIComponent(status)}`, {
        headers: await headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load the queue.");
      setInsights(data.insights || []);
      if (data.prompt?.body) setPromptBody(data.prompt.body);
      setPromptVersion(Number(data.prompt?.version) || 0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAggregation = async () => {
    setAggregating(true);
    try {
      const res = await fetch("/api/ops-assistant/aggregate", {
        method: "POST",
        headers: await headers(),
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Aggregation failed.");
      toast.success(
        `Surfaced ${data.surfaced} pattern${data.surfaced === 1 ? "" : "s"} (threshold ${data.threshold}).`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Aggregation failed.");
    } finally {
      setAggregating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Topics that crossed the minimum signal threshold. One isolated not-helpful rating never
          surfaces on its own. Nothing about the assistant changes until you act here.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 rounded-md border border-[color:var(--hairline)] bg-background px-2 text-xs"
          >
            <option value="open">Open</option>
            <option value="docs_noted">Docs noted</option>
            <option value="prompt_edited">Prompt edited</option>
            <option value="capability_gap">Capability gap</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <Button size="sm" variant="outline" disabled={aggregating} onClick={() => void runAggregation()}>
            {aggregating ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : <RiPlayLine className="h-3.5 w-3.5" />}
            Run aggregation
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <RiLoader4Line className="h-4 w-4 animate-spin" /> Loading
        </p>
      ) : insights.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--hairline)] bg-card p-6 text-center text-sm text-muted-foreground">
          Nothing in this state. Patterns surface on the monthly cycle — or when you run aggregation
          — once they cross the minimum signal threshold.
        </div>
      ) : (
        insights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            livePrompt={promptBody}
            promptVersion={promptVersion}
            onResolved={() => void load()}
          />
        ))
      )}
    </div>
  );
}

function InsightCard({
  insight,
  livePrompt,
  promptVersion,
  onResolved,
}: {
  insight: InsightRow;
  livePrompt: string;
  promptVersion: number;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<"" | "docs_noted" | "prompt_edited" | "capability_gap" | "dismissed">("");
  const [note, setNote] = useState("");
  const [prompt, setPrompt] = useState(livePrompt);
  const [busy, setBusy] = useState(false);
  const resolved = insight.status !== "open";

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/assistant/insights", {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          action: "resolve",
          insightId: insight.id,
          resolution: mode,
          note,
          promptBody: mode === "prompt_edited" ? prompt : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not resolve.");
      toast.success("Recorded. The assistant does not change unless this was a prompt edit.");
      setMode("");
      setNote("");
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={cn("rounded-xl border border-[color:var(--hairline)] bg-card p-4 space-y-3", resolved && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{insight.observation}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {insight.topic_label} · cycle {insight.cycle_start} → {insight.cycle_end} · suggested: {gapLabel(insight.suggested_gap)}
          </p>
        </div>
        <Badge variant="outline">{resolved ? insight.status : "open"}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {insight.not_helpful_count > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800">{insight.not_helpful_count} not-helpful</span>
        )}
        {insight.dont_know_count > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5">{insight.dont_know_count} didn’t know</span>
        )}
        {insight.escalation_gap_count > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">{insight.escalation_gap_count} possible knowledge-gap escalations</span>
        )}
        {insight.escalation_policy_count > 0 && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">{insight.escalation_policy_count} genuine policy escalations</span>
        )}
      </div>
      <div className="space-y-1.5 rounded-lg border border-[color:var(--hairline)] bg-muted/30 p-3">
        <p className="text-xs">
          <span className="font-semibold">Counts: </span>
          {insight.numbers}
        </p>
        <p className="text-xs">
          <span className="font-semibold">Hypothesis: </span>
          {insight.hypothesis}
        </p>
      </div>
      {insight.example_questions?.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {insight.example_questions.slice(0, 4).map((ex, i) => (
            <li key={i}>“{ex.question}”{ex.note ? ` — note: ${ex.note}` : ""}</li>
          ))}
        </ul>
      )}
      {resolved ? (
        <p className="text-xs text-muted-foreground">
          {insight.status}
          {insight.resolution_note ? ` — ${insight.resolution_note}` : ""}
          {insight.resolved_by_name ? ` · ${insight.resolved_by_name}` : ""}
        </p>
      ) : mode === "" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("docs_noted")}>Update documentation</Button>
          <Button size="sm" variant="outline" onClick={() => setMode("prompt_edited")}>
            Edit system prompt
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("capability_gap")}>
            Flag capability gap
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("dismissed")}>
            Dismiss
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-[color:var(--hairline)] p-3">
          {mode === "prompt_edited" && (
            <div>
              <Label className="text-xs">System prompt (currently v{promptVersion})</Label>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} className="mt-1 font-mono text-xs" />
            </div>
          )}
          {mode === "docs_noted" && (
            <p className="text-xs text-muted-foreground">
              Note which guide to update. That feeds the existing docs regeneration cycle — this
              queue will not edit markdown by itself.
            </p>
          )}
          <div>
            <Label className="text-xs">Note (required — kept on the insight)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 text-sm" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !note.trim()} onClick={() => void submit()}>
              {busy ? <RiLoader4Line className="h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function HealthPanel() {
  const [daily, setDaily] = useState<HealthDaily[]>([]);
  const [health, setHealth] = useState<HealthRollup | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/assistant/health", { headers: await headers() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load health.");
        setDaily(data.daily || []);
        setHealth(data.health || null);
        setVersions(data.promptVersions || []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load health.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <RiLoader4Line className="h-4 w-4 animate-spin" /> Loading
      </p>
    );
  }

  const rows = [...daily].reverse();

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Helpful rate and escalation-vs-genuine-answer over time. When a prompt or documentation
        action is taken from the review queue, before/after counts show whether the signal actually
        moved — an edit that changed nothing is visible here rather than assumed successful.
      </p>

      {health && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[color:var(--hairline)] bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Helpful rate</p>
            <p className="mt-1 text-lg font-semibold">{rate(health.helpful, health.not_helpful)}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--hairline)] bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Escalation vs answers</p>
            <p className="mt-1 text-lg font-semibold">
              {health.answers
                ? `${Math.round((health.escalations / health.answers) * 100)}% escalated`
                : "—"}
            </p>
            <p className="text-[11px] text-muted-foreground">{health.genuine_answers} genuine answers</p>
          </div>
          <div className="rounded-xl border border-[color:var(--hairline)] bg-card p-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last prompt/docs change</p>
            <p className="mt-1 text-sm font-semibold">
              {health.last_change_at ? new Date(health.last_change_at).toLocaleString() : "none yet"}
            </p>
            {health.last_change_at && (
              <p className="text-[11px] text-muted-foreground">
                Helpful {rate(health.helpful_before_change, health.not_helpful_before_change)} →{" "}
                {rate(health.helpful_after_change, health.not_helpful_after_change)}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[color:var(--hairline)] bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline)] bg-muted/40 text-left">
              <th className="px-3 py-2 font-semibold">Day</th>
              <th className="px-3 py-2 text-center font-semibold">Answers</th>
              <th className="px-3 py-2 text-center font-semibold">Helpful</th>
              <th className="px-3 py-2 text-center font-semibold">Not helpful</th>
              <th className="px-3 py-2 text-center font-semibold">Escalations</th>
              <th className="px-3 py-2 text-center font-semibold">Genuine</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  No rated answers yet. Health fills in as people use the assistant and mark responses.
                </td>
              </tr>
            ) : (
              rows.map((d) => (
                <tr key={d.day} className="border-t border-[color:var(--hairline)]">
                  <td className="px-3 py-2">{d.day}</td>
                  <td className="px-3 py-2 text-center">{d.answers}</td>
                  <td className="px-3 py-2 text-center text-emerald-700">{d.helpful || "—"}</td>
                  <td className="px-3 py-2 text-center text-rose-700">{d.not_helpful || "—"}</td>
                  <td className="px-3 py-2 text-center">{d.escalations || "—"}</td>
                  <td className="px-3 py-2 text-center">{d.genuine_answers || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {versions.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <RiSparklingLine className="h-4 w-4 text-primary" /> Prompt version history
          </p>
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="rounded-lg border border-[color:var(--hairline)] px-3 py-2 text-xs">
                <span className="font-semibold">v{v.version}</span>
                {" — "}
                {v.change_summary}
                {v.source_insight_id ? " · linked to a review-queue insight" : ""}
                {v.changed_by_name ? ` · ${v.changed_by_name}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        Before/after uses the whole retained history, so a recent edit will look thin on the after
        side until more conversations run.
      </p>
    </div>
  );
}
