// ─── Model control (client/server shared) ────────────────────────────────
//
// Mirrors supabase/functions/_shared/llm.ts. Which model answers is
// configuration, so this file carries the shape and the defaults — never a
// key. API keys are resolved by NAME from the secrets manager at call time and
// never reach the browser.

export type ModelTier = "default" | "strongest" | "fallback";
export type LlmProvider = "anthropic" | "openai";

export const MODEL_CONTROL_SETTINGS_KEY = "model_control_settings";

export interface ModelControlSettings {
  provider: LlmProvider;
  tiers: Record<ModelTier, string>;
  money_adjacent_intents: string[];
  timeout_ms: number;
  max_tokens: number;
}

export const DEFAULT_MODEL_CONTROL: ModelControlSettings = {
  provider: "anthropic",
  tiers: {
    default: "claude-sonnet-5",
    strongest: "claude-opus-5",
    fallback: "claude-sonnet-5",
  },
  money_adjacent_intents: [
    "pricing",
    "quote",
    "pay",
    "payout",
    "payroll",
    "refund",
    "invoice",
    "billing",
    "discount",
    "credit",
  ],
  timeout_ms: 60000,
  max_tokens: 3000,
};

export const TIER_COPY: Record<ModelTier, { label: string; detail: string }> = {
  default: {
    label: "Default",
    detail:
      "General assistant traffic — questions, policy lookups, drafting. Speed matters more than depth here.",
  },
  strongest: {
    label: "Strongest / Analysis",
    detail:
      "Weekly report insights, checklist feedback insights, and money-adjacent assistant questions. A confident-wrong answer is expensive in all three.",
  },
  fallback: {
    label: "Fallback",
    detail:
      "Runs when the Strongest tier is unavailable or times out, so an outage degrades the answer instead of dropping the request. Every fallback is logged.",
  },
};

export const MODEL_TIERS: ModelTier[] = ["default", "strongest", "fallback"];

function asProvider(v: unknown): LlmProvider {
  return String(v || "").toLowerCase() === "openai" ? "openai" : "anthropic";
}

export function mergeModelControl(raw: unknown): ModelControlSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<ModelControlSettings>;
  const tiers = (obj.tiers && typeof obj.tiers === "object"
    ? obj.tiers
    : {}) as Partial<Record<ModelTier, string>>;
  const intents = Array.isArray(obj.money_adjacent_intents)
    ? obj.money_adjacent_intents.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
    : DEFAULT_MODEL_CONTROL.money_adjacent_intents;
  return {
    provider: asProvider(obj.provider ?? DEFAULT_MODEL_CONTROL.provider),
    tiers: {
      default: String(tiers.default || DEFAULT_MODEL_CONTROL.tiers.default).trim(),
      strongest: String(tiers.strongest || DEFAULT_MODEL_CONTROL.tiers.strongest).trim(),
      fallback: String(tiers.fallback || DEFAULT_MODEL_CONTROL.tiers.fallback).trim(),
    },
    money_adjacent_intents: intents,
    timeout_ms: Math.max(5000, Number(obj.timeout_ms) || DEFAULT_MODEL_CONTROL.timeout_ms),
    max_tokens: Math.max(256, Number(obj.max_tokens) || DEFAULT_MODEL_CONTROL.max_tokens),
  };
}

/** Which tier answers a question with this intent. */
export function tierForIntent(
  intent: string | null | undefined,
  settings: ModelControlSettings,
): ModelTier {
  const value = String(intent || "").toLowerCase();
  if (!value) return "default";
  return settings.money_adjacent_intents.some((i) => value.includes(i)) ? "strongest" : "default";
}

/**
 * A fallback tier identical to the strongest one buys nothing — the retry
 * repeats the failure. Worth saying out loud in the editor rather than
 * letting an operator think they have a safety net they don't.
 */
export function fallbackIsDistinct(settings: ModelControlSettings): boolean {
  return settings.tiers.fallback !== settings.tiers.strongest;
}
