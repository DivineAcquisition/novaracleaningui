// Plain letter PDFs. Every page carries the identification strip from the
// packet record. Photos are drawn at or above the minimum size, or dropped.

import { photoDisplaySize, type PacketDoc } from "./build.ts";

function pdfSafe(value: string): string {
  return String(value ?? "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

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
  drawImage(image: unknown, opts: Record<string, unknown>): void;
}
interface PdfImage {
  width: number;
  height: number;
}
interface PdfDoc {
  addPage(size: [number, number]): PdfPage;
  embedFont(font: string): Promise<PdfFont>;
  embedJpg(bytes: Uint8Array): Promise<PdfImage>;
  embedPng(bytes: Uint8Array): Promise<PdfImage>;
  getPages(): PdfPage[];
  save(): Promise<Uint8Array>;
}
export interface PdfLibLike {
  PDFDocument: { create(): Promise<PdfDoc> };
  StandardFonts: { Helvetica: string; HelveticaBold: string };
  rgb: (r: number, g: number, b: number) => unknown;
}

export function identificationStrip(packet: PacketDoc, page: number): string[] {
  const id = packet.identity;
  return [
    "Novara Cleaning",
    `${id?.packetName || packet.title}  page ${page}`,
    `${id?.customerName || "not recorded"}  ·  ${id?.serviceDate || "not recorded"}`,
    `${id?.recordId || "not recorded"}  ·  ${id?.chargeAmount || "not recorded"}`,
  ];
}

export function previewPages(packet: PacketDoc): string[][] {
  const body: string[][] = [];
  let chunk: string[] = [];
  let used = 0;
  const budget = 28;
  for (const line of packet.lines) {
    if (used >= budget) {
      body.push(chunk);
      chunk = [];
      used = 0;
    }
    chunk.push(line);
    used++;
  }
  if (chunk.length || body.length === 0) body.push(chunk);
  return body.map((lines, index) => [...identificationStrip(packet, index + 1), "", ...lines]);
}

export async function renderPacketPdf(lib: PdfLibLike, packet: PacketDoc): Promise<{ bytes: Uint8Array; pages: number }> {
  const pdf = await lib.PDFDocument.create();
  const font = await pdf.embedFont(lib.StandardFonts.Helvetica);
  const bold = await pdf.embedFont(lib.StandardFonts.HelveticaBold);
  const black = lib.rgb(0.08, 0.08, 0.08);
  const gray = lib.rgb(0.35, 0.35, 0.38);
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 40;
  let pages = 1;

  const header = () => {
    const [brand, packetLine, who, record] = identificationStrip(packet, pages);
    page.drawText(pdfSafe(brand), { x: MARGIN, y, size: 11, font: bold, color: black });
    y -= 13;
    page.drawText(pdfSafe(packetLine), { x: MARGIN, y, size: 8, font, color: gray });
    y -= 11;
    page.drawText(pdfSafe(who), { x: MARGIN, y, size: 8, font, color: black });
    y -= 11;
    page.drawText(pdfSafe(record), { x: MARGIN, y, size: 8, font, color: black });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: gray });
    y -= 14;
  };
  const next = () => {
    if (pages >= packet.pageCap) return false;
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages++;
    y = PAGE_H - 40;
    header();
    return true;
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
      if (y < BOTTOM) {
        if (!next()) return;
      }
      page.drawText(line, { x: MARGIN, y, size, font: face, color: black });
      y -= size + 3;
    }
  };

  for (const line of packet.lines) {
    if (pages > packet.pageCap) break;
    if (!line.trim()) {
      y -= 6;
      continue;
    }
    const isLabel = /^(Customer|Novara|Delivery proof|Photo |Booking |Service|Timeline|Automated transcript|How )/.test(line)
      || line.endsWith(":");
    drawWrapped(line, 9, isLabel && line.length < 80 ? bold : font);
  }

  if (packet.signature?.bytes?.byteLength) {
    try {
      const png = packet.signature.bytes[0] === 0x89 && packet.signature.bytes[1] === 0x50;
      const embedded = png ? await pdf.embedPng(packet.signature.bytes) : await pdf.embedJpg(packet.signature.bytes);
      const maxW = width;
      const maxH = 72;
      const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      if (y - h - 16 < BOTTOM) next();
      if (pages <= packet.pageCap) {
        page.drawText("Signature image", { x: MARGIN, y, size: 8, font: bold, color: black });
        page.drawImage(embedded, { x: MARGIN, y: y - h - 12, width: w, height: h });
        y -= h + 28;
      }
    } catch {
      drawWrapped("Signature image: not recorded", 9, font);
    }
  }

  const images = packet.images || [];
  const minH = packet.photoMinHeight || 220;
  const minW = packet.photoMinWidth || 200;
  const maxH = Math.max(packet.photoMaxHeight || 300, minH);
  let dropped = 0;
  for (const img of images) {
    if (pages > packet.pageCap) {
      dropped++;
      continue;
    }
    try {
      const png = img.bytes[0] === 0x89 && img.bytes[1] === 0x50;
      const embedded = png ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
      const size = photoDisplaySize(embedded.width, embedded.height, width, maxH, minW, minH);
      if (!size) {
        dropped++;
        drawWrapped(`${img.label}: omitted because it could not be shown at the minimum readable size.`, 9, font);
        continue;
      }
      const needed = size.h + 28;
      if (y - needed < BOTTOM) {
        if (!next()) {
          dropped++;
          continue;
        }
      }
      if (pages > packet.pageCap) {
        dropped++;
        continue;
      }
      drawWrapped(img.label, 8, bold);
      page.drawImage(embedded, { x: MARGIN, y: y - size.h, width: size.w, height: size.h });
      y -= size.h + 16;
    } catch {
      drawWrapped(`${img.label}: image could not be embedded`, 9, font);
    }
  }
  if (dropped > 0) {
    drawWrapped(`${dropped} additional photographs are on file and were not included because of the page cap.`, 9, font);
  }

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
  limits: { combinedPages: number; combinedBytes: number; singleFilePages: number; textCharacters: number; formats?: string[] },
): { ok: boolean; pages: number; bytes: number; errors: string[] } {
  const errors: string[] = [];
  const pages = packets.reduce((n, p) => n + p.pages, 0);
  const bytes = packets.reduce((n, p) => n + p.bytes.byteLength, 0);
  const allowed = new Set((limits.formats || ["pdf", "png", "jpg", "jpeg"]).map((item) => item.toLowerCase()));
  const fields = new Set<string>();
  for (const p of packets) {
    if (!allowed.has(p.format)) errors.push(`${p.filename} is not an accepted format.`);
    if (p.pages > limits.singleFilePages) errors.push(`${p.filename} exceeds the single-file page limit.`);
    if (fields.has(p.stripeField)) errors.push(`More than one file for ${p.stripeField}.`);
    fields.add(p.stripeField);
  }
  if (pages > limits.combinedPages) errors.push(`Combined pages ${pages} exceed ${limits.combinedPages}.`);
  if (bytes > limits.combinedBytes) errors.push(`Combined size ${bytes} exceeds ${limits.combinedBytes}.`);
  if (text.length > limits.textCharacters) errors.push("Text fields exceed the character budget.");
  return { ok: errors.length === 0, pages, bytes, errors };
}
