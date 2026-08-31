// ─── /api/ops-assistant ───────────────────────────────────────────────────
//
// One endpoint for both doors and for both "search the docs" and the chat
// panel. GET returns the caller's thread. POST asks a question. The answer
// engine is the same function either way.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { groundAnswer, toChatMessage } from "@/lib/ops-assistant/answer";
import { searchDriveFiles, wantsDriveLookup } from "@/lib/ops-assistant/drive";
import { looksLikeDontKnow } from "@/lib/ops-assistant/feedback-loop";
import { financialScopeForRole } from "@/lib/ops-assistant/insight-access";
import { loadInsightFacts } from "@/lib/ops-assistant/insights";
import { loadGuideChunks } from "@/lib/ops-assistant/load-knowledge";
import { loadLiveFacts, wantsLiveData } from "@/lib/ops-assistant/live-data";
import { loadModelControl, polishAnswer } from "@/lib/ops-assistant/llm";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { screenSlugFromPath } from "@/lib/ops-assistant/retrieval";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";
import {
  appendMessage,
  getOrCreateThread,
  loadArticles,
  loadMessages,
  logTurn,
} from "@/lib/ops-assistant/thread";
import type { AskRequest, AssistantEntry, AssistantSurface, PageContext } from "@/lib/ops-assistant/types";
import { BUILTIN_ARTICLES } from "@/lib/ops-assistant/policy-articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}

function asSurface(v: unknown): AssistantSurface {
  return v === "docs" ? "docs" : "workspace";
}

function asEntry(v: unknown): AssistantEntry {
  return v === "search" ? "search" : "chat";
}

const RECORD_KINDS = new Set(["booking", "customer", "account", "cleaner"]);

function normalizePage(raw: unknown, surface: AssistantSurface): PageContext {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const path = String(obj.path || "");
  const rec = obj.record && typeof obj.record === "object" ? (obj.record as Record<string, unknown>) : null;
  const kind = String(rec?.kind || "");
  return {
    surface,
    path,
    docSlug: obj.docSlug ? String(obj.docSlug) : screenSlugFromPath(path),
    record:
      rec?.id && RECORD_KINDS.has(kind)
        ? { kind: kind as "booking" | "customer" | "account" | "cleaner", id: String(rec.id), label: rec.label ? String(rec.label) : undefined }
        : null,
  };
}

export async function GET(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    const sb = getOpsSupabase();
    if (!sb) return NextResponse.json({ threadId: null, messages: [], persisted: false });
    const threadId = await getOrCreateThread(sb, principal.userId);
    const messages = await loadMessages(sb, threadId);
    return NextResponse.json({ threadId, messages, persisted: true });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const principal = await requireOpsAssistant(req);
    const body = (await req.json()) as AskRequest;
    const message = String(body?.message || "").trim().slice(0, 4000);
    if (!message) return NextResponse.json({ error: "Ask a question." }, { status: 400 });

    const surface = asSurface(body.surface);
    const entry = asEntry(body.entry);
    const page = normalizePage(body.page, surface);

    const sb = getOpsSupabase();
    const chunks = loadGuideChunks();
    const dbArticles = await loadArticles(sb);
    const articles = dbArticles.length ? dbArticles : BUILTIN_ARTICLES;
    const settings = await loadModelControl(sb);

    let liveFacts = await loadLiveFacts({ supabase: sb, role: principal.role, page });
    if (wantsLiveData(message) && !liveFacts.length && page.surface === "workspace" && !page.record) {
      liveFacts = [
        {
          label: "Live record",
          value:
            "You're in the workspace but no booking, customer, or account is selected, so I don't have a live record to read. Open one and ask again.",
          source: "page context",
        },
      ];
    }

    // Financial aggregates for a VA never reach a query.
    const financialScope = financialScopeForRole(message, principal.role);
    let insightHypotheses: string[] = [];
    if (financialScope.kind !== "escalation") {
      const insight = await loadInsightFacts({ supabase: sb, role: principal.role, message });
      liveFacts = [...liveFacts, ...insight.facts];
      insightHypotheses = insight.hypotheses;
    }

    const driveHits =
      financialScope.kind === "escalation"
        ? []
        : wantsDriveLookup(message)
          ? await searchDriveFiles({ supabase: sb, role: principal.role, message, page })
          : [];

    const grounded = groundAnswer({
      message,
      surface,
      entry,
      role: principal.role,
      page,
      chunks,
      articles,
      liveFacts,
      moneyTerms: settings.money_adjacent_intents,
      insightHypotheses,
      driveHits,
    });

    let threadId: string | null = null;
    let history: Array<{ role: string; content: string }> = [];
    if (sb) {
      threadId = await getOrCreateThread(sb, principal.userId);
      const prior = await loadMessages(sb, threadId);
      history = prior.map((m) => ({ role: m.role, content: m.content }));
      await appendMessage(sb, {
        threadId,
        role: "user",
        content: message,
        surface,
        entry,
        page,
      });
    }

    const polish = await polishAnswer({
      sb,
      question: message,
      grounded: grounded.text,
      retrieved: grounded.retrieved,
      history,
      intent:
        grounded.intent === "insight" || grounded.moneyAdjacent
          ? grounded.intent === "insight"
            ? "insight-analysis"
            : "pricing"
          : grounded.intent,
      settings,
    });

    const chat = toChatMessage({
      grounded,
      surface,
      entry,
      polished: polish.text,
    });

    if (sb && threadId) {
      const saved = await appendMessage(sb, {
        threadId,
        role: "assistant",
        content: chat.content,
        citations: chat.citations,
        actions: chat.actions,
        surface,
        entry,
        page,
        escalation: chat.escalation,
        writeRefused: chat.writeRefused,
        didNotKnow: looksLikeDontKnow(chat.content),
      });
      await logTurn(sb, {
        threadId,
        userId: principal.userId,
        surface,
        entry,
        intent: grounded.intent,
        page,
        retrievedIds: grounded.retrieved.map((r) => r.chunk.id),
        model: polish.model,
        resolvedModel: polish.resolvedModel,
        tier: polish.servedTier,
        guardrail: chat.escalation ? "escalation" : chat.writeRefused ? "write_refused" : "none",
        latencyMs: Date.now() - started,
      });
      return NextResponse.json({ message: saved, threadId, persisted: true });
    }

    return NextResponse.json({ message: chat, threadId: "ephemeral", persisted: false });
  } catch (err) {
    return fail(err);
  }
}
