// Builds the executed Property Management Services Agreement in the browser.
// Same pdf-lib approach as the host, commercial, and residential agreements.
//
// Section 16 is the part that matters here: every registered unit as its own
// block with the Company-set Move-Out, Move-In and Standard rates printed on
// it, so the signed document and the portal always show the same numbers.

import { PM_SERVICE_LABELS, PM_SERVICE_TYPES, formatRate } from "../pricing";
import {
  AGREEMENT_CLAUSES,
  BINDING_ACKNOWLEDGMENTS,
  COMPANY_LEGAL_NAME,
  IMPORTANT_NOTICE,
  PM_BILLING_OPTIONS,
  type PmBillingMethod,
} from "./agreement";
import type { SnapshotUnit } from "./session";

/** pdf-lib Helvetica is WinAnsi; a stray dash must not strand a signer. */
function pdfSafe(value: string): string {
  return String(value ?? "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2610\u2611\u2612\u2713\u2714]/g, "[x]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

export interface PmAgreementPdfFields {
  signerName: string;
  signerEmail: string;
  entityType?: string | null;
  entityName?: string | null;
  companyName?: string | null;
  units: SnapshotUnit[];
  billingMethod?: PmBillingMethod | string | null;
  volumeDiscountPercent?: number;
  signatureDataUrl?: string | null;
}

function unitSizeLine(unit: SnapshotUnit): string {
  return [
    unit.sqft ? `${unit.sqft} sqft` : null,
    unit.bedrooms == null ? null : `${unit.bedrooms} bed`,
    unit.bathrooms == null ? null : `${unit.bathrooms} bath`,
    unit.zone_code ? `zone ${unit.zone_code}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

export async function buildPmAgreementBase64(fields: PmAgreementPdfFields): Promise<string> {
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
    page.drawText(pdfSafe(value), {
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
    const words = pdfSafe(value).split(/\s+/);
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

  text("Property Management Services Agreement", { size: 16, f: bold, color: purple, dy: 22 });
  text(`${COMPANY_LEGAL_NAME} · Executed copy`, { size: 10, color: gray, dy: 18 });
  divider();

  const field = (label: string, value: string) => {
    room(16);
    page.drawText(pdfSafe(label), { x: MARGIN, y, size: 9, font: bold, color: gray });
    page.drawText(pdfSafe(value || "-"), { x: MARGIN + 148, y, size: 10, font, color: dark });
    y -= 17;
  };

  const billing = PM_BILLING_OPTIONS[String(fields.billingMethod || "invoiced") as PmBillingMethod];

  field("Effective Date", today);
  field("Manager", fields.entityName || fields.companyName || fields.signerName);
  field("Signing as", fields.entityType === "individual" ? "Individual" : "Business entity");
  field("Authorized Signer", fields.signerName);
  field("Signer Email", fields.signerEmail);
  field("Registered units", String(fields.units.length));
  if (billing) field("§7 billing", billing.title);
  if (Number(fields.volumeDiscountPercent || 0) > 0) {
    field("§6 volume discount", `${Number(fields.volumeDiscountPercent)}% (Company margin)`);
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
  text("Section 16 — Unit Registry & Standing Rates", { size: 15, f: bold, color: purple, dy: 20 });
  wrap(
    "Each block below is a registered Unit. Its standing rates were set by the Company under " +
      "Section 5 from the Unit's size, bedroom count and service zone, and hold for every turnover " +
      "on that Unit until the Company changes them. The Manager confirms the details; the Manager " +
      "does not edit a rate.",
    { size: 9, color: gray },
  );
  y -= 10;

  for (const [i, unit] of fields.units.entries()) {
    room(104);
    page.drawRectangle({
      x: MARGIN,
      y: y - 78,
      width: RIGHT - MARGIN,
      height: 90,
      borderColor: rule,
      borderWidth: 1,
    });
    text(`Unit ${i + 1} — ${unit.unit_label || unit.address || "Unit"}`, { size: 11, f: bold, dy: 14 });
    wrap(
      [unit.address, unit.city, unit.state, unit.zip_code].filter(Boolean).join(", ") ||
        "Address on file",
      { size: 9, color: gray },
    );
    const size = unitSizeLine(unit);
    if (size) text(size, { size: 8.5, color: gray, dy: 13 });
    text(
      PM_SERVICE_TYPES.map((s) => `${PM_SERVICE_LABELS[s]} ${formatRate(unit.rates[s])}`).join("   ·   "),
      { size: 9.5, f: bold, dy: 14 },
    );
    y -= 12;
  }

  y -= 8;
  room(80);
  text("Acknowledged binding provisions", { size: 11, f: bold, dy: 14 });
  for (const ack of BINDING_ACKNOWLEDGMENTS) {
    wrap(`[x] ${ack.label}. ${ack.text}`, { size: 8.5 });
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
