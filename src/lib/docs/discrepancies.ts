// ─── The drift punch list ──────────────────────────────────────────────────
//
// Every place a guide marks a disagreement between an existing document and
// the live code is written once, inside the guide it belongs to. This reads
// those callouts back out of the guides so they can also be shown as a single
// list.
//
// Doing it this way rather than maintaining a separate page means the punch
// list cannot itself go stale: fix the drift, delete the callout, and the
// entry disappears from here on the next request.

import "server-only";

import { marked } from "marked";

import { getAllDocs } from "./content";

export interface Discrepancy {
  kind: "drift" | "unverified";
  docSlug: string;
  docTitle: string;
  title: string;
  html: string;
}

const DEFAULT_TITLES: Record<Discrepancy["kind"], string> = {
  drift: "Docs and code disagree here",
  unverified: "Needs a human to confirm",
};

export function getDiscrepancies(): Discrepancy[] {
  const out: Discrepancy[] = [];

  for (const doc of getAllDocs()) {
    const lines = doc.body.split("\n");
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimStart().startsWith("```")) inFence = !inFence;
      if (inFence) continue;

      const open = /^:::(drift|unverified)(?:\s+(.*))?$/.exec(lines[i].trim());
      if (!open) continue;

      const kind = open[1] as Discrepancy["kind"];
      const title = open[2]?.trim() || DEFAULT_TITLES[kind];
      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") inner.push(lines[i++]);

      out.push({
        kind,
        docSlug: doc.slug,
        docTitle: doc.title,
        title,
        html: marked.parse(inner.join("\n"), { async: false }) as string,
      });
    }
  }

  // Drift first — those are actionable reconciliations. Unverified items are
  // questions for a human, which is a different kind of work.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "drift" ? -1 : 1));
}
