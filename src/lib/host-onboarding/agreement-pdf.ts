// Builds the executed Host Partnership Agreement in the browser.
// Same pdf-lib approach as the commercial and residential one-time agreements.

import {
  AGREEMENT_CLAUSES,
  BINDING_ACKNOWLEDGMENTS,
  COMPANY_LEGAL_NAME,
  IMPORTANT_NOTICE,
  PAYMENT_OPTIONS,
  bedsBathsLabel,
  formatTurnoverRate,
  type PaymentOptionKey,
} from "./agreement";
import type { SnapshotProperty } from "./session";

export interface HostAgreementPdfFields {
  signerName: string;
  signerEmail: string;
  entityType?: string | null;
  entityName?: string | null;
  properties: SnapshotProperty[];
  paymentOption?: PaymentOptionKey | string | null;
  signatureDataUrl?: string | null;
}

/** Helvetica is WinAnsi — drop or replace characters it cannot encode. */
function winAnsi(value: string): string {
  return String(value || "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/·/g, "-")
    .replace(/[☑✓]/g, "[x]")
    .replace(/[☐]/g, "[ ]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

export async function buildHostAgreementBase64(fields: HostAgreementPdfFields): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const purple = rgb(0.486, 0.227, 0.929);
  const dark = rgb(0.12, 0.11, 0.18);
  const gray = rgb(0.42, 0.42, 0.5);
  const rule = rgb(0.88, 0.88, 0.92);
  const warn = rgb(0.55, 0.22, 0.1);

  const MARGIN = 56;
  const WIDTH = 612;
  const HEIGHT = 792;
  const RIGHT = WIDTH - MARGIN;

  let page = pdf.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - 56;

  const newPage = () => {
    page = pdf.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - 56;
  };
  const room = (needed: number) => {
    if (y - needed < 64) newPage();
  };

  const text = (
    value: string,
    opts: { size?: number; f?: typeof font; color?: typeof dark; x?: number; dy?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    page.drawText(winAnsi(value), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.f ?? font,
      color: opts.color ?? dark,
    });
    y -= opts.dy ?? size + 6;
  };

  const wrap = (
    value: string,
    opts: { size?: number; f?: typeof font; color?: typeof dark; width?: number; x?: number } = {},
  ) => {
    const size = opts.size ?? 9.5;
    const f = opts.f ?? font;
    const maxWidth = opts.width ?? RIGHT - (opts.x ?? MARGIN);
    const words = winAnsi(value).split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        room(size + 5);
        text(line, { size, f, color: opts.color, x: opts.x, dy: size + 4 });
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      room(size + 5);
      text(line, { size, f, color: opts.color, x: opts.x, dy: size + 4 });
    }
  };

  const divider = () => {
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: RIGHT, y: y + 4 },
      thickness: 0.75,
      color: rule,
    });
    y -= 12;
  };

  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  text("Host Partnership Agreement", { size: 17, f: bold, color: purple, dy: 22 });
  text(`${COMPANY_LEGAL_NAME} · Executed copy`, { size: 10, color: gray, dy: 18 });
  divider();

  const field = (label: string, value: string) => {
    room(16);
    page.drawText(winAnsi(label), { x: MARGIN, y, size: 9, font: bold, color: gray });
    page.drawText(winAnsi(value || "-"), { x: MARGIN + 132, y, size: 10, font, color: dark });
    y -= 17;
  };

  field("Effective Date", today);
  field("Host", fields.entityName || fields.signerName);
  field("Signing as", fields.entityType === "entity" ? "Business entity" : "Individual");
  if (fields.entityName) field("Entity name", fields.entityName);
  field("Authorized Signer", fields.signerName);
  field("Signer Email", fields.signerEmail);
  if (fields.paymentOption && PAYMENT_OPTIONS[fields.paymentOption as PaymentOptionKey]) {
    field("§6.2 payment option", PAYMENT_OPTIONS[fields.paymentOption as PaymentOptionKey].title);
  }

  y -= 4;
  room(70);
  text("Important Notice", { size: 11, f: bold, color: warn, dy: 14 });
  wrap(IMPORTANT_NOTICE, { size: 9, color: warn });
  y -= 8;
  divider();

  for (const [heading, copy] of AGREEMENT_CLAUSES) {
    room(46);
    text(heading, { size: 10.5, f: bold, color: dark, dy: 14 });
    wrap(copy, { size: 9.5, color: dark });
    y -= 6;
  }

  newPage();
  text("Section 17 — Property & Rate Schedule", { size: 15, f: bold, color: purple, dy: 20 });
  wrap(
    "Each block below is a Property from the proposal. The per-turnover rate was set by the Company " +
      "under Section 5.2. The Host confirms the details; the Host does not edit the rate.",
    { size: 9, color: gray },
  );
  y -= 10;

  for (const [i, prop] of fields.properties.entries()) {
    room(88);
    page.drawRectangle({
      x: MARGIN,
      y: y - 62,
      width: RIGHT - MARGIN,
      height: 74,
      borderColor: rule,
      borderWidth: 1,
    });
    text(`Property ${i + 1} — ${prop.nickname || "Property"}`, { size: 11, f: bold, dy: 14 });
    wrap(prop.address || "Address on file", { size: 9, color: gray });
    text(
      `${bedsBathsLabel(prop.bedrooms, prop.bathrooms)}   ·   ${formatTurnoverRate(prop.turnover_price)} per turnover`,
      { size: 10, f: bold, dy: 14 },
    );
    const extras = [
      prop.linen ? "Linen included" : null,
      prop.restock ? "Restock included" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (extras) text(extras, { size: 8.5, color: gray, dy: 12 });
    y -= 10;
  }

  y -= 8;
  room(80);
  text("Acknowledged binding provisions", { size: 11, f: bold, dy: 14 });
  for (const ack of BINDING_ACKNOWLEDGMENTS) {
    wrap(`[x]  ${ack.label}. ${ack.text}`, { size: 8.5 });
    y -= 4;
  }

  y -= 10;
  room(90);
  text("Signature", { size: 11, f: bold, dy: 16 });
  if (fields.signatureDataUrl?.startsWith("data:image/png;base64,")) {
    try {
      const raw = atob(fields.signatureDataUrl.split(",")[1] || "");
      const png = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) png[i] = raw.charCodeAt(i);
      const img = await pdf.embedPng(png);
      const w = 180;
      const h = (img.height / img.width) * w;
      room(h + 24);
      page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      text("(signature on file)", { size: 9, color: gray });
    }
  }
  field("Signed by", fields.signerName);
  field("Date", today);

  const bytes = await pdf.save();
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
