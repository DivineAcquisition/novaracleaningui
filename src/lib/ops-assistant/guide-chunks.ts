// ─── Chunk the workspace guides the assistant is fed from ─────────────────
//
// The published guides (docs.novaracleaning.com) and the Ops Assistant must
// be the same body of text. This is the one place a guide is split into
// retrieval chunks, so `docs:export` and the live assistant cannot drift.
//
// No `server-only` — the export script and the verify script import this too.

export interface GuideInput {
  slug: string;
  raw: string;
}

export interface ShotInput {
  id: string;
  doc: string;
  caption: string;
  callouts: Array<{ n: number; label: string }>;
}

export interface GuideChunk {
  id: string;
  category: string;
  docSlug: string;
  docTitle: string;
  area: string;
  section: string;
  headingId: string;
  whoCanSee: string;
  where: string;
  lastVerified: string;
  containsGate: boolean;
  containsDiscrepancy: boolean;
  docsPath: string;
  screenshotCaptions: string[];
  text: string;
}

export interface KnowledgePack {
  generatedAt: string;
  category: string;
  categoryNote: string;
  usageNotes: string[];
  sourceOfTruth: string;
  publishedAt: string;
  guides: number;
  screenshots: number;
  chunks: GuideChunk[];
}

export const HOW_THE_TOOL_WORKS = "How the Tool Works";
export const DOCS_ORIGIN = "https://docs.novaracleaning.com";

export function isGuideFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith("_") && name !== "README.md";
}

export function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    let value = line.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[line.slice(0, i).trim()] = value;
  }
  return { data, body: raw.slice(end + 4).replace(/^\r?\n/, "") };
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Flatten a guide's markdown into text an assistant can quote.
 *
 * Screenshot directives become a caption plus a pointer at the guide rather
 * than being dropped: the images stay behind the admin gate; the assistant
 * tells people to open the page.
 */
export function toPlainText(md: string, shotsForDoc: ShotInput[]): string {
  return md
    .replace(/^@screenshot\s+([a-z0-9-]+)\s*$/gim, (_m, id: string) => {
      const shot = shotsForDoc.find((s) => s.id === id);
      if (!shot) return "(An annotated screenshot of this step is in the guide.)";
      const callouts = shot.callouts.length
        ? ` Callouts: ${shot.callouts.map((c) => `${c.n}. ${c.label}`).join("; ")}.`
        : "";
      return `(Screenshot in the guide: "${shot.caption}".${callouts} Open the full page to see it.)`;
    })
    .replace(/^:::(note|warning|gate|drift|unverified)(?:\s+(.*))?$/gim, (_m, kind, title) => {
      const label =
        kind === "gate"
          ? "HARD STOP"
          : kind === "drift"
            ? "KNOWN DISCREPANCY"
            : kind === "unverified"
              ? "UNCONFIRMED"
              : kind === "warning"
                ? "CAREFUL"
                : "NOTE";
      return `[${label}${title ? `: ${title}` : ""}]`;
    })
    .replace(/^:::$/gm, "")
    .replace(/\[([^\]]+)\]\(\/docs\/([a-z0-9-]+)\)/g, "$1 (see the $2 guide)")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function screenshotIdsIn(md: string): string[] {
  return [...md.matchAll(/^@screenshot\s+([a-z0-9-]+)\s*$/gim)].map((m) => m[1]);
}

export function chunkGuides(files: GuideInput[], shots: ShotInput[] = []): GuideChunk[] {
  const chunks: GuideChunk[] = [];

  for (const file of files) {
    const { data, body } = parseFrontMatter(file.raw);
    const shotsForDoc = shots.filter((s) => s.doc === file.slug);
    const parts = body.split(/^##\s+(.+)$/gm);
    const sections: Array<{ heading: string; content: string }> = [];
    if (parts[0]?.trim()) sections.push({ heading: "Overview", content: parts[0] });
    for (let i = 1; i < parts.length; i += 2) {
      sections.push({ heading: parts[i].trim(), content: parts[i + 1] ?? "" });
    }

    for (const section of sections) {
      const text = toPlainText(section.content, shotsForDoc);
      if (text.length < 40) continue;
      const hid = headingId(section.heading);
      const ids = screenshotIdsIn(section.content);
      const captions = ids
        .map((id) => shotsForDoc.find((s) => s.id === id)?.caption)
        .filter((c): c is string => Boolean(c));
      const title = data.title || file.slug;
      chunks.push({
        id: `${file.slug}#${hid}`,
        category: data.category || HOW_THE_TOOL_WORKS,
        docSlug: file.slug,
        docTitle: title,
        area: data.area || "",
        section: section.heading,
        headingId: hid,
        whoCanSee: data.whoCanSee || "",
        where: data.where || "",
        lastVerified: data.lastVerified || "",
        containsGate: /^:::gate/m.test(section.content),
        containsDiscrepancy: /^:::(drift|unverified)/m.test(section.content),
        docsPath: `/docs/${file.slug}${hid === "overview" ? "" : `#${hid}`}`,
        screenshotCaptions: captions,
        text: `${title} — ${section.heading}\n\n${text}`,
      });
    }
  }

  return chunks;
}

export function buildKnowledgePack(
  files: GuideInput[],
  shots: ShotInput[] = [],
  generatedAt = new Date().toISOString(),
): KnowledgePack {
  const chunks = chunkGuides(files, shots);
  return {
    generatedAt,
    category: HOW_THE_TOOL_WORKS,
    categoryNote:
      "Software how-to guides for the admin workspace. Complementary to, and separate from, the Policy & Pricing knowledge base. Policy documents are authoritative on what we promise a customer; these are authoritative on what the software currently does. Where they conflict, present both rather than choosing.",
    usageNotes: [
      "Every chunk carries lastVerified. If it is old, say so rather than asserting the answer flatly.",
      "Chunks with containsGate describe a condition that blocks an action. Quote the condition precisely — paraphrasing a hard stop is how people end up hunting for an override that does not exist.",
      "Chunks with containsDiscrepancy record a known disagreement between sources. Never resolve one silently; surface it.",
      "whoCanSee tells you whether the asker can even open that screen. A VA asking about Payroll needs to be told it is admin-only, not walked through it.",
      "Screenshot captions travel with the chunk. The images themselves sit behind the admin sign-in on docs.novaracleaning.com; point people at the guide to see them.",
    ],
    sourceOfTruth: "docs/admin-workspace/*.md in the application repository",
    publishedAt: DOCS_ORIGIN,
    guides: files.length,
    screenshots: shots.length,
    chunks,
  };
}

/** VA-facing screens. A "Full admins only" guide is hidden from VA retrieval. */
export function chunkVisibleTo(chunk: { whoCanSee: string }, role: "admin" | "va"): boolean {
  if (role === "admin") return true;
  return !/full admins only/i.test(chunk.whoCanSee || "");
}
