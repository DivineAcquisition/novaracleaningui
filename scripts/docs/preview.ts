// ─── Offline preview of a guide ────────────────────────────────────────────
//
//   npx tsx scripts/docs/preview.ts pricing
//
// Renders one guide to /tmp/docs-preview/<slug>.html using the same markdown
// pipeline the site uses, so authoring and styling can be checked without
// signing in. Screenshots are inlined as file:// paths.
//
// This is an authoring aid only. It is NOT a way to read the guides without
// the admin gate — it reads the markdown straight off the local disk, which
// anyone running it already has.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { marked } from "marked";

const ROOT = resolve(__dirname, "../..");
const DOCS_DIR = join(ROOT, "docs/admin-workspace");
const SHOTS = join(DOCS_DIR, "screenshots");
const OUT_DIR = "/tmp/docs-preview";

interface Shot {
  id: string;
  caption: string;
  url: string;
  file: string | null;
  callouts: Array<{ n: number; label: string }>;
  capturedAt: string;
}

const manifest: { shots: Shot[] } = existsSync(join(SHOTS, "manifest.json"))
  ? JSON.parse(readFileSync(join(SHOTS, "manifest.json"), "utf8"))
  : { shots: [] };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TITLES: Record<string, string> = {
  note: "Worth knowing",
  warning: "Careful",
  gate: "This is a hard stop",
  drift: "Docs and code disagree here",
  unverified: "Needs a human to confirm",
};

function preprocess(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence) {
      const s = /^@screenshot\s+([a-z0-9-]+)\s*$/i.exec(line.trim());
      if (s) {
        const shot = manifest.shots.find((x) => x.id === s[1]);
        if (!shot?.file) {
          out.push(`<div class="doc-missing-shot">Screenshot <code>${esc(s[1])}</code> missing.</div>`);
        } else {
          const legend = shot.callouts
            .map((c) => `<li><span class="doc-legend-n">${c.n}</span>${esc(c.label)}</li>`)
            .join("");
          out.push(
            `<figure class="doc-figure"><img src="file://${join(SHOTS, shot.file)}" alt="${esc(
              shot.caption,
            )}"/><figcaption><span class="doc-figure-caption">${esc(
              shot.caption,
            )}</span><ol class="doc-legend">${legend}</ol><span class="doc-figure-meta">Screen: <code>${esc(
              shot.url,
            )}</code> · captured ${esc(shot.capturedAt.slice(0, 10))}</span></figcaption></figure>`,
          );
        }
        continue;
      }
      const open = /^:::(note|warning|gate|drift|unverified)(?:\s+(.*))?$/.exec(line.trim());
      if (open) {
        const kind = open[1];
        const title = open[2]?.trim() || TITLES[kind];
        const inner: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ":::") inner.push(lines[i++]);
        out.push(
          `<aside class="doc-callout doc-callout-${kind}"><p class="doc-callout-title">${esc(
            title,
          )}</p>${marked.parse(inner.join("\n"), { async: false })}</aside>`,
        );
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/docs/preview.ts <slug>");
    process.exit(1);
  }
  const path = join(DOCS_DIR, `${slug}.md`);
  if (!existsSync(path)) {
    console.error(`No such guide: ${path}`);
    process.exit(1);
  }
  const raw = readFileSync(path, "utf8");
  const body = raw.startsWith("---") ? raw.slice(raw.indexOf("\n---", 3) + 4) : raw;

  const css = readFileSync(join(ROOT, "src/styles/docs.css"), "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--hairline:#e5e7eb;--foreground:222 47% 11%;--muted-foreground:215 16% 47%;
          --muted:210 40% 96%;--primary:262 99% 53%;--card:0 0% 100%;--background:0 0% 100%}
    body{margin:0;background:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .wrap{max-width:780px;margin:0 auto;padding:48px 24px}
    ${css}
  </style></head><body><div class="wrap"><article class="doc-body">${marked.parse(
    preprocess(body),
    { async: false },
  )}</article></div></body></html>`;

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${slug}.html`);
  writeFileSync(out, html);
  console.log(out);
}

main();
