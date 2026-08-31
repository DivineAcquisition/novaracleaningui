// Current Property & Rate Schedule — Company-set, read-only.
// Distinct from the signed Host Partnership Agreement PDF (which still
// includes Section 17 as of the signature date). Additional properties that
// later get a Company rate appear here; unpriced requests do not.

import { bedsBathsLabel, formatTurnoverRate } from "@/lib/host-onboarding/agreement";

export interface RateScheduleProperty {
  nickname: string | null;
  address: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  turnoverPrice: number | null;
}

export async function buildRateSchedulePdf(input: {
  hostName: string;
  properties: RateScheduleProperty[];
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(92 / 255, 15 / 255, 254 / 255);
  const dark = rgb(0.12, 0.12, 0.18);
  const gray = rgb(0.4, 0.4, 0.48);
  const MARGIN = 48;
  let page = pdf.addPage([612, 792]);
  let y = 744;

  const text = (s: string, opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; dy?: number }) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    y -= opts.dy ?? size + 4;
    page.drawText(s, { x: MARGIN, y, size, font: f, color: opts.color ?? dark });
  };

  text("Property & Rate Schedule", { size: 18, f: bold, color: purple, dy: 20 });
  text(input.hostName, { size: 11, f: bold, dy: 16 });
  text(
    "Per-turnover rates are set by the Company under Section 5.2. They are read-only in the partner portal.",
    { size: 9, color: gray, dy: 14 },
  );
  text(`Generated ${new Date().toISOString().slice(0, 10)}`, { size: 8, color: gray, dy: 12 });
  y -= 8;

  if (!input.properties.length) {
    text("No priced properties on this account yet.", { size: 10, color: gray });
  }

  for (const [i, prop] of input.properties.entries()) {
    if (y < 120) {
      page = pdf.addPage([612, 792]);
      y = 744;
    }
    page.drawRectangle({
      x: MARGIN,
      y: y - 70,
      width: 612 - MARGIN * 2,
      height: 78,
      borderColor: rgb(0.85, 0.85, 0.9),
      borderWidth: 1,
    });
    text(`Property ${i + 1} — ${prop.nickname || "Property"}`, { size: 11, f: bold, dy: 16 });
    text(prop.address || "Address on file", { size: 9, color: gray, dy: 12 });
    text(
      `${bedsBathsLabel(prop.bedrooms, prop.bathrooms)}   ·   ${formatTurnoverRate(prop.turnoverPrice)} per turnover`,
      { size: 10, f: bold, dy: 14 },
    );
    y -= 28;
  }

  return pdf.save();
}
