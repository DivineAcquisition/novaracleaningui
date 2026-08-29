// Insight layer: every claim cites a pulled number; language is hypothesis
// only. Routed through the model-control layer at the STRONGEST tier — a
// wrong reading here goes into a report leadership acts on. If that tier is
// unavailable the layer degrades to the fallback tier; if the model is missing
// entirely or returns uncited text, deterministic comparisons still ship.

import { callModel, loadModelControl, modelLabel } from "../llm.ts";
import type { Insight, WeeklySnapshot } from "./types.ts";
import { formatRangeLabel } from "./period.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const HYPOTHESIS_RE = /\b(may|might|could|worth checking|suggests?|unclear|possible)\b/i;

export type InsightResult = {
  executive_summary: string;
  insights: Insight[];
  watch_list: string[];
  model: string;
  model_version: string;
};

function fmtMetricValue(unit: string | undefined, value: number | null): string {
  if (value == null) return "unavailable";
  if (unit === "cents") return `$${(value / 100).toFixed(2)}`;
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "seconds") {
    if (value >= 60) return `${Math.round(value / 60)} min`;
    return `${Math.round(value)} sec`;
  }
  if (unit === "score") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function compactSnapshot(snapshot: WeeklySnapshot) {
  return {
    period: formatRangeLabel(snapshot.period_start, snapshot.period_end),
    timezone: snapshot.timezone,
    unavailable: snapshot.sources.filter((s) => !s.available).map((s) => ({
      id: s.id,
      reason: s.reason,
    })),
    metrics: snapshot.metrics.map((m) => ({
      key: m.key,
      label: m.label,
      section: m.section,
      current: m.current.available ? fmtMetricValue(m.unit, m.current.value) : `UNAVAILABLE (${m.current.unavailable_reason})`,
      prior: m.prior.available ? fmtMetricValue(m.unit, m.prior.value) : "UNAVAILABLE",
      trailing4: m.trailing4.available ? fmtMetricValue(m.unit, m.trailing4.value) : "UNAVAILABLE",
      wow_pct: m.wow_pct == null ? null : Math.round(m.wow_pct * 10) / 10,
      source: m.current.source,
    })),
    cities: snapshot.cities,
    ad_spend: snapshot.ad_spend,
  };
}

function citationOk(insight: Insight, haystack: string): boolean {
  const blob = `${insight.observation} ${insight.numbers}`.toLowerCase();
  if (!insight.numbers || !/\d/.test(insight.numbers)) return false;
  if (!HYPOTHESIS_RE.test(insight.hypothesis || "")) return false;
  // At least one digit sequence from the numbers line should appear in the
  // compact snapshot so the claim is traceable to pulled data.
  const nums = insight.numbers.match(/-?\d+(?:\.\d+)?/g) || [];
  return nums.some((n) => haystack.includes(n));
}

function deterministicInsights(snapshot: WeeklySnapshot, max: number, priorWatch: string[]): InsightResult {
  const ranked = snapshot.metrics
    .filter((m) => m.current.available && m.wow_pct != null && Math.abs(m.wow_pct) >= 8)
    .sort((a, b) => {
      const mag = Math.abs(b.wow_pct || 0) - Math.abs(a.wow_pct || 0);
      const rev = (b.unit === "cents" ? 1 : 0) - (a.unit === "cents" ? 1 : 0);
      return mag || rev;
    })
    .slice(0, max);

  const insights: Insight[] = ranked.map((m) => {
    const cur = fmtMetricValue(m.unit, m.current.value);
    const prior = fmtMetricValue(m.unit, m.prior.value);
    const dir = (m.wow_pct || 0) > 0 ? "rose" : "fell";
    const trail = m.trailing4.available
      ? ` trailing 4-week average ${fmtMetricValue(m.unit, m.trailing4.value)}`
      : " trailing 4-week average unavailable";
    return {
      observation: `${m.label} ${dir} ${Math.abs(m.wow_pct || 0).toFixed(0)}% week over week.`,
      numbers: `${m.label} ${cur} this week vs ${prior} prior week (${m.current.source});${trail}.`,
      hypothesis: m.prior.available
        ? `Cause is unclear from available data — worth checking whether volume, coverage, or spend around ${m.label.toLowerCase()} changed.`
        : `Cause is unclear from available data.`,
      watch: Math.abs(m.wow_pct || 0) >= 20,
    };
  });

  const byKey = Object.fromEntries(snapshot.metrics.map((m) => [m.key, m]));
  const booked = byKey.revenue_booked_cents;
  const collected = byKey.revenue_collected_cents;
  const bookings = byKey.bookings_made;
  const leads = byKey.leads_received;
  const summaryBits = [
    bookings?.current.available
      ? `${fmtMetricValue("count", bookings.current.value)} bookings`
      : null,
    booked?.current.available
      ? `${fmtMetricValue("cents", booked.current.value)} booked`
      : null,
    collected?.current.available
      ? `${fmtMetricValue("cents", collected.current.value)} collected`
      : null,
    leads?.current.available
      ? `${fmtMetricValue("count", leads.current.value)} leads`
      : null,
  ].filter(Boolean);

  const wowLine = booked?.wow_pct != null
    ? ` Booked revenue ${booked.wow_pct >= 0 ? "up" : "down"} ${Math.abs(booked.wow_pct).toFixed(0)}% vs the prior week.`
    : "";

  const top = insights[0];
  const executive_summary = summaryBits.length
    ? `Week of ${formatRangeLabel(snapshot.period_start, snapshot.period_end)}: ${summaryBits.join(", ")}.${wowLine}${
      top ? ` Most material movement: ${top.observation}` : ""
    } Missing sources are listed as unavailable rather than zero.`
    : `Week of ${formatRangeLabel(snapshot.period_start, snapshot.period_end)} produced too few available metrics for a numeric headline. See unavailable sources in the body.`;

  const watch_list = [
    ...insights.filter((i) => i.watch).map((i) => i.observation),
    ...priorWatch.slice(0, 4),
  ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 8);

  return {
    executive_summary,
    insights,
    watch_list,
    model: "deterministic-fallback",
    model_version: "weekly-report-v1",
  };
}

export async function generateInsights(
  sb: SB,
  snapshot: WeeklySnapshot,
  opts: { maxInsights: number; priorWatch: string[] },
): Promise<InsightResult> {
  const fallback = deterministicInsights(snapshot, opts.maxInsights, opts.priorWatch);
  const compact = compactSnapshot(snapshot);
  const haystack = JSON.stringify(compact).toLowerCase();

  const settings = await loadModelControl(sb);

  const system = `You write the Insight & Analysis section of Novara Cleaning's weekly internal report.
Rules (non-negotiable):
- Use ONLY the JSON data in the user message. Never invent a metric, cause, or dollar amount.
- Every insight is an object: {observation, numbers, hypothesis, watch}.
- "numbers" must quote the actual figures and their source field from the JSON.
- hypothesis must use hedging ("may", "worth checking", "could suggest", "cause unclear from available data"). Never "you must" or "this proves".
- If the data shows a change but not a cause, say cause is unclear from available data.
- Prefer week-over-week and trailing-4-week comparisons. Skip tiny noise.
- Maximum ${opts.maxInsights} insights, ranked by magnitude and revenue relevance.
- Do not mention unavailable metrics except to say they were unavailable.
- The report never takes action; it only informs.
Return JSON: { "executive_summary": "3-5 sentences", "insights": [...], "watch_list": ["short items for next week"] }`;

  const user = `PERIOD ${compact.period}
PRIOR WATCH LIST ${JSON.stringify(opts.priorWatch)}
DATA ${JSON.stringify(compact)}`;

  const llm = await callModel(sb, {
    tier: "strongest",
    surface: "weekly-report",
    system,
    user,
    jsonMode: true,
    settings,
    maxTokens: 2200,
  });

  if (!llm.ok || !llm.json) {
    return {
      ...fallback,
      model: `${llm.model} unavailable → ${fallback.model}`,
      model_version: (llm.error || "model returned unusable content").slice(0, 180),
    };
  }

  const analysis = llm.json as {
    executive_summary?: string;
    insights?: Insight[];
    watch_list?: string[];
  };
  const cleaned = (Array.isArray(analysis.insights) ? analysis.insights : [])
    .map((raw) => ({
      observation: String(raw?.observation || "").trim(),
      numbers: String(raw?.numbers || "").trim(),
      hypothesis: String(raw?.hypothesis || "").trim(),
      watch: Boolean(raw?.watch),
    }))
    .filter((i) => i.observation && citationOk(i, haystack))
    .slice(0, opts.maxInsights);

  const insights = cleaned.length ? cleaned : fallback.insights;
  const executive_summary = String(analysis.executive_summary || "").trim() || fallback.executive_summary;
  const watch_list = [
    ...(Array.isArray(analysis.watch_list) ? analysis.watch_list.map((s) => String(s).trim()).filter(Boolean) : []),
    ...insights.filter((i) => i.watch).map((i) => i.observation),
    ...opts.priorWatch,
  ].filter((v, i, arr) => v && arr.indexOf(v) === i).slice(0, 8);

  return {
    executive_summary: executive_summary.slice(0, 1200),
    insights,
    watch_list,
    // What actually produced this, including a fallback if one happened. The
    // report stores this on weekly_reports.insight_model.
    model: modelLabel(llm),
    model_version: `${llm.provider}:${llm.tier}`,
  };
}
