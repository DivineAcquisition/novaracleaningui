// ─── One conversation per user, regardless of which door they used ────────

import type { AssistantEntry, AssistantSurface, ChatMessage, Citation, NextAction } from "./types";

type SB = { from: (t: string) => any };

export async function loadArticles(sb: SB | null) {
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("ops_assistant_articles")
      .select("id, slug, title, category, body, escalation, admin_only, updated_at")
      .order("updated_at", { ascending: false });
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      title: String(row.title),
      category: String(row.category || "Policy"),
      body: String(row.body || ""),
      escalation: Boolean(row.escalation),
      adminOnly: Boolean(row.admin_only),
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    }));
  } catch {
    return [];
  }
}

export async function getOrCreateThread(sb: SB, userId: string): Promise<string> {
  const { data: existing } = await sb
    .from("ops_assistant_threads")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data, error } = await sb
    .from("ops_assistant_threads")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function parseJson<T>(v: unknown, fallback: T): T {
  if (Array.isArray(v)) return v as T;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function loadMessages(sb: SB, threadId: string): Promise<ChatMessage[]> {
  const cols =
    "id, role, content, citations, actions, surface, entry, escalation, write_refused, rating, rating_note, did_not_know, created_at";
  let { data, error } = await sb
    .from("ops_assistant_messages")
    .select(cols)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    const retry = await sb
      .from("ops_assistant_messages")
      .select("id, role, content, citations, actions, surface, entry, escalation, write_refused, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);
    data = retry.data;
    error = retry.error;
  }
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content || ""),
    citations: parseJson<Citation[]>(row.citations, []),
    actions: parseJson<NextAction[]>(row.actions, []),
    surface: row.surface === "docs" ? "docs" : "workspace",
    entry: row.entry === "search" ? "search" : "chat",
    escalation: Boolean(row.escalation),
    writeRefused: Boolean(row.write_refused),
    rating: row.rating === "helpful" || row.rating === "not_helpful" ? (row.rating as "helpful" | "not_helpful") : null,
    ratingNote: row.rating_note ? String(row.rating_note) : null,
    didNotKnow: Boolean(row.did_not_know),
    createdAt: String(row.created_at || ""),
  }));
}

export async function appendMessage(
  sb: SB,
  args: {
    threadId: string;
    role: "user" | "assistant";
    content: string;
    citations?: Citation[];
    actions?: NextAction[];
    surface: AssistantSurface;
    entry: AssistantEntry;
    page?: unknown;
    escalation?: boolean;
    writeRefused?: boolean;
    didNotKnow?: boolean;
  },
): Promise<ChatMessage> {
  const { data, error } = await sb
    .from("ops_assistant_messages")
    .insert({
      thread_id: args.threadId,
      role: args.role,
      content: args.content,
      citations: args.citations || [],
      actions: args.actions || [],
      surface: args.surface,
      entry: args.entry,
      page_context: args.page || null,
      escalation: Boolean(args.escalation),
      write_refused: Boolean(args.writeRefused),
      did_not_know: Boolean(args.didNotKnow),
    })
    .select("id, role, content, citations, actions, surface, entry, escalation, write_refused, rating, rating_note, did_not_know, created_at")
    .single();
  if (error) throw error;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    role: args.role,
    content: String(row.content || args.content),
    citations: parseJson<Citation[]>(row.citations, args.citations || []),
    actions: parseJson<NextAction[]>(row.actions, args.actions || []),
    surface: args.surface,
    entry: args.entry,
    escalation: Boolean(row.escalation),
    writeRefused: Boolean(row.write_refused),
    rating: row.rating === "helpful" || row.rating === "not_helpful" ? (row.rating as "helpful" | "not_helpful") : null,
    ratingNote: row.rating_note ? String(row.rating_note) : null,
    didNotKnow: Boolean(row.did_not_know),
    createdAt: String(row.created_at || new Date().toISOString()),
  };
}

export async function logTurn(
  sb: SB,
  args: {
    threadId: string;
    userId: string;
    surface: AssistantSurface;
    entry: AssistantEntry;
    intent: string;
    page?: unknown;
    retrievedIds: string[];
    model: string | null;
    resolvedModel: string | null;
    tier: string | null;
    guardrail: string;
    latencyMs: number;
  },
): Promise<void> {
  try {
    await sb.from("ops_assistant_turns").insert({
      thread_id: args.threadId,
      user_id: args.userId,
      surface: args.surface,
      entry: args.entry,
      intent: args.intent,
      page_context: args.page || null,
      retrieved_chunk_ids: args.retrievedIds,
      model: args.model,
      resolved_model: args.resolvedModel,
      tier: args.tier,
      guardrail: args.guardrail,
      latency_ms: args.latencyMs,
    });
  } catch (err) {
    console.warn("[ops-assistant] turn log failed", err);
  }
}
