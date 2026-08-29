// ─── Markdown → HTML for the admin workspace guides ────────────────────────
//
// Two custom pieces sit on top of plain markdown:
//
//   @screenshot <shot-id>
//     Expands to the annotated screenshot with its caption and a legend
//     listing what each numbered badge points at. The legend comes from the
//     capture manifest, so the numbers in the image and the numbers in the
//     text cannot disagree — if a callout could not be located during
//     capture, it simply isn't in the legend.
//
//   :::note / :::warning / :::drift  … :::
//     Callout blocks. `drift` is the one that matters most: it marks a place
//     where a document in Drive and the live code disagree, so the reader
//     knows not to trust either without checking, and so the set of them can
//     be read as a punch list.
//
// The markdown is repo-authored and reviewed, so rendering it to HTML and
// injecting it is safe; nothing here renders user input.

import "server-only";

import { marked } from "marked";

import { getScreenshot, slugify } from "./content";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function screenshotBlock(id: string): string {
  const shot = getScreenshot(id);
  if (!shot || !shot.file) {
    // Never silently drop an image: a guide that promised a screenshot and
    // has none should say so, loudly, rather than look complete.
    return `<div class="doc-missing-shot">Screenshot <code>${escapeHtml(
      id,
    )}</code> has not been captured yet. Run <code>npm run docs:capture ${escapeHtml(
      id,
    )}</code>.</div>`;
  }

  const legend = shot.callouts.length
    ? `<ol class="doc-legend">${shot.callouts
        .map((c) => `<li><span class="doc-legend-n">${c.n}</span>${escapeHtml(c.label)}</li>`)
        .join("")}</ol>`
    : "";

  const captured = shot.capturedAt ? shot.capturedAt.slice(0, 10) : "";

  return `<figure class="doc-figure">
  <img src="/docs/asset/${escapeHtml(shot.file)}" alt="${escapeHtml(shot.caption)}" loading="lazy" />
  <figcaption>
    <span class="doc-figure-caption">${escapeHtml(shot.caption)}</span>
    ${legend}
    <span class="doc-figure-meta">Screen: <code>${escapeHtml(
      shot.url,
    )}</code> · captured ${escapeHtml(captured)}</span>
  </figcaption>
</figure>`;
}

const CALLOUT_TITLES: Record<string, string> = {
  note: "Worth knowing",
  warning: "Careful",
  gate: "This is a hard stop",
  drift: "Docs and code disagree here",
  unverified: "Needs a human to confirm",
};

/** Expand the custom blocks before markdown runs over the rest. */
function preprocess(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) inFence = !inFence;

    if (!inFence) {
      const shot = /^@screenshot\s+([a-z0-9-]+)\s*$/i.exec(line.trim());
      if (shot) {
        out.push(screenshotBlock(shot[1]));
        continue;
      }

      const open = /^:::(note|warning|gate|drift|unverified)(?:\s+(.*))?$/.exec(line.trim());
      if (open) {
        const kind = open[1];
        const title = open[2]?.trim() || CALLOUT_TITLES[kind];
        const inner: string[] = [];
        i++;
        while (i < lines.length && lines[i].trim() !== ":::") {
          inner.push(lines[i]);
          i++;
        }
        const html = marked.parse(inner.join("\n"), { async: false }) as string;
        out.push(
          `<aside class="doc-callout doc-callout-${kind}"><p class="doc-callout-title">${escapeHtml(
            title,
          )}</p>${html}</aside>`,
        );
        continue;
      }
    }

    out.push(line);
  }
  return out.join("\n");
}

export function renderDoc(markdown: string): string {
  const renderer = new marked.Renderer();

  // Stable heading anchors so the in-page contents and deep links work.
  renderer.heading = ({ text, depth }) => {
    const plain = text.replace(/<[^>]+>/g, "");
    const id = slugify(plain);
    return `<h${depth} id="${id}"><a class="doc-anchor" href="#${id}">${text}</a></h${depth}>`;
  };

  marked.setOptions({ gfm: true, breaks: false });
  return marked.parse(preprocess(markdown), { async: false, renderer }) as string;
}
