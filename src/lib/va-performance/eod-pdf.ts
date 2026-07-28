// ─── The generated EOD record ─────────────────────────────────────────────────
//
// A branded PDF of the submission, built with pdf-lib the same way the
// screening record is (src/lib/screening-pdf.ts) — same page size, fonts,
// purple, section headers and footer, so the two documents read as a set.
//
// The point of putting the verification INSIDE the document is that the
// comparison becomes part of the permanent record rather than a screen state
// someone has to trust a screenshot of. Entered, verified and variance sit in
// one table, and a metric with no source says "not tracked" in full.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  CLOSING_FIELDS,
  METRIC_FIELDS,
  SELECT_FIELDS,
  formatMetricEntry,
  type MetricField,
} from "./catalog";
import type { EodSubmission } from "./eod";
import { formatMetric, type MetricKey, type MetricValues } from "./metrics";
import type { VaRecord } from "./vas";

export const EOD_BUCKET = "va-eod-reports";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM = 64;

/**
 * pdf-lib's standard fonts encode WinAnsi only, and it THROWS on anything
 * outside it. Free text comes from a human at the end of a long day, so an
 * emoji, a curly quote pasted from Slack or an en dash would otherwise blow up
 * the whole report. Map the common ones to their ASCII equivalents and drop
 * the rest — a slightly plainer document beats a missing one.
 */
const WIN_ANSI_SUBSTITUTIONS: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2010\u2011\u2012\u2013]/g, "-"],
  [/\u2212/g, "-"], // minus sign — NOT in WinAnsi, unlike the hyphen
  [/\u2026/g, "..."],
  [/[\u2022\u00B7]/g, "-"],
  [/\u00A0/g, " "],
  [/\u20AC/g, "EUR"],
];

export function pdfSafe(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, replacement] of WIN_ANSI_SUBSTITUTIONS) out = out.replace(pattern, replacement);
  // Anything still outside Latin-1 (emoji, CJK, symbols) can't be encoded.
  return out.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A1-\u00FF]/g, "");
}

export interface EodPdfInput {
  submission: EodSubmission;
  va: VaRecord;
  verified: MetricValues;
  /** Per-metric provenance so "unavailable" reads differently to "not tracked". */
  verifiedStatus: Partial<Record<MetricKey, string>>;
}

/** Sum a metric field's corroborating signal, or null when there isn't one. */
export function signalFor(field: MetricField, verified: MetricValues): number | null {
  if (!field.corroborate) return null;
  let total: number | null = null;
  for (const key of field.corroborate.metrics) {
    const value = verified[key];
    if (value === null || value === undefined) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

export async function buildEodPdf(input: EodPdfInput): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const purple = rgb(0.486, 0.227, 0.929);
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.42, 0.45, 0.5);
  const amber = rgb(0.72, 0.45, 0.05);
  const rule = rgb(0.9, 0.91, 0.93);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 56;
  let pageNo = 1;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
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

  const draw = (text: string, opts: Parameters<typeof page.drawText>[1]) =>
    page.drawText(pdfSafe(text), opts);

  const sectionHeader = (title: string) => {
    ensure(40);
    y -= 8;
    page.drawRectangle({ x: MARGIN_X, y: y - 4, width: CONTENT_W, height: 20, color: rgb(0.955, 0.94, 1) });
    page.drawText(title.toUpperCase(), { x: MARGIN_X + 8, y: y + 1, size: 10, font: bold, color: purple });
    y -= 24;
  };

  const paragraph = (text: string, size = 10) => {
    for (const line of wrap(text, size, CONTENT_W)) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN_X, y, size, font, color: dark });
      y -= size + 4;
    }
  };

  // ── Header ──
  page.drawText("NOVARA CLEANING", { x: MARGIN_X, y, size: 20, font: bold, color: purple });
  y -= 22;
  page.drawText("VA End-of-Day Report", { x: MARGIN_X, y, size: 13, font: bold, color: dark });
  y -= 16;
  page.drawText("Entered figures beside what the system independently recorded", {
    x: MARGIN_X,
    y,
    size: 9,
    font,
    color: gray,
  });
  y -= 20;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.5, color: purple });
  y -= 20;

  // ── Identity ──
  const hours = input.verified.hours_tracked;
  const hoursText =
    hours === null || hours === undefined ? "unverified" : formatMetric("hours_tracked", hours);
  const meta: [string, string][] = [
    ["VA", input.va.name],
    ["Date", input.submission.workDate],
    [
      "Submitted",
      input.submission.submittedAt
        ? new Date(input.submission.submittedAt).toLocaleString("en-US", {
            timeZone: "America/New_York",
            dateStyle: "medium",
            timeStyle: "short",
          }) + (input.submission.submittedLate ? "  (late)" : "")
        : "—",
    ],
    ["Hours tracked", `${hoursText}  (Apploye)`],
  ];
  for (const [label, value] of meta) {
    ensure(16);
    page.drawText(`${label}:`, { x: MARGIN_X, y, size: 10, font: bold, color: gray });
    draw(value, { x: MARGIN_X + 96, y, size: 10, font, color: dark });
    y -= 15;
  }

  // ── Metrics table: entered · verified · variance ──
  sectionHeader("Metrics");

  const col = { metric: MARGIN_X, entered: MARGIN_X + 244, verified: MARGIN_X + 330, variance: MARGIN_X + 420 };
  ensure(20);
  for (const [label, x] of [
    ["Metric", col.metric],
    ["Entered", col.entered],
    ["Verified", col.verified],
    ["Variance", col.variance],
  ] as [string, number][]) {
    page.drawText(label, { x, y, size: 8, font: bold, color: gray });
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.7, color: rule });
  y -= 14;

  for (const field of METRIC_FIELDS) {
    ensure(18);
    const entered = input.submission.metrics[field.key];
    const enteredText = entered === undefined ? "—" : formatMetricEntry(field, entered);

    let verifiedText: string;
    let varianceText = "—";
    let varianceColor = dark;

    if (!field.corroborate) {
      verifiedText = "not tracked";
    } else {
      const signal = signalFor(field, input.verified);
      if (signal === null) {
        verifiedText = "unavailable";
      } else {
        verifiedText = formatMetricEntry(field, signal);
        if (entered !== undefined) {
          const delta = entered - signal;
          const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
          varianceText = `${sign}${formatMetricEntry(field, Math.abs(delta))}`;
          if (Math.abs(delta) > 0) varianceColor = amber;
        }
      }
    }

    draw(field.label, { x: col.metric, y, size: 9.5, font, color: dark });
    draw(enteredText, { x: col.entered, y, size: 9.5, font: bold, color: dark });
    draw(verifiedText, {
      x: col.verified,
      y,
      size: 9.5,
      font,
      color: verifiedText === "not tracked" || verifiedText === "unavailable" ? gray : dark,
    });
    draw(varianceText, { x: col.variance, y, size: 9.5, font, color: varianceColor });
    y -= 16;
  }

  y -= 4;
  ensure(24);
  page.drawText(
    '"not tracked" means no source exists for that metric yet — it is not a verified zero.',
    { x: MARGIN_X, y, size: 8, font, color: gray },
  );
  y -= 14;

  // ── Selects + their follow-ups ──
  sectionHeader("The day");
  for (const field of SELECT_FIELDS) {
    const answer = input.submission.selects[field.key] || "—";
    ensure(18);
    draw(`${field.label}:`, { x: MARGIN_X, y, size: 10, font: bold, color: gray });
    draw(answer, { x: MARGIN_X + 196, y, size: 10, font: bold, color: dark });
    y -= 15;

    if (field.followUp) {
      const text = followUpText(input.submission, field.followUp.key);
      if (text) {
        y -= 2;
        paragraph(text, 9.5);
        y -= 6;
      }
    }
  }

  // ── Closing free text ──
  sectionHeader("Priorities & notes");
  for (const field of CLOSING_FIELDS) {
    const text = followUpText(input.submission, field.key);
    ensure(20);
    draw(field.label, { x: MARGIN_X, y, size: 10, font: bold, color: gray });
    y -= 14;
    paragraph(text || "—", 9.5);
    y -= 8;
  }

  // ── Footer on every page ──
  const pages = pdf.getPages();
  const generated = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN_X, y: BOTTOM - 14 },
      end: { x: PAGE_W - MARGIN_X, y: BOTTOM - 14 },
      thickness: 0.7,
      color: rule,
    });
    p.drawText(`Generated ${generated} — Novara Cleaning · Internal & confidential`, {
      x: MARGIN_X,
      y: BOTTOM - 26,
      size: 7.5,
      font,
      color: gray,
    });
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN_X - 56,
      y: BOTTOM - 26,
      size: 7.5,
      font,
      color: gray,
    });
  });

  return pdf.save();
}

function followUpText(submission: EodSubmission, key: string): string {
  switch (key) {
    case "blockers":
      return submission.blockers || "";
    case "escalations":
      return submission.escalations || "";
    case "cleaner_issue_notes":
      return submission.cleanerIssueNotes || "";
    case "priorities":
      return submission.priorities || "";
    case "wins":
      return submission.wins || "";
    default:
      return "";
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/** One object per VA per day, overwritten on re-submit so exactly one exists. */
export function reportPath(vaId: string, workDate: string): string {
  return `${vaId}/${workDate}.pdf`;
}

export function reportFilename(va: VaRecord, workDate: string): string {
  const safe = va.name.replace(/[^\w\s-]/g, "").trim() || "VA";
  return `${safe} - ${workDate}.pdf`;
}

/**
 * A URL Airtable's servers can fetch. The bucket is private, so this is a
 * signed link — Airtable downloads and re-hosts the file immediately, so a
 * short-lived URL is enough and nothing stays publicly readable.
 */
export async function signedReportUrl(path: string, ttlSeconds = 3600): Promise<string | null> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.storage.from(EOD_BUCKET).createSignedUrl(path, ttlSeconds);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
