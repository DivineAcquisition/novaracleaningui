// Plain letter PDFs. Header carries the name. Body is black on white.
// Page caps are the packet caps from the evidence set.

import { pdfSafe } from "../qc-factual-summary-render.ts";
import type { PacketDoc } from "./build.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const BOTTOM = 46;

interface PdfFont {
  widthOfTextAtSize(text: string, size: number): number;
}
interface PdfPage {
  drawText(text: string, opts: Record<string, unknown>): void;
  drawLine(opts: Record<string, unknown>): void;
}
interface PdfDoc {
  addPage(size: [number, number]): PdfPage;
  embedFont(font: string): Promise<PdfFont>;
  getPages(): PdfPage[];
  save(): Promise<Uint8Array>;
}
export interface PdfLibLike {
  PDFDocument: { create(): Promise<PdfDoc> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb: (r: number, g: number, b: number) => unknown;
}

export async function renderPacketPdf(lib: PdfLibLike, packet: PacketDoc): Promise<{ bytes: Uint8Array; pages: number }> {
  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const black = lib.rgb(0.08, 0.08, 0.08);
  const gray = lib.rgb(0.35, 0.35, 0.38);
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 46;
  let pages = 1;

  const header = () => {
    page.drawText(pdfSafe("Novara Cleaning"), { x: MARGIN, y, size: 11, font: bold, color: black });
    y -= 14;
    page.drawText(pdfSafe(packet.title), { x: MARGIN, y, size: 9, font, color: gray });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: gray });
    y -= 14;
  };
  const footer = () => {
    page.drawText(pdfSafe(`${packet.filename}  page ${pages}`), {
      x: MARGIN, y: 28, size: 8, font, color: gray,
    });
  };
  const next = () => {
    footer();
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages++;
    y = PAGE_H - 46;
    header();
  };
  header();

  const width = PAGE_W - MARGIN * 2;
  const drawWrapped = (text: string, size: number, face: PdfFont) => {
    const words = pdfSafe(text).split(/\s+/).filter(Boolean);
    let cur = "";
    const lines: string[] = [];
    for (const w of words.length ? words : [""]) {
      const trial = cur ? `${cur} ${w}` : w;
      if (face.widthOfTextAtSize(trial, size) > width && cur) {
        lines.push(cur);
        cur = w;
      } else cur = trial;
    }
    if (cur) lines.push(cur);
    for (const line of lines.length ? lines : [""]) {
      if (y < BOTTOM) next();
      page.drawText(line, { x: MARGIN, y, size, font: face, color: black });
      y -= size + 3;
    }
  };

  for (const line of packet.lines) {
    if (!line.trim()) {
      y -= 6;
      continue;
    }
    const isLabel = /^(Customer|Novara|Photo |Booking |Service|Timeline|Automated transcript)/.test(line)
      || line.endsWith(":");
    drawWrapped(line, line.startsWith("Automated transcript") ? 9 : 9, isLabel && line.length < 80 ? bold : font);
  }
  footer();
  const bytes = await pdf.save();
  return { bytes, pages: pdf.getPages().length };
}

export interface RenderedPacket {
  filename: string;
  stripeField: string;
  bytes: Uint8Array;
  pages: number;
  format: "pdf";
}

export async function renderEvidenceSet(
  lib: PdfLibLike,
  packets: PacketDoc[],
): Promise<RenderedPacket[]> {
  const out: RenderedPacket[] = [];
  for (const packet of packets) {
    const rendered = await renderPacketPdf(lib, packet);
    out.push({
      filename: packet.filename,
      stripeField: packet.stripeField,
      bytes: rendered.bytes,
      pages: rendered.pages,
      format: "pdf",
    });
  }
  return out;
}

export function validateRendered(
  packets: RenderedPacket[],
  text: string,
  limits: { combinedPages: number; combinedBytes: number; singleFilePages: number; textCharacters: number },
): { ok: boolean; pages: number; bytes: number; errors: string[] } {
  const errors: string[] = [];
  const pages = packets.reduce((n, p) => n + p.pages, 0);
  const bytes = packets.reduce((n, p) => n + p.bytes.byteLength, 0);
  const fields = new Set<string>();
  for (const p of packets) {
    if (p.format !== "pdf") errors.push(`${p.filename} is not a PDF.`);
    if (p.pages > limits.singleFilePages) errors.push(`${p.filename} exceeds the single-file page limit.`);
    if (fields.has(p.stripeField)) errors.push(`More than one file for ${p.stripeField}.`);
    fields.add(p.stripeField);
  }
  if (pages > limits.combinedPages) errors.push(`Combined pages ${pages} exceed ${limits.combinedPages}.`);
  if (bytes > limits.combinedBytes) errors.push(`Combined size ${bytes} exceeds ${limits.combinedBytes}.`);
  if (text.length > limits.textCharacters) errors.push("Text fields exceed the character budget.");
  return { ok: errors.length === 0, pages, bytes, errors };
}
