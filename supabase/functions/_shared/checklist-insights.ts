// ─── Checklist feedback insights ─────────────────────────────────────────
//
// Same grounded discipline as the weekly report's insight layer: every claim
// cites the counts behind it, language is hypothesis only, and an insight that
// cannot be traced back to a pulled figure is dropped rather than shipped.
//
// Two differences from the weekly report, both deliberate:
//
//   1. Model routing asks for the STRONGEST configured model, not the default
//      one. This is exactly the analysis where a cheap model's confident-wrong
//      pattern is expensive — it would send an admin to rewrite a checklist
//      item that was never the problem.
//   2. quality_miss and scope_confusion are never summed. They point at
//      different failures: one says the item was skipped or under-specified,
//      the other says the scope boundary is unclear. Conflating them produces
//      an insight that recommends the wrong fix.

import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const HYPOTHESIS_RE = /\b(may|might|could|worth reviewing|worth checking|suggests?|unclear|possible)\b/i;

export interface ItemSignalCounts {
  quality_miss: number;
  scope_confusion: number;
  qc_case: number;
  review_theme: number;
  duration_variance: number;
  recurrence: number;
}

export interface AggregatedItem {
  item_id: string;
  item_text: string;
  area: string;
  checklists: string[];
  counts: ItemSignalCounts;
  /** Total across kinds — used for ranking only, never asserted as one number. */
  total: number;
  signal_ids: string[];
  /** Distinct bookings behind the signal, so "3 re-cleans" isn't 3x one job. */
  distinct_bookings: number;
}

export interface ChecklistInsight {
  item_id: string;
  observation: string;
  numbers: string;
  hypothesis: string;
}

export interface ChecklistInsightResult {
  insights: ChecklistInsight[];
  model: string;
  model_version: string;
}

/**
 * The strongest model the operator has configured, falling back to the
 * standard one. Adding LLM_MODEL_*_STRONG is how an operator opts a
 * heavier model into this analysis without touching the weekly report.
 */
export async function strongestModel(
  sb: SB,
): Promise<{ provider: "openai" | "anthropic"; model: string; apiKey: string; tier: string }> {
  const providerRaw = ((await resolveSecret(sb, "LLM_PROVIDER")) || "anthropic").toLowerCase();
  const provider = providerRaw === "openai" ? "openai" : "anthropic";
  const apiKey = await resolveSecret(sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  const strong = await resolveSecret(
    sb,
    provider === "openai" ? "LLM_MODEL_OPENAI_STRONG" : "LLM_MODEL_ANTHROPIC_STRONG",
  );
  const standard = await resolveSecret(
    sb,
    provider === "openai" ? "LLM_MODEL_OPENAI" : "LLM_MODEL_ANTHROPIC",
  );
  const fallback = provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5";
  return {
    provider,
    model: strong || standard || fallback,
    apiKey,
    tier: strong ? "strong" : standard ? "configured" : "default",
  };
}

/**
 * What the data supports with no model involved. Counts only, cause stated as
 * unknown. This is the floor: if the model is unavailable or answers with
 * uncited text, the queue still ships something an admin can act on.
 */
export function deterministicInsight(item: AggregatedItem): ChecklistInsight {
  const c = item.counts;
  const parts: string[] = [];
  if (c.quality_miss) parts.push(`${c.quality_miss} valid quality-miss re-clean${c.quality_miss === 1 ? "" : "s"}`);
  if (c.scope_confusion) parts.push(`${c.scope_confusion} scope-confusion re-clean${c.scope_confusion === 1 ? "" : "s"}`);
  if (c.qc_case) parts.push(`${c.qc_case} QC case${c.qc_case === 1 ? "" : "s"}`);
  if (c.duration_variance) parts.push(`${c.duration_variance} duration-variance flag${c.duration_variance === 1 ? "" : "s"}`);
  if (c.recurrence) parts.push(`${c.recurrence} recurrence flag${c.recurrence === 1 ? "" : "s"}`);
  if (c.review_theme) parts.push(`${c.review_theme} review mention${c.review_theme === 1 ? "" : "s"} in this area`);

  const lead = c.quality_miss >= c.scope_confusion
    ? `"${item.item_text}" drew ${parts[0] || "repeat signal"} this cycle.`
    : `"${item.item_text}" drew ${parts[0] || "repeat signal"} this cycle — a scope-boundary pattern, not a quality one.`;

  const hypothesis = c.scope_confusion > c.quality_miss
    ? "Scope-confusion re-cleans point at unclear boundary language rather than a quality failure — the wording may not say plainly what is and is not included. Worth reviewing."
    : c.quality_miss > 0
      ? "This item may be under-specified about what 'done' looks like, or may be getting rushed. The data does not say which. Worth reviewing."
      : "Cause is unclear from available data — the counts show a pattern but not a reason.";

  return {
    item_id: item.item_id,
    observation: lead,
    numbers: `${parts.join(", ")} across ${item.distinct_bookings} booking${item.distinct_bookings === 1 ? "" : "s"} (checklists: ${item.checklists.join(", ") || "unassigned"}).`,
    hypothesis,
  };
}

/** A model claim survives only if its figures appear in the pulled counts. */
function citationOk(insight: ChecklistInsight, haystack: string): boolean {
  if (!insight.numbers || !/\d/.test(insight.numbers)) return false;
  if (!HYPOTHESIS_RE.test(insight.hypothesis || "")) return false;
  const nums = insight.numbers.match(/\d+/g) || [];
  return nums.length > 0 && nums.every((n) => haystack.includes(n));
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: `OpenAI ${res.status}: ${text.slice(0, 300)}` };
  try {
    const body = JSON.parse(text);
    const content = body?.choices?.[0]?.message?.content;
    if (!content) return { ok: false as const, error: "OpenAI returned no content" };
    return { ok: true as const, analysis: JSON.parse(content) };
  } catch {
    return { ok: false as const, error: "OpenAI content not JSON" };
  }
}

async function callAnthropic(apiKey: string, model: string, system: string, user: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      temperature: 0.1,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: `Anthropic ${res.status}: ${text.slice(0, 300)}` };
  try {
    const body = JSON.parse(text);
    const content = body?.content?.[0]?.text;
    if (!content) return { ok: false as const, error: "Anthropic returned no content" };
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    return { ok: true as const, analysis: JSON.parse(cleaned) };
  } catch {
    return { ok: false as const, error: "Anthropic content not JSON" };
  }
}

export async function generateChecklistInsights(
  sb: SB,
  items: AggregatedItem[],
  opts: { cycleLabel: string; maxInsights: number },
): Promise<ChecklistInsightResult> {
  const fallback: ChecklistInsightResult = {
    insights: items.slice(0, opts.maxInsights).map(deterministicInsight),
    model: "deterministic-fallback",
    model_version: "checklist-feedback-v1",
  };
  if (items.length === 0) return { ...fallback, insights: [] };

  const compact = items.slice(0, opts.maxInsights).map((i) => ({
    item_id: i.item_id,
    item_text: i.item_text,
    area: i.area,
    checklists: i.checklists,
    distinct_bookings: i.distinct_bookings,
    valid_quality_miss_recleans: i.counts.quality_miss,
    scope_confusion_recleans: i.counts.scope_confusion,
    qc_cases: i.counts.qc_case,
    review_area_mentions: i.counts.review_theme,
    duration_variance_flags: i.counts.duration_variance,
    recurrence_flags: i.counts.recurrence,
  }));
  const haystack = JSON.stringify(compact);

  const { provider, model, apiKey, tier } = await strongestModel(sb);
  if (!apiKey) {
    return { ...fallback, model: `${fallback.model} (no ${provider} key)` };
  }

  const system = `You write the Checklist Review queue for Novara Cleaning, a cleaning company.
Each input row is ONE checklist item with the real operational signal it drew this cycle.

Rules (non-negotiable):
- Use ONLY the numbers in the user JSON. Never invent a count, a cause, a property, or a cleaner.
- Return one object per item: {item_id, observation, numbers, hypothesis}.
- "numbers" must restate the actual counts from the JSON for that item. Every digit you write must appear in the JSON.
- "hypothesis" must hedge ("may", "could", "worth reviewing", "cause is unclear from available data"). Never a directive, never "you must", never "this proves".
- valid_quality_miss_recleans and scope_confusion_recleans are DIFFERENT signals. Quality-miss suggests the item was skipped, rushed, or under-specifies what "done" means. Scope-confusion suggests unclear or missing scope-boundary language — not a quality failure. Never add them together and never describe one as the other.
- duration_variance_flags on an item often mean the checklist is under-scoped for the real work, which may be a pricing or scope problem rather than a checklist problem. Say so as a possibility.
- recurrence_flags mean the same condition came back at the same property — that points at the item's STANDARD being insufficient, not its absence.
- review_area_mentions are matched to an AREA by keyword, not to this specific item. Never claim a review named this item.
- If the counts show a pattern but nothing indicates why, say the cause is unclear from available data. Do not guess.
- The queue informs a human decision. It never instructs a change.
Return JSON: { "insights": [ {item_id, observation, numbers, hypothesis}, ... ] }`;

  const user = `CYCLE ${opts.cycleLabel}
ITEMS ${JSON.stringify(compact)}`;

  const llm = provider === "anthropic"
    ? await callAnthropic(apiKey, model, system, user)
    : await callOpenAI(apiKey, model, system, user);

  if (!llm.ok) {
    return { ...fallback, model: `${model} failed → ${fallback.model}`, model_version: llm.error.slice(0, 180) };
  }

  const byId = new Map(items.map((i) => [i.item_id, i]));
  const raw = Array.isArray((llm.analysis as { insights?: unknown[] })?.insights)
    ? (llm.analysis as { insights: unknown[] }).insights
    : [];

  const cleaned: ChecklistInsight[] = [];
  for (const entry of raw) {
    const r = entry as Record<string, unknown>;
    const itemId = String(r?.item_id || "").trim();
    if (!byId.has(itemId)) continue;
    const insight: ChecklistInsight = {
      item_id: itemId,
      observation: String(r?.observation || "").trim(),
      numbers: String(r?.numbers || "").trim(),
      hypothesis: String(r?.hypothesis || "").trim(),
    };
    if (!insight.observation) continue;
    // An uncited or unhedged claim falls back to the counts-only version for
    // that item rather than dropping the item off the queue entirely.
    cleaned.push(citationOk(insight, haystack) ? insight : deterministicInsight(byId.get(itemId)!));
  }

  // Any item the model skipped still surfaces — it crossed the threshold.
  const covered = new Set(cleaned.map((i) => i.item_id));
  for (const item of items.slice(0, opts.maxInsights)) {
    if (!covered.has(item.item_id)) cleaned.push(deterministicInsight(item));
  }

  return {
    insights: cleaned.slice(0, opts.maxInsights),
    model,
    model_version: `${provider}:${tier}`,
  };
}
