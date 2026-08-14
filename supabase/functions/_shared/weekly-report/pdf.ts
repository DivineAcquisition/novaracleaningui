// Branded weekly report PDF — same letter size, Helvetica, violet header and
// footer as VA EOD / screening records.

import type { ComparedMetric, Insight, WeeklySnapshot } from "./types.ts";
import { formatRangeLabel } from "./period.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM = 64;

const WIN_ANSI: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013]/g, "-"],
  [/\u2212/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u00B7]/g, "-"],
  [/\u00A0/g, " "],
];

export function pdfSafe(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI) out = out.replace(pattern, replacement);
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

function money(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "unavailable";
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatValue(unit: ComparedMetric["unit"], value: number | null): string {
  if (value == null) return "unavailable";
  if (unit === "cents") return money(value);
  if (unit === "pct") return `${value.toFixed(1)}%`;
  if (unit === "seconds") return value >= 60 ? `${Math.round(value / 60)} min` : `${Math.round(value)} sec`;
  if (unit === "score") return value.toFixed(1);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function delta(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

export async function buildWeeklyReportPdf(input: {
  snapshot: WeeklySnapshot;
  executiveSummary: string;
  insights: Insight[];
  watchList: string[];
  model: string;
  modelVersion: string;
  generatedAt: Date;
}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("https://esm.sh/pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const purple = rgb(0.361, 0.059, 0.996);
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.42, 0.45, 0.5);
  const muted = rgb(0.55, 0.58, 0.62);
  const rule = rgb(0.9, 0.91, 0.93);
  const wash = rgb(0.955, 0.94, 1);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 52;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 52;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage();
  };
  const wrap = (text: string, size: number, width: number, face = font): string[] => {
    const out: string[] = [];
    for (const rawLine of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of rawLine.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (face.widthOfTextAtSize(candidate, size) > width && line) {
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
  const draw = (text: string, x: number, size: number, face = font, color = dark) => {
    page.drawText(pdfSafe(text), { x, y, size, font: face, color });
  };
  const paragraph = (text: string, size = 9.5) => {
    for (const line of wrap(text, size, CONTENT_W)) {
      ensure(size + 4);
      draw(line, MARGIN_X, size);
      y -= size + 4;
    }
  };
  const sectionHeader = (title: string) => {
    ensure(36);
    y -= 6;
    page.drawRectangle({ x: MARGIN_X, y: y - 4, width: CONTENT_W, height: 18, color: wash });
    page.drawText(title.toUpperCase(), { x: MARGIN_X + 8, y: y + 1, size: 9, font: bold, color: purple });
    y -= 22;
  };

  draw("NOVARA CLEANING", MARGIN_X, 18, bold, purple);
  y -= 20;
  draw("Weekly Sales, Retention & Growth Report", MARGIN_X, 13, bold);
  y -= 16;
  draw(formatRangeLabel(input.snapshot.period_start, input.snapshot.period_end), MARGIN_X, 10, font, gray);
  y -= 12;
  const generated = input.generatedAt.toLocaleString("en-US", {
    timeZone: input.snapshot.timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  draw(`Generated ${generated}  ·  comparisons vs prior week and trailing 4-week average`, MARGIN_X, 8, font, muted);
  y -= 18;

  sectionHeader("1. Executive summary");
  paragraph(input.executiveSummary, 10);
  y -= 4;

  const renderTable = (title: string, rows: ComparedMetric[]) => {
    sectionHeader(title);
    ensure(28);
    draw("Metric", MARGIN_X, 7.5, bold, gray);
    draw("This week", MARGIN_X + 210, 7.5, bold, gray);
    draw("Prior week", MARGIN_X + 300, 7.5, bold, gray);
    draw("4-wk avg", MARGIN_X + 390, 7.5, bold, gray);
    draw("WoW", MARGIN_X + 470, 7.5, bold, gray);
    y -= 11;
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.4, color: rule });
    y -= 12;
    for (const row of rows) {
      ensure(16);
      const cur = row.current.available ? formatValue(row.unit, row.current.value) : "unavailable";
      const prior = row.prior.available ? formatValue(row.unit, row.prior.value) : "unavailable";
      const trail = row.trailing4.available ? formatValue(row.unit, row.trailing4.value) : "unavailable";
      draw(row.label.slice(0, 34), MARGIN_X, 8.5);
      draw(cur, MARGIN_X + 210, 8.5, row.current.available ? font : font, row.current.available ? dark : muted);
      draw(prior, MARGIN_X + 300, 8.5, font, row.prior.available ? dark : muted);
      draw(trail, MARGIN_X + 390, 8.5, font, row.trailing4.available ? dark : muted);
      draw(delta(row.wow_pct), MARGIN_X + 470, 8.5);
      y -= 13;
      if (!row.current.available && row.current.unavailable_reason) {
        ensure(12);
        for (const line of wrap(`data unavailable this week — ${row.current.unavailable_reason}`, 7.5, CONTENT_W)) {
          draw(line, MARGIN_X + 8, 7.5, font, muted);
          y -= 10;
        }
      }
    }
    y -= 4;
  };

  renderTable("2. Sales", input.snapshot.metrics.filter((m) => m.section === "sales"));
  renderTable("3. Retention", input.snapshot.metrics.filter((m) => m.section === "retention"));
  renderTable("4. Growth", input.snapshot.metrics.filter((m) => m.section === "growth"));

  sectionHeader("Zone / city performance (completed jobs, else created)");
  if (!input.snapshot.cities.length) {
    paragraph("data unavailable this week — no bookings with a city in this window.");
  } else {
    ensure(16);
    draw("City", MARGIN_X, 7.5, bold, gray);
    draw("Jobs", MARGIN_X + 280, 7.5, bold, gray);
    draw("Revenue", MARGIN_X + 360, 7.5, bold, gray);
    y -= 12;
    for (const c of input.snapshot.cities) {
      ensure(14);
      draw(c.city.slice(0, 40), MARGIN_X, 8.5);
      draw(String(c.jobs), MARGIN_X + 280, 8.5);
      draw(money(c.revenue_cents), MARGIN_X + 360, 8.5);
      y -= 12;
    }
    y -= 4;
  }

  sectionHeader("Ad spend & CAC (from ad-spend logs)");
  if (!input.snapshot.ad_spend.length) {
    paragraph("data unavailable this week — no rows in pl_ad_spend for this period.");
  } else {
    for (const row of input.snapshot.ad_spend) {
      ensure(14);
      const cac = row.cac_cents == null ? "CAC unavailable (no booked_jobs on the log)" : `CAC ${money(row.cac_cents)}`;
      paragraph(`${row.platform}: spend ${money(row.spend_cents)}, leads ${row.leads ?? "—"}, booked ${row.booked_jobs ?? "—"}, ${cac}. Source: pl_ad_spend.`);
    }
  }

  renderTable("Cleaner / VA ops", input.snapshot.metrics.filter((m) => m.section === "ops"));

  sectionHeader("5. Insight & analysis");
  paragraph("Each item is a hypothesis grounded in the numbers above. Nothing here changes budgets, zones, or pricing.");
  y -= 2;
  if (!input.insights.length) {
    paragraph("No material week-over-week movements met the insight threshold.");
  } else {
    input.insights.forEach((ins, i) => {
      ensure(48);
      draw(`${i + 1}. ${ins.observation}`, MARGIN_X, 9.5, bold);
      y -= 13;
      paragraph(`${ins.numbers} — ${ins.hypothesis}`, 9);
      y -= 4;
    });
  }

  sectionHeader("6. Watch list");
  if (!input.watchList.length) {
    paragraph("No items carried forward.");
  } else {
    input.watchList.forEach((item, i) => {
      paragraph(`${i + 1}. ${item}`, 9.5);
    });
  }

  sectionHeader("Sources & model");
  const missing = input.snapshot.sources.filter((s) => !s.available);
  if (missing.length) {
    paragraph(`Unavailable this week: ${missing.map((s) => `${s.label} (${s.reason})`).join("; ")}`);
  } else {
    paragraph("All configured sources returned data for this window.");
  }
  paragraph(`Insight model: ${input.model} (${input.modelVersion}). This report is read-only output.`);

  // Footers on every page
  const pages = pdf.getPages();
  pages.forEach((p, idx) => {
    const label = `Novara Cleaning  |  Weekly Sales, Retention & Growth  |  page ${idx + 1} of ${pages.length}  |  ${pdfSafe(input.model)}`;
    p.drawLine({ start: { x: MARGIN_X, y: 42 }, end: { x: PAGE_W - MARGIN_X, y: 42 }, thickness: 0.5, color: rule });
    p.drawText(label, { x: MARGIN_X, y: 28, size: 7, font, color: muted });
  });

  return pdf.save();
}

export function reportFilename(periodStart: string): string {
  return `${periodStart} - Weekly Report.pdf`;
}

export function reportPath(periodStart: string, periodEnd: string): string {
  const year = periodStart.slice(0, 4);
  return `${year}/${periodStart}_${periodEnd}.pdf`;
}
