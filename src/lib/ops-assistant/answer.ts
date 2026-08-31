// ─── One answer engine ────────────────────────────────────────────────────
//
// Search on the docs site and a message in the chat panel both land here.
// There is no keyword-search path that could disagree with the assistant.

import { uniqueCitations, perDocLine } from "./citations";
import {
  combineGuardrails,
  isMoneyAdjacent,
  isWalkthroughIntent,
  stripRecalledMoney,
} from "./guardrails";
import { retrieveChunks } from "./retrieval";
import { articlesToChunks, BUILTIN_ARTICLES } from "./policy-articles";
import type { GuideChunk } from "./guide-chunks";
import { actionsFor, formatWalkthrough } from "./walkthrough";
import type {
  AnyChunk,
  AssistantEntry,
  AssistantRole,
  AssistantSurface,
  Citation,
  ChatMessage,
  NextAction,
  PageContext,
  PolicyArticle,
  Retrieved,
} from "./types";

export interface LiveFact {
  label: string;
  value: string;
  /** Where this number/status came from, so it cannot be mistaken for recall. */
  source: string;
}

export interface AnswerInput {
  message: string;
  surface: AssistantSurface;
  entry: AssistantEntry;
  role: AssistantRole;
  page?: PageContext | null;
  chunks: GuideChunk[];
  articles?: PolicyArticle[];
  liveFacts?: LiveFact[];
  /** Money-adjacent extra terms from model-control settings, if loaded. */
  moneyTerms?: string[];
}

export interface GroundedAnswer {
  text: string;
  citations: Citation[];
  actions: NextAction[];
  escalation: boolean;
  writeRefused: boolean;
  intent: "howto" | "live" | "walkthrough" | "mixed" | "escalation";
  retrieved: Retrieved[];
  moneyAdjacent: boolean;
}

function excerpt(chunk: AnyChunk, max = 700): string {
  const body = chunk.text.split("\n").slice(1).join("\n").replace(/\n{2,}/g, "\n").trim();
  return body.length > max ? `${body.slice(0, max).trim()}…` : body;
}

function composeHowTo(retrieved: Retrieved[], moneyAdjacent: boolean): string {
  if (!retrieved.length) {
    return "I don't have a workspace guide that covers that yet. Try the name of the screen, or open the relevant page and ask again.";
  }
  const parts: string[] = [];
  const current = retrieved.find((r) => r.onCurrentPage) || retrieved[0];
  const rest = retrieved.filter((r) => r.chunk.id !== current.chunk.id).slice(0, 2);

  const chunkText = moneyAdjacent ? stripRecalledMoney(excerpt(current.chunk)) : excerpt(current.chunk);
  parts.push(`Per the ${current.chunk.docTitle} guide (${current.chunk.section}):`);
  parts.push("");
  parts.push(chunkText);
  if (current.chunk.containsGate) {
    parts.push("");
    parts.push("This section includes a hard stop. Quote the condition as written — there may be no override.");
  }
  if (current.chunk.containsDiscrepancy) {
    parts.push("");
    parts.push("This section records a known disagreement between sources. Do not resolve it silently — surface both.");
  }
  if (current.chunk.screenshotCaptions.length) {
    parts.push("");
    parts.push(
      `There is an annotated screenshot of this step in the guide (“${current.chunk.screenshotCaptions[0]}”). Open the full page if a picture would help more than this summary.`,
    );
  }
  if (current.chunk.lastVerified) {
    parts.push("");
    parts.push(`Last verified against the code on ${current.chunk.lastVerified}.`);
  }

  for (const other of rest) {
    const text = moneyAdjacent ? stripRecalledMoney(excerpt(other.chunk, 280)) : excerpt(other.chunk, 280);
    parts.push("");
    parts.push(`Also, per the ${other.chunk.docTitle} guide (${other.chunk.section}): ${text}`);
  }

  return parts.join("\n");
}

function composeLive(facts: LiveFact[]): string {
  if (!facts.length) return "";
  const lines = ["From the live record in front of you (permission-scoped, read-only):"];
  for (const f of facts) {
    lines.push(`- ${f.label}: ${f.value} (${f.source})`);
  }
  return lines.join("\n");
}

export function groundAnswer(input: AnswerInput): GroundedAnswer {
  const articles = input.articles?.length ? input.articles : BUILTIN_ARTICLES;
  const policyChunks = articlesToChunks(
    input.role === "admin" ? articles : articles.filter((a) => !a.adminOnly),
  );
  const allChunks: AnyChunk[] = [...input.chunks, ...policyChunks];

  const escalationReasons = articles.filter((a) => a.escalation).map((a) => a.title);
  const guard = combineGuardrails(input.message, escalationReasons);
  const moneyAdjacent = isMoneyAdjacent(input.message, input.moneyTerms || []);
  const walkthrough = isWalkthroughIntent(input.message);
  const hasLive = (input.liveFacts || []).length > 0;

  const retrieved = retrieveChunks({
    query: input.message,
    chunks: allChunks,
    role: input.role,
    page: input.page,
    limit: walkthrough ? 8 : 6,
  });

  const citations = uniqueCitations(retrieved.map((r) => r.chunk));
  let text = "";
  let actions: NextAction[] = [];
  let intent: GroundedAnswer["intent"] = "howto";

  if (guard.kind === "escalation") {
    intent = "escalation";
    const policyHit = retrieved.find((r) => (r.chunk as { escalation?: boolean }).escalation);
    text = [
      "Confirm with management before you act on this.",
      guard.reason,
      policyHit ? excerpt(policyHit.chunk, 400) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  } else if (walkthrough) {
    intent = "walkthrough";
    const built = formatWalkthrough({ retrieved, surface: input.surface });
    text = built.prose;
    actions = built.actions;
  } else {
    text = composeHowTo(retrieved, moneyAdjacent);
    actions = actionsFor(retrieved, input.surface);
    if (hasLive) intent = retrieved.length ? "mixed" : "live";
    else intent = "howto";
  }

  if (hasLive) {
    const live = composeLive(input.liveFacts || []);
    text = text ? `${text}\n\n${live}` : live;
    if (intent === "howto") intent = "mixed";
  }

  if (moneyAdjacent && !(input.liveFacts || []).some((f) => /price|pay|quote|rate/i.test(f.label))) {
    text +=
      "\n\nPricing and pay figures are computed from live configuration, not recalled from a guide. I need the live inputs (home size, service, ZIP, date) — or to be looking at the booking — before I can quote a number.";
  }

  if (guard.kind === "write_refused") {
    text = `${guard.reason}\n\n${text}`;
  }

  const per = perDocLine(citations);
  if (per && !text.startsWith("Per the") && intent !== "escalation") {
    text = `${per}\n\n${text}`;
  }

  return {
    text: text.trim(),
    citations,
    actions,
    escalation: guard.kind === "escalation",
    writeRefused: guard.kind === "write_refused",
    intent,
    retrieved,
    moneyAdjacent,
  };
}

export function toChatMessage(args: {
  grounded: GroundedAnswer;
  surface: AssistantSurface;
  entry: AssistantEntry;
  polished?: string | null;
}): ChatMessage {
  return {
    id: `tmp-${Date.now()}`,
    role: "assistant",
    content: (args.polished && args.polished.trim()) || args.grounded.text,
    citations: args.grounded.citations,
    actions: args.grounded.actions,
    surface: args.surface,
    entry: args.entry,
    escalation: args.grounded.escalation,
    writeRefused: args.grounded.writeRefused,
    createdAt: new Date().toISOString(),
  };
}
