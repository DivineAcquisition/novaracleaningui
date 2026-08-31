// ─── Multi-step walkthroughs from the real documentation ──────────────────
//
// "Walk me through onboarding a new commercial account" should return the
// sequence the guide actually contains, not a plausible paraphrase, and —
// when the person is in the live workspace — a clickable next action rather
// than a description of where to go.

import type { AnyChunk, AssistantSurface, NextAction, Retrieved } from "./types";

export interface WalkthroughStep {
  n: number;
  text: string;
}

export function extractSteps(text: string): WalkthroughStep[] {
  const lines = (text || "").split("\n");
  const steps: WalkthroughStep[] = [];
  for (const line of lines) {
    const m = /^\s*(?:#{2,3}\s+)?(?:(\d+)[.)]|[-*])\s+(.+)$/.exec(line);
    if (!m) continue;
    const body = (m[2] || "").trim();
    if (body.length < 8) continue;
    // Skip markdown table rows and screenshot asides.
    if (/^\|/.test(body) || /^\(Screenshot/.test(body)) continue;
    steps.push({ n: m[1] ? Number(m[1]) : steps.length + 1, text: body.replace(/\s+/g, " ") });
  }
  // Prefer explicitly numbered steps when mixed with bullets.
  const numbered = steps.filter((s) => Number.isFinite(s.n) && s.n > 0);
  const unique = numbered.length >= 3 ? numbered : steps;
  return unique.slice(0, 12);
}

export function actionsFor(
  retrieved: Retrieved[],
  surface: AssistantSurface,
): NextAction[] {
  const actions: NextAction[] = [];
  const seen = new Set<string>();

  const push = (a: NextAction) => {
    if (!a.href || seen.has(a.href)) return;
    seen.add(a.href);
    actions.push(a);
  };

  for (const { chunk } of retrieved) {
    if (surface === "workspace" && chunk.where) {
      push({
        label: `Open ${chunk.docTitle} in the workspace`,
        href: chunk.where,
        kind: "workspace",
      });
    }
    if (chunk.docsPath) {
      push({
        label:
          chunk.screenshotCaptions.length > 0
            ? `See the ${chunk.docTitle} guide (includes screenshots)`
            : `Read ${chunk.docTitle} — ${chunk.section}`,
        href: chunk.docsPath,
        kind: "docs",
      });
    }
  }

  return actions.slice(0, 4);
}

export function formatWalkthrough(args: {
  retrieved: Retrieved[];
  surface: AssistantSurface;
}): { prose: string; actions: NextAction[] } {
  const primary = args.retrieved[0]?.chunk;
  if (!primary) {
    return { prose: "I don't have a documented sequence for that yet.", actions: [] };
  }

  const steps = extractSteps(primary.text);
  const fromOther = args.retrieved.slice(1).flatMap((r) => extractSteps(r.chunk.text)).slice(0, 4);

  const lines: string[] = [];
  lines.push(`Per the ${primary.docTitle} guide (${primary.section}):`);
  if (steps.length) {
    for (const [i, step] of steps.entries()) {
      lines.push(`${i + 1}. ${step.text}`);
    }
  } else {
    // No numbered list — quote the section rather than invent steps.
    const excerpt = primary.text.split("\n").slice(1).join(" ").replace(/\s+/g, " ").trim();
    lines.push(excerpt.slice(0, 900));
  }
  if (fromOther.length && steps.length < 4) {
    lines.push("");
    lines.push("Related steps from other guides:");
    for (const step of fromOther) lines.push(`- ${step.text}`);
  }
  if (primary.lastVerified) {
    lines.push("");
    lines.push(`Last verified against the code on ${primary.lastVerified}.`);
  }

  return { prose: lines.join("\n"), actions: actionsFor(args.retrieved, args.surface) };
}

export function currentPageHint(chunk: AnyChunk | undefined): string | null {
  if (!chunk) return null;
  return `The person is currently on the ${chunk.docTitle} guide (${chunk.section}). Prefer this page's content unless the question is clearly about something else.`;
}
