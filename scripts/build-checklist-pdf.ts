// Build the printable Standard Cleaning Checklists PDF from the catalog.
//
// Generated, never hand-maintained: the PDF a crew or a client is handed comes
// from the same items the feedback loop counts against, so the paper copy
// cannot quietly drift from the live standard. Re-run after a checklist edit.
//
// Run: npm run checklists:pdf

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  COMMERCIAL_SECTIONS,
  OFFICE_SECTIONS,
  STR_SECTIONS,
  type CatalogSection,
} from "../src/lib/checklist-catalog";

const PAGE = { w: 612, h: 792 };
const MARGIN = 54;
const BODY = 9.5;
const LINE = 13;

const PURPLE = rgb(0.36, 0.06, 1);
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.45, 0.48, 0.55);
const HAIRLINE = rgb(0.87, 0.89, 0.92);

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  pageNo: number;
};

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function footer(ctx: Ctx) {
  ctx.page.drawLine({
    start: { x: MARGIN, y: 52 },
    end: { x: PAGE.w - MARGIN, y: 52 },
    thickness: 0.5,
    color: HAIRLINE,
  });
  ctx.page.drawText("NovaraCleaning, LLC · Standard Cleaning Checklists · Internal use", {
    x: MARGIN,
    y: 40,
    size: 7.5,
    font: ctx.regular,
    color: MUTED,
  });
  const label = String(ctx.pageNo);
  ctx.page.drawText(label, {
    x: PAGE.w - MARGIN - ctx.regular.widthOfTextAtSize(label, 7.5),
    y: 40,
    size: 7.5,
    font: ctx.regular,
    color: MUTED,
  });
}

function newPage(ctx: Ctx) {
  footer(ctx);
  ctx.page = ctx.doc.addPage([PAGE.w, PAGE.h]);
  ctx.pageNo += 1;
  ctx.y = PAGE.h - MARGIN;
}

function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < 70) newPage(ctx);
}

function partHeading(ctx: Ctx, title: string, blurb: string) {
  ensure(ctx, 90);
  ctx.page.drawText(title, { x: MARGIN, y: ctx.y, size: 16, font: ctx.bold, color: PURPLE });
  ctx.y -= 20;
  for (const line of wrap(blurb, ctx.regular, BODY, PAGE.w - MARGIN * 2)) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: BODY, font: ctx.regular, color: MUTED });
    ctx.y -= LINE;
  }
  ctx.y -= 8;
}

function section(ctx: Ctx, sec: CatalogSection) {
  ensure(ctx, 48);
  ctx.page.drawText(sec.title.toUpperCase(), {
    x: MARGIN,
    y: ctx.y,
    size: 8.5,
    font: ctx.bold,
    color: INK,
  });
  ctx.y -= 6;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE.w - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: HAIRLINE,
  });
  ctx.y -= 14;

  for (const item of sec.items) {
    const textWidth = PAGE.w - MARGIN * 2 - 22;
    const lines = wrap(item.text, ctx.regular, BODY, textWidth);
    ensure(ctx, lines.length * LINE + 10);

    // Tick box — this is a working document, not a reference sheet.
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - 1.5,
      width: 8,
      height: 8,
      borderWidth: 0.8,
      borderColor: MUTED,
    });

    lines.forEach((line, i) => {
      ctx.page.drawText(line, {
        x: MARGIN + 16,
        y: ctx.y - i * LINE,
        size: BODY,
        font: ctx.regular,
        color: INK,
      });
    });
    ctx.y -= lines.length * LINE;

    ctx.page.drawText(item.id, {
      x: MARGIN + 16,
      y: ctx.y,
      size: 6,
      font: ctx.regular,
      color: HAIRLINE,
    });
    ctx.y -= 11;
  }
  ctx.y -= 8;
}

function notes(ctx: Ctx, title: string, lines: string[]) {
  ensure(ctx, 40 + lines.length * LINE);
  ctx.page.drawText(title, { x: MARGIN, y: ctx.y, size: 9.5, font: ctx.bold, color: INK });
  ctx.y -= 15;
  for (const raw of lines) {
    for (const line of wrap(raw, ctx.regular, BODY, PAGE.w - MARGIN * 2 - 12)) {
      ensure(ctx, LINE);
      ctx.page.drawText(line, { x: MARGIN + 10, y: ctx.y, size: BODY, font: ctx.regular, color: MUTED });
      ctx.y -= LINE;
    }
    ctx.y -= 3;
  }
  ctx.y -= 6;
}

async function build() {
  const doc = await PDFDocument.create();
  doc.setTitle("Novara Cleaning — Standard Cleaning Checklists (STR · Office · Commercial)");
  doc.setSubject("Task-level checklists for every visit. Edition 1.0 · 2026. Internal use only.");
  doc.setProducer("NovaraCleaning");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const first = doc.addPage([PAGE.w, PAGE.h]);
  const ctx: Ctx = { doc, page: first, y: PAGE.h - MARGIN, regular, bold, pageNo: 1 };

  // ── Cover ──────────────────────────────────────────────────────────────
  ctx.page.drawText("NovaraCleaning", { x: MARGIN, y: ctx.y, size: 11, font: ctx.bold, color: PURPLE });
  ctx.y -= 46;
  ctx.page.drawText("Standard Cleaning", { x: MARGIN, y: ctx.y, size: 30, font: ctx.bold, color: INK });
  ctx.y -= 34;
  ctx.page.drawText("Checklists", { x: MARGIN, y: ctx.y, size: 30, font: ctx.bold, color: INK });
  ctx.y -= 26;
  ctx.page.drawText("STR / Airbnb Turnover · Office · Commercial", {
    x: MARGIN, y: ctx.y, size: 12, font: ctx.regular, color: PURPLE,
  });
  ctx.y -= 34;

  for (const line of wrap(
    "Task-level checklists for every visit, built on current industry standards and Novara's own scope levels — distinct from the walkthrough/assessment checklists used for pricing.",
    regular, 10.5, PAGE.w - MARGIN * 2,
  )) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 10.5, font: regular, color: INK });
    ctx.y -= 15;
  }
  ctx.y -= 10;
  for (const line of wrap(
    "This is a living baseline. Real job outcomes — QC cases, re-cleans, reviews, and duration variance — feed back into these checklists through the checklist feedback loop. Every change is a human decision and is versioned, so a job always reflects the checklist that was current when it was performed.",
    regular, 9.5, PAGE.w - MARGIN * 2,
  )) {
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y, size: 9.5, font: regular, color: MUTED });
    ctx.y -= 13;
  }
  ctx.y -= 14;
  ctx.page.drawText("The small grey code under each task is its stable item ID — what a QC case or", {
    x: MARGIN, y: ctx.y, size: 8.5, font: regular, color: MUTED,
  });
  ctx.y -= 12;
  ctx.page.drawText("re-clean references, so signal survives a rewording.", {
    x: MARGIN, y: ctx.y, size: 8.5, font: regular, color: MUTED,
  });
  ctx.y -= 30;
  ctx.page.drawText("INTERNAL USE ONLY · EDITION 1.0 · 2026", {
    x: MARGIN, y: ctx.y, size: 8.5, font: bold, color: MUTED,
  });

  // ── Part A · STR ───────────────────────────────────────────────────────
  newPage(ctx);
  partHeading(
    ctx,
    "Part A — STR / Airbnb Turnover",
    "Cleanliness is the #1 driver of negative reviews on STR platforms. A missed detail here is discovered by the next guest, not a supervisor.",
  );
  for (const sec of STR_SECTIONS) section(ctx, sec);
  notes(ctx, "Timing reference — solo cleaner, standard turnover", [
    "Studio / 1BR — 1.5 to 2.5 hrs · 2BR — 2 to 3 hrs · 3BR — 3 to 4 hrs · 4BR+ — 4+ hrs, consider a 2-person crew",
    "Same-day turnovers are high-risk — confirm the cleaner the night before and have a backup plan per the standing coverage system. A delayed check-in from a late turnover is one of the most commonly cited STR complaints.",
  ]);

  // ── Part B · Office ────────────────────────────────────────────────────
  newPage(ctx);
  partHeading(
    ctx,
    "Part B — Office",
    "Organized by frequency, matching how commercial cleaning contracts are structured and priced.",
  );
  for (const sec of OFFICE_SECTIONS) section(ctx, sec);

  // ── Part C · Commercial ────────────────────────────────────────────────
  newPage(ctx);
  partHeading(
    ctx,
    "Part C — Commercial (by scope level)",
    "Baseline tasks by scope level — Light / Standard / Detailed — applied across facility types, adjusted by walkthrough-specific notes. Each level is the one before it plus more.",
  );
  for (const sec of COMMERCIAL_SECTIONS) section(ctx, sec);
  notes(ctx, "Zone documentation — large sites", [
    "For any site large enough to use zone-based proof-of-completion, each zone identified at the walkthrough gets its own checklist pass and its own before/after photos — never one generic photo pair representing the whole facility. Follow the zone list established for that site's Firm Price record.",
  ]);
  notes(ctx, "Notes for all three checklists", [
    "Property-specific notes always override the generic checklist. Intake or walkthrough notes (\"don't touch papers on desks,\" \"host prefers towels rolled not folded,\" \"no chemical cleaners near turf\") take precedence for that property, every time.",
    "Photo documentation is not optional on any of the three checklists — it's the evidence that protects both the cleaner and the company in any dispute.",
    "When in doubt, stop and ask. A five-minute pause costs nothing; guessing wrong on scope, access, or an excluded condition costs much more.",
  ]);
  footer(ctx);

  const bytes = await doc.save();
  const out = resolve(
    process.cwd(),
    "public/NovaraCleaning_Standard_Cleaning_Checklists_v1.pdf",
  );
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${doc.getPageCount()} pages, ${(bytes.length / 1024).toFixed(0)} KB)`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
