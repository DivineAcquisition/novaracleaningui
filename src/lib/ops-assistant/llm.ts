// ─── Model call for the Ops Assistant ─────────────────────────────────────
//
// Mirrors the model-control layer (app_settings.model_control_settings,
// ai_model_invocations) used by the weekly report and chat-agent. Keys are
// resolved by NAME from app_secrets / env. Never stored here.
//
// The assistant still answers when no key is configured: the grounded
// extractive path in answer.ts is the source of truth, and the model is a
// fluency layer on top of it. Citations and actions always come from
// retrieval, never from the model.

import { loadSystemPrompt } from "./prompt";
import type { Retrieved } from "./types";

export type ModelTier = "default" | "strongest" | "fallback";
export type LlmProvider = "anthropic" | "openai";

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
  timeout_ms: 45000,
  max_tokens: 1200,
};

function asProvider(v: unknown): LlmProvider {
  return String(v || "").toLowerCase() === "openai" ? "openai" : "anthropic";
}

export function mergeModelControl(raw: unknown): ModelControlSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Partial<ModelControlSettings>;
  const tiers = (obj.tiers && typeof obj.tiers === "object" ? obj.tiers : {}) as Partial<
    Record<ModelTier, string>
  >;
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

export function tierForIntent(intent: string | null | undefined, settings: ModelControlSettings): ModelTier {
  const value = String(intent || "").toLowerCase();
  if (!value) return "default";
  if (/\b(insight|analysis|weekly-report|feedback-loop)\b/.test(value)) return "strongest";
  return settings.money_adjacent_intents.some((i) => value.includes(i)) ? "strongest" : "default";
}

type SB = { from: (t: string) => any };

export async function loadModelControl(sb: SB | null): Promise<ModelControlSettings> {
  if (!sb) return DEFAULT_MODEL_CONTROL;
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "model_control_settings")
      .maybeSingle();
    if (data?.value) return mergeModelControl(data.value);
  } catch {
    // Unmerged model-control migration — defaults are fine.
  }
  return DEFAULT_MODEL_CONTROL;
}

async function resolveSecret(sb: SB | null, name: string): Promise<string> {
  if (sb) {
    try {
      const { data } = await sb.from("app_secrets").select("value").eq("key", name).maybeSingle();
      if (data?.value && typeof data.value === "string") return data.value.trim();
    } catch {
      /* fall through */
    }
  }
  return (process.env[name] || "").trim();
}

export interface PolishResult {
  text: string | null;
  requestedTier: ModelTier;
  servedTier: ModelTier;
  model: string;
  resolvedModel: string | null;
  fellBack: boolean;
  latencyMs: number;
  ok: boolean;
  error: string | null;
}

/** @deprecated Use DEFAULT_SYSTEM_PROMPT from ./prompt — kept so verify still finds the guardrail strings. */
export { DEFAULT_SYSTEM_PROMPT as SYSTEM } from "./prompt";

export function buildUserPrompt(args: {
  question: string;
  grounded: string;
  retrieved: Retrieved[];
  history: Array<{ role: string; content: string }>;
}): string {
  const chunks = args.retrieved
    .map((r) => {
      const flag = [
        r.onCurrentPage ? "CURRENT PAGE" : "",
        r.chunk.containsGate ? "HARD STOP" : "",
        r.chunk.containsDiscrepancy ? "DISCREPANCY" : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `### ${r.chunk.docTitle} — ${r.chunk.section} (${r.chunk.id})${flag ? ` [${flag}]` : ""}\n${r.chunk.text}`;
    })
    .join("\n\n");

  const history = args.history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  return [
    history ? `Conversation so far:\n${history}\n` : "",
    `Question:\n${args.question}`,
    "",
    `Grounded draft (prefer this substance; you may tighten the wording, not the facts):\n${args.grounded}`,
    "",
    `Retrieved documentation:\n${chunks || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function callAnthropic(
  apiKey: string,
  model: string,
  user: string,
  opts: { maxTokens: number; timeoutMs: number; system: string },
): Promise<{ ok: boolean; text?: string; resolvedModel?: string; error?: string }> {
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
        system: opts.system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Anthropic ${res.status}: ${body.slice(0, 240)}` };
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
  user: string,
  opts: { maxTokens: number; timeoutMs: number; system: string },
): Promise<{ ok: boolean; text?: string; resolvedModel?: string; error?: string }> {
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
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: user },
        ],
      }),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, error: `OpenAI ${res.status}: ${body.slice(0, 240)}` };
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

export async function polishAnswer(args: {
  sb: SB | null;
  question: string;
  grounded: string;
  retrieved: Retrieved[];
  history: Array<{ role: string; content: string }>;
  intent: string;
  settings?: ModelControlSettings;
}): Promise<PolishResult> {
  const settings = args.settings || (await loadModelControl(args.sb));
  const requestedTier = tierForIntent(args.intent, settings);
  const provider = settings.provider;
  const apiKey = await resolveSecret(args.sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");

  const empty = (error: string): PolishResult => ({
    text: null,
    requestedTier,
    servedTier: requestedTier,
    model: settings.tiers[requestedTier],
    resolvedModel: null,
    fellBack: false,
    latencyMs: 0,
    ok: false,
    error,
  });

  if (!apiKey) return empty(`${provider} API key is not configured`);

  const prompt = await loadSystemPrompt(args.sb);
  const user = buildUserPrompt({
    question: args.question,
    grounded: args.grounded,
    retrieved: args.retrieved,
    history: args.history,
  });

  const call = provider === "openai" ? callOpenAI : callAnthropic;
  const started = Date.now();
  const callOpts = {
    maxTokens: settings.max_tokens,
    timeoutMs: settings.timeout_ms,
    system: prompt.body,
  };
  let raw = await call(apiKey, settings.tiers[requestedTier], user, callOpts);
  let servedTier = requestedTier;
  let fellBack = false;

  if (!raw.ok && requestedTier !== "fallback" && settings.tiers.fallback !== settings.tiers[requestedTier]) {
    const retry = await call(apiKey, settings.tiers.fallback, user, callOpts);
    if (retry.ok) {
      raw = retry;
      servedTier = "fallback";
      fellBack = true;
    }
  }

  const result: PolishResult = {
    text: raw.ok ? raw.text || null : null,
    requestedTier,
    servedTier,
    model: settings.tiers[servedTier],
    resolvedModel: raw.resolvedModel || null,
    fellBack,
    latencyMs: Date.now() - started,
    ok: Boolean(raw.ok && raw.text),
    error: raw.ok ? null : raw.error || "Model call failed",
  };

  if (args.sb) {
    try {
      await args.sb.from("ai_model_invocations").insert({
        surface: "ops-assistant",
        intent: args.intent,
        provider,
        requested_tier: requestedTier,
        served_tier: servedTier,
        requested_model: settings.tiers[requestedTier],
        served_model: settings.tiers[servedTier],
        resolved_model: result.resolvedModel,
        fell_back: fellBack,
        fallback_reason: fellBack ? "strongest unavailable" : null,
        latency_ms: result.latencyMs,
        ok: result.ok,
        error: result.error,
      });
    } catch {
      // Table may not exist until the model-control migration lands.
    }
  }

  return result;
}

/** Strongest-configured-model JSON/text completion for the feedback-loop insights. */
export async function completeWithConfiguredModel(args: {
  sb: SB | null;
  system: string;
  user: string;
  intent: string;
  settings?: ModelControlSettings;
  maxTokens?: number;
}): Promise<{ text: string | null; model: string; ok: boolean; error: string | null }> {
  const settings = args.settings || (await loadModelControl(args.sb));
  const requestedTier = tierForIntent(args.intent, settings);
  const provider = settings.provider;
  const apiKey = await resolveSecret(args.sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY");
  if (!apiKey) return { text: null, model: settings.tiers[requestedTier], ok: false, error: "no api key" };
  const call = provider === "openai" ? callOpenAI : callAnthropic;
  const opts = {
    maxTokens: args.maxTokens || settings.max_tokens,
    timeoutMs: settings.timeout_ms,
    system: args.system,
  };
  let raw = await call(apiKey, settings.tiers[requestedTier], args.user, opts);
  if (!raw.ok && settings.tiers.fallback !== settings.tiers[requestedTier]) {
    const retry = await call(apiKey, settings.tiers.fallback, args.user, opts);
    if (retry.ok) raw = retry;
  }
  return {
    text: raw.ok ? raw.text || null : null,
    model: settings.tiers[requestedTier],
    ok: Boolean(raw.ok && raw.text),
    error: raw.ok ? null : raw.error || "Model call failed",
  };
}
