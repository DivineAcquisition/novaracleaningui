import type { AnyChunk, Citation } from "./types";

export function citationFrom(chunk: AnyChunk): Citation {
  return {
    id: chunk.id,
    title: chunk.docTitle,
    section: chunk.section,
    docsPath: chunk.docsPath,
    lastVerified: chunk.lastVerified,
    hasScreenshot: (chunk.screenshotCaptions || []).length > 0,
    category: chunk.category,
  };
}

export function uniqueCitations(chunks: AnyChunk[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push(citationFrom(chunk));
  }
  return out;
}

/** The sentence the panel shows under an answer, e.g. "Per the Bookings guide…". */
export function perDocLine(citations: Citation[]): string {
  if (!citations.length) return "";
  const first = citations[0];
  const extra = citations.length > 1 ? ` (and ${citations.length - 1} more)` : "";
  const verified = first.lastVerified ? `, last verified ${first.lastVerified}` : "";
  return `Per the ${first.title} guide — ${first.section}${verified}${extra}.`;
}
