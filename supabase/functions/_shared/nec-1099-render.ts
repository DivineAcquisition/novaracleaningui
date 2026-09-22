// Plain Form 1099-NEC (Rev. December 2026), Copy B and Copy C only.
// Black type on white. No brand mark and no brand colors. Copy A is not a PDF.

import {
  NEC_FORM_REVISION,
  formatNecMoney,
  printableCopy,
  type Nec1099Form,
  type NecCopy,
  type StateTaxLine,
} from "./nec-1099.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 36;
const RIGHT = 576;
const WIDTH = RIGHT - LEFT;

const WIN_ANSI: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014]/g, "-"],
  [/\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/\u00A0/g, " "],
];

export function pdfSafe(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI) out = out.replace(pattern, replacement);
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
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
  drawRectangle(opts: Record<string, unknown>): void;
  drawLine(opts: Record<string, unknown>): void;
}

interface PdfDoc {
  addPage(size: [number, number]): PdfPage;
  embedFont(font: string): Promise<PdfFont>;
  save(): Promise<Uint8Array>;
}

function money(cents: number | null): string {
  if (cents == null) return "";
  return formatNecMoney(cents);
}

function codes(value: string[] | null): string {
  if (!value || !value.length) return "";
  return value.join(", ");
}

function stateRow(line: StateTaxLine | undefined): string {
  if (!line) return "";
  const withheld = money(line.withheldCents);
  const stateNo = [line.state, line.payerStateId].filter(Boolean).join(" ");
  const income = money(line.incomeCents);
  return [withheld, stateNo, income].filter(Boolean).join("   ");
}

function copyTitle(copy: NecCopy): { copy: string; audience: string } {
  if (copy === "B") return { copy: "Copy B", audience: "For Recipient" };
  return { copy: "Copy C", audience: "For Payer" };
}

export async function renderNec1099Pdf(lib: PdfLibLike, form: Nec1099Form, copyArg: string): Promise<Uint8Array> {
  const copy = printableCopy(copyArg);
  if (!copy) {
    throw new Error("Copy A is filed electronically and is not generated as a PDF. Only Copy B and Copy C are printed.");
  }
  if (form.revision !== NEC_FORM_REVISION) {
    throw new Error("This renderer is the December 2026 Form 1099-NEC.");
  }

  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const black = lib.rgb(0, 0, 0);
  const gray = lib.rgb(0.25, 0.25, 0.25);
  const rule = lib.rgb(0.2, 0.2, 0.2);
  const band = lib.rgb(0.94, 0.94, 0.94);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const text = (value: string, x: number, y: number, size: number, face: PdfFont = font, color: unknown = black) => {
    const line = pdfSafe(value);
    if (!line) return;
    page.drawText(line, { x, y, size, font: face, color });
  };

  let y = PAGE_H - 36;
  page.drawRectangle({ x: LEFT, y: y - 46, width: WIDTH, height: 58, color: band, borderColor: rule, borderWidth: 0.8 });
  text("Form 1099-NEC", LEFT + 10, y - 4, 16, bold);
  text("Nonemployee Compensation", LEFT + 10, y - 20, 9, font, gray);
  text(`Rev. ${form.revision}`, LEFT + 10, y - 34, 8, font, gray);
  const heading = copyTitle(copy);
  text(heading.copy, RIGHT - 120, y - 4, 14, bold);
  text(heading.audience, RIGHT - 120, y - 20, 9, font);
  text(`Calendar year ${form.taxYear}`, RIGHT - 120, y - 34, 9, bold);
  y -= 64;

  const corrected = form.corrected ? "CORRECTED [X]" : "CORRECTED [ ]";
  text(corrected, LEFT, y, 10, bold);
  y -= 16;

  const row = (label: string, value: string) => {
    page.drawRectangle({ x: LEFT, y: y - 4, width: WIDTH, height: 16, borderColor: rule, borderWidth: 0.4 });
    text(label, LEFT + 6, y, 8, font, gray);
    text(value, LEFT + 210, y, 9, bold);
    y -= 16;
  };

  text("PAYER", LEFT, y, 8, bold);
  y -= 14;
  row("Payer's name", form.payer.name);
  row("Payer's street address", form.payer.street);
  row("Payer's city", form.payer.city);
  row("Payer's state", form.payer.state);
  row("Payer's ZIP code", form.payer.zip);
  row("Payer's telephone", form.payer.phone);
  row("Payer's TIN", form.payer.tin);

  y -= 8;
  text("RECIPIENT", LEFT, y, 8, bold);
  y -= 14;
  row("Recipient's TIN", form.recipient.tin);
  row("Recipient's name", form.recipient.name);
  row("Recipient's street address", form.recipient.street);
  row("Recipient's city", form.recipient.city);
  row("Recipient's state", form.recipient.state);
  row("Recipient's ZIP code", form.recipient.zip);
  row("Account number", form.accountNumber);

  y -= 8;
  text("COMPENSATION", LEFT, y, 8, bold);
  y -= 14;
  row("1a Nonemployee compensation", money(form.box1aCents));
  row("1b Cash tips", money(form.box1bCents));
  row("1c Treasury Tipped Occupation Code(s)", codes(form.box1cCodes));
  row("1d Overtime compensation", money(form.box1dCents));
  row("2 Payer made direct sales of $5,000 or more", "[ ]");
  row("3 Excess golden parachute payments", money(form.box3Cents));
  row("4 Federal income tax withheld", money(form.box4Cents));

  y -= 8;
  text("STATE", LEFT, y, 8, bold);
  y -= 12;
  text("5 State tax withheld    6 State / Payer's state no.    7 State income", LEFT, y, 8, font, gray);
  y -= 14;
  row("State entry 1", stateRow(form.stateLines[0]));
  row("State entry 2", stateRow(form.stateLines[1]));

  y -= 16;
  const notes = [
    "Box 1b reports cash tips included in box 1a. Box 1d, when any, reports qualified overtime included in box 1a.",
    "A blank box does not apply. Zero is not printed in a box that does not apply.",
    "Copy A is filed electronically and is not produced as a printable form.",
    `${heading.copy} — ${heading.audience}. Form 1099-NEC (Rev. ${form.revision}).`,
  ];
  for (const note of notes) {
    text(note, LEFT, y, 7, font, gray);
    y -= 10;
  }

  page.drawLine({
    start: { x: LEFT, y: y + 6 },
    end: { x: RIGHT, y: y + 6 },
    thickness: 0.4,
    color: rule,
  });

  return pdf.save();
}
