// ─── Retrieval over the guide chunks ──────────────────────────────────────
//
// Deliberately lexical. These guides are short, named after the screens they
// describe, and the person is usually already on the relevant page. A vector
// index would be a second copy of the same text and would go stale the moment
// a guide was regenerated. Scoring here is cheap enough to run on every
// question against the live files.

import { chunkVisibleTo, type GuideChunk } from "./guide-chunks";
import type { AnyChunk, AssistantRole, PageContext, Retrieved } from "./types";

const STOP = new Set(
  "a an the to of for in on at and or is it this that what how do i if we you they with from as by not be can".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function termScore(haystack: string, terms: string[]): number {
  if (!terms.length) return 0;
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (!h.includes(t)) continue;
    // Count occurrences, but don't let a single repeated word dominate.
    const hits = h.split(t).length - 1;
    score += Math.min(hits, 4);
    if (hits > 0 && t.length >= 6) score += 1;
  }
  return score;
}

export function screenSlugFromPath(path: string): string | null {
  const p = (path || "").split("?")[0];
  const docs = /^\/docs\/([a-z0-9-]+)\/?$/.exec(p);
  if (docs) return docs[1];
  const admin = /^\/admin\/([a-z0-9-]+)\/?$/.exec(p);
  if (!admin) return null;
  const map: Record<string, string> = {
    dashboard: "dashboard",
    bookings: "bookings",
    operations: "operations",
    dispatch: "operations",
    attention: "operations",
    map: "operations",
    sync: "operations",
    cleaners: "cleaners",
    crews: "cleaners",
    csr: "internal-booking",
    quotes: "quotes",
    pricing: "pricing",
    commercial: "commercial",
    partner: "commercial",
    customers: "customers",
    recurring: "recurring",
    payroll: "payroll",
    pnl: "pnl",
    qc: "quality-control",
    proposals: "proposals",
    "va-performance": "va-performance",
    "weekly-report": "weekly-report",
    team: "team",
  };
  return map[admin[1]] || null;
}

export function retrieveChunks(args: {
  query: string;
  chunks: AnyChunk[];
  role: AssistantRole;
  page?: PageContext | null;
  limit?: number;
}): Retrieved[] {
  const terms = tokenize(args.query);
  const pageSlug =
    args.page?.docSlug || (args.page?.path ? screenSlugFromPath(args.page.path) : null) || null;
  const onDocs = args.page?.surface === "docs";

  const scored: Retrieved[] = [];
  for (const chunk of args.chunks) {
    if (!chunkVisibleTo(chunk, args.role)) continue;

    const hay = `${chunk.docTitle} ${chunk.section} ${chunk.area} ${chunk.text}`;
    let score = termScore(hay, terms);

    // Title / section hits matter more than body hits.
    score += termScore(`${chunk.docTitle} ${chunk.section} ${chunk.area}`, terms) * 2;

    const onCurrentPage = Boolean(pageSlug && chunk.docSlug === pageSlug);
    if (onCurrentPage) {
      // On a docs page, the person is already reading this guide — boost it
      // so "what if the client wants two sites" on Commercial doesn't wander
      // off into Bookings.
      score += onDocs ? 8 : 4;
    }

    if (chunk.containsGate && terms.some((t) => /block|stop|can't|cannot|override|assign|deposit/.test(t))) {
      score += 2;
    }

    if (score <= 0 && !onCurrentPage) continue;
    // Even a zero-term query on a docs page should still surface that page.
    if (score <= 0 && onCurrentPage) score = 1;

    scored.push({ chunk, score, onCurrentPage });
  }

  scored.sort((a, b) => b.score - a.score || (b.onCurrentPage === a.onCurrentPage ? 0 : b.onCurrentPage ? 1 : -1));
  const limit = args.limit ?? 6;
  return scored.slice(0, limit);
}

export function asGuideChunk(chunk: AnyChunk): GuideChunk {
  return chunk as GuideChunk;
}
