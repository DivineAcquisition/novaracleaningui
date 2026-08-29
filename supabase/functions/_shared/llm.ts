// ─── Model control layer ─────────────────────────────────────────────────
//
// One place that decides which model answers, calls it, degrades when the
// chosen tier is unavailable, and records what actually produced every
// response. Model choice was previously copy-pasted inline in three call
// sites with three different defaults, which meant "what model wrote this?"
// had no answer and changing it meant a deploy.
//
// Three tiers, all configuration:
//
//   default    general assistant traffic
//   strongest  analysis where a confident-wrong answer is expensive —
//              report insights, checklist insights, anything money-adjacent
//   fallback   what runs when the strongest tier is unavailable, so a
//              provider outage degrades the answer instead of dropping it
//
// Values live in app_settings.model_control_settings and are admin-editable,
// so switching models takes effect on the next request with no redeploy.
//
// The API key is NEVER in this file, in config, or in the repo. It is
// resolved by NAME (ANTHROPIC_API_KEY / OPENAI_API_KEY) from app_secrets or
// the runtime environment.

import { resolveSecret } from "./app-secrets.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type ModelTier = "default" | "strongest" | "fallback";
export type LlmProvider = "anthropic" | "openai";

export const MODEL_CONTROL_SETTINGS_KEY = "model_control_settings";

export interface ModelControlSettings {
  provider: LlmProvider;
  tiers: Record<ModelTier, string>;
  /**
   * Assistant intents that must be answered by the strongest tier. Pricing and
   * pay answers get quoted back to a customer or a contractor, so a plausible
   * wrong number is worse than a slow right one.
   */
  money_adjacent_intents: string[];
  /** Give up on a tier and fall back rather than hanging a request. */
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

function asProvider(v: unknown): LlmProvider {
  return String(v || "").toLowerCase() === "openai" ? "openai" : "anthropic";
}

export function mergeModelControl(raw: unknown): ModelControlSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<ModelControlSettings>;
  const tiers = (obj.tiers && typeof obj.tiers === "object" ? obj.tiers : {}) as Partial<Record<ModelTier, string>>;
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

export async function loadModelControl(sb: SB): Promise<ModelControlSettings> {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", MODEL_CONTROL_SETTINGS_KEY)
      .maybeSingle();
    if (data?.value) return mergeModelControl(data.value);
  } catch (err) {
    console.warn("[llm] settings read failed, using defaults", err);
  }
  return DEFAULT_MODEL_CONTROL;
}

/** Money-adjacent questions answer from the strongest tier. */
export function tierForIntent(
  intent: string | null | undefined,
  settings: ModelControlSettings,
): ModelTier {
  const value = String(intent || "").toLowerCase();
  if (!value) return "default";
  return settings.money_adjacent_intents.some((i) => value.includes(i)) ? "strongest" : "default";
}

async function apiKeyFor(sb: SB, provider: LlmProvider): Promise<string> {
  // By name only. The value lives in the secrets manager, never in the repo.
  return await resolveSecret(sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
}

interface RawCall {
  ok: boolean;
  text?: string;
  /** The model string the provider says answered — not the one we asked for. */
  resolvedModel?: string;
  error?: string;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  opts: { maxTokens: number; timeoutMs: number; jsonMode: boolean },
): Promise<RawCall> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens,
        temperature: 0.1,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Anthropic ${res.status}: ${body.slice(0, 300)}` };
    const parsed = JSON.parse(body);
    const content = parsed?.content?.[0]?.text;
    if (!content) return { ok: false, error: "Anthropic returned no content" };
    return { ok: true, text: String(content), resolvedModel: String(parsed?.model || model) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /abort/i.test(message) ? `Timed out after ${opts.timeoutMs}ms` : message };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  opts: { maxTokens: number; timeoutMs: number; jsonMode: boolean },
): Promise<RawCall> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: opts.maxTokens,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `OpenAI ${res.status}: ${body.slice(0, 300)}` };
    const parsed = JSON.parse(body);
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "OpenAI returned no content" };
    return { ok: true, text: String(content), resolvedModel: String(parsed?.model || model) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: /abort/i.test(message) ? `Timed out after ${opts.timeoutMs}ms` : message };
  } finally {
    clearTimeout(timer);
  }
}

export interface ModelCallResult {
  ok: boolean;
  text: string | null;
  /** Parsed JSON when jsonMode was requested and the reply parsed. */
  json: unknown | null;
  /** Tier actually used — differs from the one asked for after a fallback. */
  tier: ModelTier;
  requestedTier: ModelTier;
  /** What we asked for, and what the provider says answered. */
  model: string;
  resolvedModel: string | null;
  provider: LlmProvider;
  fellBack: boolean;
  fallbackReason: string | null;
  latencyMs: number;
  error: string | null;
}

function parseJson(text: string): unknown | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Call the model for a tier, degrading to the fallback tier if it fails.
 *
 * Every invocation is logged with the model that actually answered, so a
 * response can always be traced to the model that produced it.
 */
export async function callModel(
  sb: SB,
  args: {
    tier: ModelTier;
    system: string;
    user: string;
    /** Where this came from, for the log: "weekly-report", "admin-chat-agent". */
    surface: string;
    /** Assistant intent, when the caller has one. */
    intent?: string | null;
    jsonMode?: boolean;
    settings?: ModelControlSettings;
    maxTokens?: number;
  },
): Promise<ModelCallResult> {
  const settings = args.settings || (await loadModelControl(sb));
  const provider = settings.provider;
  const jsonMode = args.jsonMode !== false;
  const maxTokens = args.maxTokens || settings.max_tokens;

  const base: Omit<ModelCallResult, "ok" | "text" | "json" | "latencyMs" | "error"> = {
    tier: args.tier,
    requestedTier: args.tier,
    model: settings.tiers[args.tier],
    resolvedModel: null,
    provider,
    fellBack: false,
    fallbackReason: null,
  };

  const apiKey = await apiKeyFor(sb, provider);
  if (!apiKey) {
    const result: ModelCallResult = {
      ...base,
      ok: false,
      text: null,
      json: null,
      latencyMs: 0,
      error: `${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} is not configured in the secrets manager`,
    };
    await logInvocation(sb, args.surface, args.intent ?? null, result);
    return result;
  }

  const attempt = async (tier: ModelTier): Promise<{ raw: RawCall; ms: number }> => {
    const started = Date.now();
    const call = provider === "anthropic" ? callAnthropic : callOpenAI;
    const raw = await call(apiKey, settings.tiers[tier], args.system, args.user, {
      maxTokens,
      timeoutMs: settings.timeout_ms,
      jsonMode,
    });
    return { raw, ms: Date.now() - started };
  };

  let { raw, ms } = await attempt(args.tier);
  let tier = args.tier;
  let fellBack = false;
  let fallbackReason: string | null = null;

  // A strongest-tier outage degrades to the fallback tier rather than taking
  // the request down. Falling back to the same model would just repeat the
  // failure, so it only runs when the fallback is a different model.
  if (!raw.ok && args.tier !== "fallback" && settings.tiers.fallback !== settings.tiers[args.tier]) {
    fallbackReason = raw.error || "unknown error";
    const retry = await attempt("fallback");
    if (retry.raw.ok) {
      raw = retry.raw;
      ms += retry.ms;
      tier = "fallback";
      fellBack = true;
    } else {
      ms += retry.ms;
      raw = { ok: false, error: `${fallbackReason} · fallback also failed: ${retry.raw.error}` };
    }
  }

  const result: ModelCallResult = {
    ...base,
    tier,
    model: settings.tiers[tier],
    resolvedModel: raw.resolvedModel || null,
    fellBack,
    fallbackReason,
    ok: raw.ok,
    text: raw.text ?? null,
    json: raw.ok && jsonMode && raw.text ? parseJson(raw.text) : null,
    latencyMs: ms,
    error: raw.ok ? null : raw.error || "Model call failed",
  };

  await logInvocation(sb, args.surface, args.intent ?? null, result);
  return result;
}

/** Never throws — a logging failure must not fail the request it describes. */
async function logInvocation(
  sb: SB,
  surface: string,
  intent: string | null,
  result: ModelCallResult,
): Promise<void> {
  try {
    await sb.from("ai_model_invocations").insert({
      surface,
      intent,
      provider: result.provider,
      requested_tier: result.requestedTier,
      served_tier: result.tier,
      requested_model: DEFAULT_MODEL_CONTROL.tiers[result.requestedTier] === result.model
        ? result.model
        : result.model,
      served_model: result.model,
      resolved_model: result.resolvedModel,
      fell_back: result.fellBack,
      fallback_reason: result.fallbackReason,
      latency_ms: result.latencyMs,
      ok: result.ok,
      error: result.error,
    });
  } catch (err) {
    console.warn("[llm] invocation log failed", err);
  }
}

/** Human label for a served response, for UI and PDF attribution. */
export function modelLabel(result: ModelCallResult): string {
  const served = result.resolvedModel || result.model;
  return result.fellBack ? `${served} (fallback from ${result.requestedTier})` : served;
}
