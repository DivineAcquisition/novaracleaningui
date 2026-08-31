// ─── Aggregate assistant feedback into the review queue ───────────────────
//
// Writes insight rows only. Never edits the system prompt, the guides, or
// assistant behaviour. Same shape as the checklist-feedback aggregator.

import { completeWithConfiguredModel, loadModelControl } from "./llm";
import {
  citationOk,
  clusterSignals,
  crossesThreshold,
  DEFAULT_FEEDBACK_SETTINGS,
  deterministicFeedbackInsight,
  monthCycle,
  parseFeedbackSettings,
  type FeedbackInsight,
  type FeedbackSettings,
  type SignalRow,
  type TopicCluster,
} from "./feedback-loop";

type SB = { from: (t: string) => any };

const INSIGHT_SYSTEM = `You write the Ops Assistant Review queue for Novara Cleaning.
Each input row is ONE topic clustered from real assistant usage this cycle.

Rules (non-negotiable):
- Use ONLY the numbers in the user JSON. Never invent a count, a cause, or a question.
- Return one object per topic: {topicKey, observation, numbers, hypothesis, suggestedGap}.
- "numbers" must restate the actual counts from the JSON. Every digit you write must appear in the JSON.
- "hypothesis" must hedge ("may", "could", "worth reviewing", "cause is unclear from available data"). Never a directive, never "you must", never "this proves".
- suggestedGap must be one of: missing_docs, prompt_gap, missing_capability, correctly_escalating.
- correctly_escalating means the questions already match a genuine policy boundary (legal, termination, comps). Say it may not need a fix.
- If the counts show a pattern but nothing indicates why, say the cause is unclear from available data. Do not guess.
- The queue informs a human decision. It never instructs a change.
Return JSON: { "insights": [ {topicKey, observation, numbers, hypothesis, suggestedGap}, ... ] }`;

async function loadSettings(sb: SB): Promise<FeedbackSettings> {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "ops_assistant_feedback_settings")
      .maybeSingle();
    return parseFeedbackSettings(data?.value);
  } catch {
    return DEFAULT_FEEDBACK_SETTINGS;
  }
}

async function loadSignals(sb: SB, lookbackDays: number): Promise<SignalRow[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("ops_assistant_messages")
    .select("id, thread_id, role, content, rating, rating_note, escalation, did_not_know, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error || !data) return [];

  const byThread = new Map<string, Array<Record<string, unknown>>>();
  for (const row of data as Array<Record<string, unknown>>) {
    const tid = String(row.thread_id || "");
    const list = byThread.get(tid) || [];
    list.push(row);
    byThread.set(tid, list);
  }

  const signals: SignalRow[] = [];
  for (const rows of byThread.values()) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.role !== "assistant") continue;
      const prev = rows[i - 1];
      const question = prev && prev.role === "user" ? String(prev.content || "") : "";
      signals.push({
        messageId: String(row.id),
        question,
        answer: String(row.content || ""),
        rating: row.rating === "helpful" || row.rating === "not_helpful" ? row.rating : null,
        ratingNote: row.rating_note ? String(row.rating_note) : null,
        escalation: Boolean(row.escalation),
        didNotKnow: Boolean(row.did_not_know),
      });
    }
  }
  return signals;
}

async function generateInsights(sb: SB, clusters: TopicCluster[]): Promise<{
  insights: FeedbackInsight[];
  model: string;
}> {
  const fallback = {
    insights: clusters.map(deterministicFeedbackInsight),
    model: "deterministic-fallback",
  };
  if (!clusters.length) return { insights: [], model: fallback.model };

  const compact = clusters.map((c) => ({
    topicKey: c.topicKey,
    topicLabel: c.topicLabel,
    not_helpful: c.notHelpful,
    dont_know: c.dontKnow,
    escalation_gap: c.escalationGap,
    escalation_policy: c.escalationPolicy,
    examples: c.examples.map((e) => e.question),
  }));
  const haystack = JSON.stringify(compact);
  const settings = await loadModelControl(sb);
  const llm = await completeWithConfiguredModel({
    sb,
    system: INSIGHT_SYSTEM,
    user: `TOPICS ${JSON.stringify(compact)}`,
    intent: "feedback-loop-analysis",
    settings,
    maxTokens: 2500,
  });
  if (!llm.ok || !llm.text) return { ...fallback, model: `${fallback.model} (${llm.error || "no text"})` };

  let parsed: { insights?: unknown[] } = {};
  try {
    const cleaned = llm.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { ...fallback, model: `${llm.model} failed → ${fallback.model}` };
  }

  const byKey = new Map(clusters.map((c) => [c.topicKey, c]));
  const raw = Array.isArray(parsed.insights) ? parsed.insights : [];
  const cleaned: FeedbackInsight[] = [];
  for (const entry of raw) {
    const r = entry as Record<string, unknown>;
    const topicKey = String(r?.topicKey || r?.topic_key || "").trim();
    const cluster = byKey.get(topicKey);
    if (!cluster) continue;
    const insight: FeedbackInsight = {
      topicKey,
      observation: String(r.observation || "").trim(),
      numbers: String(r.numbers || "").trim(),
      hypothesis: String(r.hypothesis || "").trim(),
      suggestedGap: deterministicFeedbackInsight(cluster).suggestedGap,
    };
    const gap = String(r.suggestedGap || r.suggested_gap || "");
    if (["missing_docs", "prompt_gap", "missing_capability", "correctly_escalating"].includes(gap)) {
      insight.suggestedGap = gap as FeedbackInsight["suggestedGap"];
    }
    if (!insight.observation) continue;
    cleaned.push(citationOk(insight, haystack) ? insight : deterministicFeedbackInsight(cluster));
  }
  const covered = new Set(cleaned.map((i) => i.topicKey));
  for (const cluster of clusters) {
    if (!covered.has(cluster.topicKey)) cleaned.push(deterministicFeedbackInsight(cluster));
  }
  return { insights: cleaned, model: llm.model };
}

export async function runFeedbackAggregation(sb: SB): Promise<{
  ok: true;
  cycle: { start: string; end: string };
  considered: number;
  surfaced: number;
  threshold: number;
  model: string;
}> {
  const settings = await loadSettings(sb);
  const cycle = monthCycle();
  const signals = await loadSignals(sb, settings.lookback_days);
  const clusters = clusterSignals(signals)
    .filter((c) => crossesThreshold(c, settings.min_signal_threshold))
    .sort(
      (a, b) =>
        b.notHelpful + b.dontKnow + b.escalationGap - (a.notHelpful + a.dontKnow + a.escalationGap),
    )
    .slice(0, settings.max_insights);

  const generated = await generateInsights(sb, clusters);
  const byKey = new Map(clusters.map((c) => [c.topicKey, c]));

  for (const insight of generated.insights) {
    const cluster = byKey.get(insight.topicKey);
    if (!cluster) continue;
    const row = {
      topic_key: cluster.topicKey,
      topic_label: cluster.topicLabel,
      cycle_start: cycle.start,
      cycle_end: cycle.end,
      counts: {
        not_helpful: cluster.notHelpful,
        dont_know: cluster.dontKnow,
        escalation_gap: cluster.escalationGap,
        escalation_policy: cluster.escalationPolicy,
      },
      not_helpful_count: cluster.notHelpful,
      dont_know_count: cluster.dontKnow,
      escalation_gap_count: cluster.escalationGap,
      escalation_policy_count: cluster.escalationPolicy,
      example_questions: cluster.examples,
      message_ids: cluster.messageIds,
      observation: insight.observation,
      numbers: insight.numbers,
      hypothesis: insight.hypothesis,
      suggested_gap: insight.suggestedGap,
      model: generated.model,
      model_version: "ops-assistant-feedback-v1",
    };

    const { data: existing } = await sb
      .from("ops_assistant_insights")
      .select("id, status")
      .eq("topic_key", cluster.topicKey)
      .eq("cycle_start", cycle.start)
      .maybeSingle();

    if (existing?.id) {
      if (existing.status !== "open") continue;
      await sb.from("ops_assistant_insights").update(row).eq("id", existing.id);
    } else {
      await sb.from("ops_assistant_insights").insert({ ...row, status: "open" });
    }
  }

  return {
    ok: true,
    cycle,
    considered: clusterSignals(signals).length,
    surfaced: generated.insights.length,
    threshold: settings.min_signal_threshold,
    model: generated.model,
  };
}
