// ─── Ops Assistant knowledge export ────────────────────────────────────────
//
//   npm run docs:export
//
// The Ops Assistant answers VA questions. The workspace guides answer the
// same questions. If those were maintained as two separate bodies of text
// they would disagree within weeks, and the assistant — being confident and
// fast — would be the one people believed.
//
// So the assistant is fed from exactly these files. This produces the
// knowledge pack: one chunk per section of each guide, carrying the guide it
// came from, the section heading, who may see that part of the workspace, and
// the date it was last verified against the code.
//
// Two properties matter for how the assistant should use it:
//
//   • Every chunk is tagged category "How the Tool Works". The policy and
//     pricing knowledge base is a DIFFERENT category, and the assistant needs
//     to keep them apart: policy says what we promise, these say which
//     buttons produce it. When they conflict, the assistant should surface
//     both rather than choosing.
//   • Every chunk carries lastVerified. An assistant answering from a chunk
//     verified months ago should say so rather than assert it flatly.
//
// The output is committed alongside the guides so a change to a guide and the
// change to what the assistant knows are the same reviewable diff.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** README.md is the maintainer runbook, not a published guide. */
function isGuideFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith("_") && name !== "README.md";
}

const ROOT = resolve(__dirname, "../..");
const DOCS_DIR = join(ROOT, "docs/admin-workspace");
const SHOTS = join(DOCS_DIR, "screenshots/manifest.json");
const OUT = join(DOCS_DIR, "_data/ops-assistant-knowledge.generated.json");

interface Chunk {
  id: string;
  category: string;
  docSlug: string;
  docTitle: string;
  area: string;
  section: string;
  whoCanSee: string;
  where: string;
  lastVerified: string;
  /** Marked true for sections holding a hard stop or a known discrepancy —
   *  the assistant should quote these carefully rather than paraphrase. */
  containsGate: boolean;
  containsDiscrepancy: boolean;
  text: string;
}

function parseFrontMatter(raw: string) {
  if (!raw.startsWith("---")) return { data: {} as Record<string, string>, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {} as Record<string, string>, body: raw };
  const data: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: raw.slice(end + 4) };
}

/**
 * Flatten a guide's markdown into text an assistant can quote.
 *
 * Screenshot directives become a plain-language mention rather than being
 * dropped: an assistant that knows a screenshot exists can point someone at
 * the guide, which is more useful than silently losing the reference. The
 * images themselves stay behind the admin gate and are not exported.
 */
function toPlainText(md: string): string {
  return md
    .replace(/^@screenshot\s+([a-z0-9-]+)\s*$/gim, "(An annotated screenshot of this step is in the guide.)")
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

function main() {
  const files = readdirSync(DOCS_DIR).filter(isGuideFile);
  const chunks: Chunk[] = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = readFileSync(join(DOCS_DIR, file), "utf8");
    const { data, body } = parseFrontMatter(raw);

    // Split on level-2 headings: each is a self-contained topic, which is the
    // right granularity for retrieval. Anything before the first heading is
    // the guide's opening and is kept as its own chunk.
    const parts = body.split(/^##\s+(.+)$/gm);
    const sections: Array<{ heading: string; content: string }> = [];
    if (parts[0]?.trim()) sections.push({ heading: "Overview", content: parts[0] });
    for (let i = 1; i < parts.length; i += 2) {
      sections.push({ heading: parts[i].trim(), content: parts[i + 1] ?? "" });
    }

    for (const section of sections) {
      const text = toPlainText(section.content);
      if (text.length < 40) continue;
      chunks.push({
        id: `${slug}#${section.heading.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}`,
        category: data.category || "How the Tool Works",
        docSlug: slug,
        docTitle: data.title || slug,
        area: data.area || "",
        section: section.heading,
        whoCanSee: data.whoCanSee || "",
        where: data.where || "",
        lastVerified: data.lastVerified || "",
        containsGate: /^:::gate/m.test(section.content),
        containsDiscrepancy: /^:::(drift|unverified)/m.test(section.content),
        text: `${data.title} — ${section.heading}\n\n${text}`,
      });
    }
  }

  const shotCount = existsSync(SHOTS)
    ? (JSON.parse(readFileSync(SHOTS, "utf8")).shots as unknown[]).length
    : 0;

  const pack = {
    _readme:
      "GENERATED by npm run docs:export from docs/admin-workspace/*.md. This is what the Ops Assistant is fed, so the assistant and docs.novaracleaning.com stay one body of text rather than two. Do not edit by hand — change the guide and re-run.",
    generatedAt: new Date().toISOString(),
    category: "How the Tool Works",
    categoryNote:
      "Software how-to guides for the admin workspace. Complementary to, and separate from, the Policy & Pricing knowledge base. Policy documents are authoritative on what we promise a customer; these are authoritative on what the software currently does. Where they conflict, present both rather than choosing.",
    usageNotes: [
      "Every chunk carries lastVerified. If it is old, say so rather than asserting the answer flatly.",
      "Chunks with containsGate describe a condition that blocks an action. Quote the condition precisely — paraphrasing a hard stop is how people end up hunting for an override that does not exist.",
      "Chunks with containsDiscrepancy record a known disagreement between sources. Never resolve one silently; surface it.",
      "whoCanSee tells you whether the asker can even open that screen. A VA asking about Payroll needs to be told it is admin-only, not walked through it.",
      "Screenshots are not exported. They sit behind the admin sign-in on docs.novaracleaning.com; point people at the guide instead.",
    ],
    sourceOfTruth: "docs/admin-workspace/*.md in the application repository",
    publishedAt: "https://docs.novaracleaning.com",
    guides: files.length,
    screenshots: shotCount,
    chunks,
  };

  writeFileSync(OUT, `${JSON.stringify(pack, null, 2)}\n`);

  const gates = chunks.filter((c) => c.containsGate).length;
  const discrepancies = chunks.filter((c) => c.containsDiscrepancy).length;
  console.log(`${chunks.length} chunks from ${files.length} guides`);
  console.log(`  ${gates} contain a hard stop`);
  console.log(`  ${discrepancies} contain a known discrepancy`);
  console.log(`\nWrote ${OUT}`);
}

main();
