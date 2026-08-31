// ─── Assistant learning loop — pure aggregation ───────────────────────────
//
// Same discipline as the checklist feedback loop and the weekly report:
// insights cite the actual questions/counts behind them, are framed as
// hypotheses, never assert an unsupported cause, and do not change the
// assistant. A human in the review queue decides.
//
// A minimum signal threshold applies. One bad rating is noise.

export const HYPOTHESIS_RE =
  /\b(may|might|could|worth reviewing|worth checking|suggests?|unclear|possible)\b/i;

export const DEFAULT_FEEDBACK_SETTINGS = {
  aggregation_cadence: "monthly" as const,
  min_signal_threshold: 2,
  lookback_days: 90,
  max_insights: 12,
};

export type FeedbackSettings = typeof DEFAULT_FEEDBACK_SETTINGS;

export type SuggestedGap = "missing_docs" | "prompt_gap" | "missing_capability" | "correctly_escalating";

export interface FeedbackExample {
  question: string;
  answerExcerpt: string;
  note: string | null;
  kind: "not_helpful" | "dont_know" | "escalation_gap" | "escalation_policy";
}

export interface TopicCluster {
  topicKey: string;
  topicLabel: string;
  notHelpful: number;
  dontKnow: number;
  escalationGap: number;
  escalationPolicy: number;
  examples: FeedbackExample[];
  messageIds: string[];
}

export interface FeedbackInsight {
  topicKey: string;
  observation: string;
  numbers: string;
  hypothesis: string;
  suggestedGap: SuggestedGap;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "is", "it", "this",
  "that", "what", "whats", "how's", "hows", "how", "do", "i", "we", "our", "me",
  "please", "can", "you", "with", "from", "about", "lately", "current", "month",
  "week", "year", "today", "now", "my", "your",
]);

export function parseFeedbackSettings(raw: unknown): FeedbackSettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const threshold = Math.round(Number(obj.min_signal_threshold));
  const lookback = Math.round(Number(obj.lookback_days));
  const maxInsights = Math.round(Number(obj.max_insights));
  return {
    aggregation_cadence: "monthly",
    min_signal_threshold: Number.isFinite(threshold) ? Math.min(20, Math.max(2, threshold)) : 2,
    lookback_days: Number.isFinite(lookback) ? Math.min(365, Math.max(14, lookback)) : 90,
    max_insights: Number.isFinite(maxInsights) ? Math.min(24, Math.max(3, maxInsights)) : 12,
  };
}

/** Stable topic key so "reclean rate" and "what's our reclean rate" cluster. */
export function topicKey(question: string): string {
  const tokens = String(question || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && t.length > 1)
    .slice(0, 6);
  return tokens.join("-") || "uncategorized";
}

export function topicLabel(question: string): string {
  const key = topicKey(question);
  if (key === "uncategorized") return "Uncategorized";
  return key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function looksLikeDontKnow(text: string): boolean {
  return /\b(i don't have a workspace guide|i do not have a workspace guide|i don't know|i do not know|not something i can confirm|i can't confirm what's in)\b/i.test(
    text || "",
  );
}

/** Policy-boundary escalations (legal, firing, comps) vs a knowledge gap. */
export function isGenuinePolicyEscalation(question: string): boolean {
  return /\b(lawsuit|attorney|lawyer|legal threat|sue us|bbb complaint|fire this cleaner|terminat\w*|let (them|him|her) go|comp(ed|limentary)|free clean|waive (the )?(charge|balance)|special (rate|price|deal)|override (the )?price|delete (this |the |their )?customer|right to be forgotten|gdpr)\b/i.test(
    question || "",
  );
}

export interface SignalRow {
  messageId: string;
  question: string;
  answer: string;
  rating: "helpful" | "not_helpful" | null;
  ratingNote: string | null;
  escalation: boolean;
  didNotKnow: boolean;
}

/**
 * Cluster signals into topics. A topic only keeps kinds that are actually
 * present — helpful-only messages are ignored (they are not a problem).
 */
export function clusterSignals(rows: SignalRow[]): TopicCluster[] {
  const map = new Map<string, TopicCluster>();
  for (const row of rows) {
    const kind: FeedbackExample["kind"] | null = row.rating === "not_helpful"
      ? "not_helpful"
      : row.didNotKnow
        ? "dont_know"
        : row.escalation
          ? isGenuinePolicyEscalation(row.question)
            ? "escalation_policy"
            : "escalation_gap"
          : null;
    if (!kind) continue;
    const key = topicKey(row.question);
    const existing = map.get(key) || {
      topicKey: key,
      topicLabel: topicLabel(row.question),
      notHelpful: 0,
      dontKnow: 0,
      escalationGap: 0,
      escalationPolicy: 0,
      examples: [],
      messageIds: [],
    };
    if (kind === "not_helpful") existing.notHelpful += 1;
    if (kind === "dont_know") existing.dontKnow += 1;
    if (kind === "escalation_gap") existing.escalationGap += 1;
    if (kind === "escalation_policy") existing.escalationPolicy += 1;
    if (existing.examples.length < 5) {
      existing.examples.push({
        question: row.question.slice(0, 400),
        answerExcerpt: row.answer.slice(0, 280),
        note: row.ratingNote,
        kind,
      });
    }
    existing.messageIds.push(row.messageId);
    map.set(key, existing);
  }
  return [...map.values()];
}

/** Pattern gate. Total distinct problem signals must reach the threshold. */
export function crossesThreshold(cluster: TopicCluster, min: number): boolean {
  const total = cluster.notHelpful + cluster.dontKnow + cluster.escalationGap + cluster.escalationPolicy;
  return total >= min;
}

export function suggestGap(cluster: TopicCluster): SuggestedGap {
  const total = cluster.notHelpful + cluster.dontKnow + cluster.escalationGap + cluster.escalationPolicy;
  if (total > 0 && cluster.escalationPolicy >= total / 2) return "correctly_escalating";
  const blob = cluster.examples.map((e) => `${e.question} ${e.note || ""}`).join(" ").toLowerCase();
  if (/\b(can't see|cannot see|no access|drive|permission|revenue|profit|aggregate)\b/.test(blob)) {
    return "missing_capability";
  }
  if (/\b(tone|wording|prompt|too long|wrong step|didn't follow)\b/.test(blob)) return "prompt_gap";
  if (cluster.dontKnow >= cluster.notHelpful) return "missing_docs";
  return "missing_docs";
}

export function deterministicFeedbackInsight(cluster: TopicCluster): FeedbackInsight {
  const parts: string[] = [];
  if (cluster.notHelpful) parts.push(`${cluster.notHelpful} not-helpful rating${cluster.notHelpful === 1 ? "" : "s"}`);
  if (cluster.dontKnow) parts.push(`${cluster.dontKnow} “I don't know” answer${cluster.dontKnow === 1 ? "" : "s"}`);
  if (cluster.escalationGap) {
    parts.push(
      `${cluster.escalationGap} escalation${cluster.escalationGap === 1 ? "" : "s"} that may be a knowledge gap rather than a policy boundary`,
    );
  }
  if (cluster.escalationPolicy) {
    parts.push(
      `${cluster.escalationPolicy} escalation${cluster.escalationPolicy === 1 ? "" : "s"} that match a genuine policy boundary`,
    );
  }
  const gap = suggestGap(cluster);
  const hypothesis =
    gap === "correctly_escalating"
      ? "This topic may already be correctly routing to management. Worth reviewing, but it may not need a fix."
      : gap === "missing_capability"
        ? "This topic may be a genuine missing data-access capability rather than a wording problem. Worth reviewing; the data does not prove that."
        : gap === "prompt_gap"
          ? "The system prompt may be under-specified for this topic. Worth reviewing — cause is not proven by the ratings alone."
          : cluster.dontKnow > 0
            ? "This topic may be under-documented. Worth reviewing; the ratings do not say why the answers missed."
            : "Cause is unclear from available data — the counts show a pattern but not a reason. Worth reviewing.";

  const sample = cluster.examples[0]?.question
    ? ` Example question: “${cluster.examples[0].question}”.`
    : "";

  return {
    topicKey: cluster.topicKey,
    observation: `“${cluster.topicLabel}” drew repeat assistant-feedback signal this cycle.${sample}`,
    numbers: `${parts.join("; ")}.`,
    hypothesis,
    suggestedGap: gap,
  };
}

/** A model claim survives only if its figures appear in the pulled counts. */
export function citationOk(insight: FeedbackInsight, haystack: string): boolean {
  if (!insight.numbers || !/\d/.test(insight.numbers)) return false;
  if (!HYPOTHESIS_RE.test(insight.hypothesis || "")) return false;
  const nums = insight.numbers.match(/\d+/g) || [];
  return nums.length > 0 && nums.every((n) => haystack.includes(n));
}

export function monthCycle(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
