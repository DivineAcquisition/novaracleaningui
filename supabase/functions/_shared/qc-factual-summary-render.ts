// Plain formal PDF for a factual summary. No brand colors, no marketing header.
// The standing disclaimer is drawn on every page from the constant, not from
// caller-supplied text.

import {
  FACTUAL_SUMMARY_DISCLAIMER,
  type FactualSummary,
} from "./qc-factual-summary.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 54;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM = 78;

const WIN_ANSI_SUBSTITUTIONS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014]/g, "-"],
  [/\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u00B7]/g, "-"],
  [/\u00A0/g, " "],
];

export function pdfSafe(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

interface PdfLibLike {
  PDFDocument: { create(): Promise<PdfDoc> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb: (r: number, g: number, b: number) => unknown;
}

interface PdfFont {
  widthOfTextAtSize(text: string, size: number): number;
}

interface PdfPage {
  drawText(text: string, opts: Record<string, unknown>): void;
  drawLine(opts: Record<string, unknown>): void;
  drawRectangle(opts: Record<string, unknown>): void;
}

interface PdfDoc {
  addPage(size: [number, number]): PdfPage;
  embedFont(font: string): Promise<PdfFont>;
  getPages(): PdfPage[];
  save(): Promise<Uint8Array>;
}

export async function renderFactualSummaryPdf(lib: PdfLibLike, summary: FactualSummary): Promise<Uint8Array> {
  const disclaimer = FACTUAL_SUMMARY_DISCLAIMER;
  if (!disclaimer.includes("not a legal filing") || !disclaimer.includes("does not constitute legal advice")) {
    throw new Error("Factual summary disclaimer is missing required language.");
  }

  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const black = lib.rgb(0.08, 0.08, 0.08);
  const gray = lib.rgb(0.35, 0.35, 0.35);
  const rule = lib.rgb(0.25, 0.25, 0.25);
  const paper = lib.rgb(0.96, 0.96, 0.96);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 48;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 48;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage();
  };
  const wrap = (text: string, size: number, width: number, face: PdfFont = font): string[] => {
    const out: string[] = [];
    for (const rawLine of pdfSafe(text || "").split("\n")) {
      const words = rawLine.split(/\s+/).filter((w) => w.length > 0);
      if (!words.length) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (face.widthOfTextAtSize(candidate, size) > width && line) {
          out.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [""];
  };
  const writeLines = (lines: string[], size: number, color: unknown, face: PdfFont = font, gap = 12) => {
    for (const line of lines) {
      ensure(gap + 2);
      page.drawText(line, { x: MARGIN_X, y, size, font: face, color });
      y -= gap;
    }
  };
  const heading = (title: string) => {
    ensure(28);
    y -= 8;
    page.drawText(pdfSafe(title).toUpperCase(), { x: MARGIN_X, y, size: 11, font: bold, color: black });
    y -= 6;
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.6, color: rule });
    y -= 14;
  };
  const paragraph = (text: string, size = 10) => {
    writeLines(wrap(text, size, CONTENT_W), size, black, font, size + 3);
    y -= 4;
  };

  page.drawText(pdfSafe(summary.title || "Factual Summary and Evidence Index"), {
    x: MARGIN_X, y, size: 14, font: bold, color: black,
  });
  y -= 16;
  page.drawText("Internal case record", { x: MARGIN_X, y, size: 9, font, color: gray });
  y -= 16;

  const disclaimerLines = wrap(disclaimer, 8, CONTENT_W - 16);
  const boxH = 12 + disclaimerLines.length * 11;
  ensure(boxH + 8);
  page.drawRectangle({ x: MARGIN_X, y: y - boxH + 10, width: CONTENT_W, height: boxH, color: paper, borderColor: rule, borderWidth: 0.6 });
  y -= 4;
  for (const line of disclaimerLines) {
    page.drawText(line, { x: MARGIN_X + 8, y, size: 8, font, color: black });
    y -= 11;
  }
  y -= 12;

  paragraph(summary.preamble);
  heading("Case identification");
  for (const line of summary.caseLines) paragraph(line, 10);

  heading("Timeline");
  paragraph(summary.timelineNote, 9);
  if (!summary.timelineDated.length && !summary.timelineUndated.length) {
    paragraph("No entries are logged on this case.");
  }
  for (const item of summary.timelineDated) {
    paragraph(`${item.at}  [${item.source}]  ${item.label}`, 9);
    if (item.text) paragraph(item.text, 9);
  }
  if (summary.timelineUndated.length) {
    paragraph("Entries with no stored timestamp", 10);
    for (const item of summary.timelineUndated) {
      paragraph(`${item.gapNote || "Timestamp not stored."}  [${item.source}]  ${item.label}`, 9);
      if (item.text) paragraph(item.text, 9);
    }
  }

  heading("Evidence index");
  if (!summary.evidence.length) paragraph("No documents are logged on this case.");
  summary.evidence.forEach((line, i) => paragraph(`${i + 1}. ${line}`, 9));

  heading("Correspondence");
  if (!summary.correspondence.length) paragraph("No correspondence is logged on this case.");
  for (const block of summary.correspondence) {
    for (const line of block.lines) paragraph(line, 9);
    paragraph(block.body || "Body not stored.", 9);
    y -= 4;
  }

  heading("Factual positions");
  if (!summary.positions.length) paragraph("No structured position fields are stored on this case.");
  for (const section of summary.positions) {
    paragraph(section.heading, 10);
    for (const line of section.lines) paragraph(line, 9);
  }

  const footerLines = wrap(disclaimer, 7, CONTENT_W);
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    let fy = 18 + (footerLines.length - 1) * 8;
    p.drawLine({
      start: { x: MARGIN_X, y: fy + 12 },
      end: { x: PAGE_W - MARGIN_X, y: fy + 12 },
      thickness: 0.4,
      color: rule,
    });
    for (const line of footerLines) {
      p.drawText(line, { x: MARGIN_X, y: fy, size: 7, font, color: gray });
      fy -= 8;
    }
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pageLabel, {
      x: PAGE_W - MARGIN_X - bold.widthOfTextAtSize(pageLabel, 7),
      y: fy,
      size: 7,
      font,
      color: gray,
    });
  });

  return pdf.save();
}
