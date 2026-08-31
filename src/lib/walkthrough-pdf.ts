// Branded walkthrough findings PDF — attached on contractor submit and
// mirrored to the per-site dated Drive folder. Same Novara document
// standard as the EOD / screening records (violet header, Helvetica, US Letter).

import {
  formatAnswer,
  type ChecklistItem,
  type PropertyTypeDef,
} from "@/lib/proposal-request";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM = 64;

const WIN_ANSI_SUBSTITUTIONS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013]/g, "-"],
  [/\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u00B7]/g, "-"],
  [/\u00A0/g, " "],
  [/\u20AC/g, "EUR"],
];

function pdfSafe(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

export interface WalkthroughPdfInput {
  type: PropertyTypeDef;
  siteLabel: string;
  address: string;
  requesterName: string;
  company: string;
  conductorName: string;
  conductedOn: string;
  excluded: boolean;
  exclusionNote?: string;
  universal: ChecklistItem[];
  typeSpecific: ChecklistItem[];
  answers: Record<string, unknown>;
  photoCount: number;
}

export async function buildWalkthroughPdf(input: WalkthroughPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(0.361, 0.063, 0.996);
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.42, 0.45, 0.5);
  const rose = rgb(0.75, 0.15, 0.22);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 56;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 56;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage();
  };
  const wrap = (text: string, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const rawLine of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of rawLine.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > width && line) {
          out.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      out.push(line);
    }
    return out;
  };
  const sectionHeader = (title: string) => {
    ensure(40);
    y -= 8;
    page.drawRectangle({ x: MARGIN_X, y: y - 4, width: CONTENT_W, height: 20, color: rgb(0.955, 0.94, 1) });
    page.drawText(title.toUpperCase(), { x: MARGIN_X + 8, y: y + 1, size: 10, font: bold, color: purple });
    y -= 24;
  };
  const qa = (label: string, value: string) => {
    const lines = wrap(value || "—", 10, CONTENT_W);
    ensure(28 + lines.length * 13);
    page.drawText(pdfSafe(label.toUpperCase()), { x: MARGIN_X, y, size: 8, font: bold, color: gray });
    y -= 12;
    for (const line of lines) {
      ensure(14);
      page.drawText(line, { x: MARGIN_X, y, size: 10, font, color: dark });
      y -= 13;
    }
    y -= 4;
  };

  page.drawText("NOVARA CLEANING", { x: MARGIN_X, y, size: 20, font: bold, color: purple });
  y -= 22;
  page.drawText("Walkthrough findings", { x: MARGIN_X, y, size: 13, font: bold, color: dark });
  y -= 16;
  page.drawText(`${input.type.label} · ${input.siteLabel}`, { x: MARGIN_X, y, size: 9, font, color: gray });
  y -= 20;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.5, color: purple });
  y -= 20;

  sectionHeader("Site");
  qa("Property", input.address || input.siteLabel);
  qa("Requester", [input.requesterName, input.company].filter(Boolean).join(" · "));
  qa("Conducted by", `${input.conductorName || "—"} · ${input.conductedOn || "—"}`);
  qa("Photos / video", String(input.photoCount));

  if (input.excluded) {
    sectionHeader("Exclusion — pricing stopped");
    qa("Finding", input.exclusionNote || "Excluded condition found on site.");
  }

  sectionHeader("Site findings");
  for (const item of input.universal) {
    if (item.kind === "media") continue;
    qa(item.label, formatAnswer(item, input.answers[item.key]));
  }

  if (input.typeSpecific.length > 0) {
    sectionHeader(`${input.type.shortLabel} findings`);
    for (const item of input.typeSpecific) {
      if (item.kind === "media") continue;
      qa(item.label, formatAnswer(item, input.answers[item.key]));
    }
  }

  const pages = pdf.getPages();
  const generated = `Generated ${new Date().toUTCString()} — Novara Cleaning · ${input.type.label} walkthrough`;
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN_X, y: 44 },
      end: { x: PAGE_W - MARGIN_X, y: 44 },
      thickness: 0.5,
      color: purple,
    });
    p.drawText(pdfSafe(generated), { x: MARGIN_X, y: 30, size: 7, font, color: gray });
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: PAGE_W - MARGIN_X - 40,
      y: 30,
      size: 7,
      font,
      color: gray,
    });
  });

  if (input.excluded) {
    pages[0].drawText("PRICING STOPPED", { x: PAGE_W - MARGIN_X - 110, y: PAGE_H - 56, size: 9, font: bold, color: rose });
  }

  return pdf.save();
}
