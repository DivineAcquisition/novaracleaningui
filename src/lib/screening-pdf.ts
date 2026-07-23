// ─── Screening-record PDF builder (server-side) ────────────────────────────────
//
// Renders a SUBMITTED phone screening into a branded PDF — the permanent,
// attached record of the completed call. Uses pdf-lib with the same Novara
// document standard as the service-agreement / QC dispute-packet PDFs
// (violet header, Helvetica, US Letter, generated-at footer). Content renders
// from the SAME definitions the live form uses (src/lib/phone-screening.ts),
// so the record always matches what the VA captured: every section's
// answers, each consent with its Yes/No + timestamp + who captured it, the
// scenario answers with ratings, the scorecard, and the recommendation.
//
// SERVER ONLY (imported by the /api/talent/screening route).

import {
  CONSENT_ITEMS,
  RECOMMENDATION_LABEL,
  SCENARIO_PAIRS,
  SCORECARD_ITEMS,
  SCREENING_SECTIONS,
  callDurationMinutes,
  consentsState,
  declineReasonLabel,
  hardQualifierState,
  type PhoneScreeningRow,
  type ScreeningQuestion,
} from "@/lib/phone-screening";

export interface ScreeningPdfApplicant {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  zip_code: string | null;
  state: string | null;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 56;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BOTTOM = 64;

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function answerText(q: ScreeningQuestion, value: unknown): string {
  if (value == null || value === "") return "—";
  switch (q.kind) {
    case "gate":
      return value === "pass" ? "Pass" : value === "fail" ? "FAIL" : value === "pending" ? "Pending (fixable)" : "—";
    case "yesno":
      return value === "yes" ? "Yes" : value === "no" ? "No" : "—";
    case "multi":
      return Array.isArray(value) && value.length > 0 ? (value as string[]).join(", ") : "—";
    case "rating":
      return typeof value === "number" ? `${value} / 5` : "—";
    default:
      return String(value);
  }
}

export async function buildScreeningPdf(
  screening: PhoneScreeningRow,
  applicant: ScreeningPdfApplicant,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const purple = rgb(0.486, 0.227, 0.929);
  const dark = rgb(0.12, 0.11, 0.18);
  const gray = rgb(0.42, 0.42, 0.5);
  const green = rgb(0.02, 0.53, 0.32);
  const red = rgb(0.78, 0.13, 0.22);
  const amber = rgb(0.72, 0.44, 0.02);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 56;

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 56;
  };
  const ensure = (needed: number) => {
    if (y - needed < BOTTOM) newPage();
  };

  const wrap = (text: string, size: number, f = font, maxWidth = CONTENT_W): string[] => {
    const out: string[] = [];
    for (const rawLine of String(text).split(/\r?\n/)) {
      const words = rawLine.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let line = "";
      for (const w of words) {
        const candidate = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(candidate, size) <= maxWidth) {
          line = candidate;
        } else {
          if (line) out.push(line);
          line = w;
        }
      }
      if (line) out.push(line);
    }
    return out;
  };

  const drawWrapped = (
    text: string,
    opts: { size?: number; f?: typeof font; color?: ReturnType<typeof rgb>; x?: number; gap?: number; maxWidth?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const x = opts.x ?? MARGIN_X;
    const lines = wrap(text, size, f, opts.maxWidth ?? PAGE_W - x - MARGIN_X);
    for (const l of lines) {
      ensure(size + 4);
      page.drawText(l, { x, y, size, font: f, color: opts.color ?? dark });
      y -= size + 3;
    }
    y -= opts.gap ?? 0;
  };

  const sectionHeader = (title: string) => {
    ensure(40);
    y -= 8;
    page.drawRectangle({ x: MARGIN_X, y: y - 4, width: CONTENT_W, height: 20, color: rgb(0.955, 0.94, 1) });
    page.drawText(title.toUpperCase(), { x: MARGIN_X + 8, y: y + 1, size: 10, font: bold, color: purple });
    y -= 24;
  };

  const qa = (label: string, value: string, valueColor?: ReturnType<typeof rgb>) => {
    ensure(26);
    page.drawText(label, { x: MARGIN_X, y, size: 8, font: bold, color: gray });
    y -= 12;
    drawWrapped(value, { size: 10, color: valueColor ?? dark, gap: 5 });
  };

  // ── Header ──
  page.drawText("NOVARA CLEANING", { x: MARGIN_X, y, size: 20, font: bold, color: purple });
  y -= 22;
  page.drawText("Contractor Phone Screening Record", { x: MARGIN_X, y, size: 13, font: bold, color: dark });
  y -= 16;
  page.drawText("Completed live-call screening — answers, consents, scorecard & recommendation", {
    x: MARGIN_X,
    y,
    size: 9,
    font,
    color: gray,
  });
  y -= 20;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.5, color: purple });
  y -= 18;

  // ── Call summary ──
  const applicantName =
    applicant.full_name ||
    [applicant.first_name, applicant.last_name].filter(Boolean).join(" ") ||
    applicant.email ||
    "—";
  const duration = callDurationMinutes(screening.started_at, screening.submitted_at);
  const rec = screening.recommendation ? RECOMMENDATION_LABEL[screening.recommendation] : "—";
  const recColor =
    screening.recommendation === "advance" ? green : screening.recommendation === "hold" ? amber : red;

  const summaryPairs: Array<[string, string]> = [
    ["APPLICANT", applicantName],
    ["CONTACT", [applicant.email, applicant.phone].filter(Boolean).join(" · ") || "—"],
    ["LOCATION", [applicant.zip_code, applicant.state].filter(Boolean).join(" · ") || "—"],
    ["SCREENER", screening.screener_name || "—"],
    ["CALL STARTED", fmtDateTime(screening.started_at)],
    ["SUBMITTED", fmtDateTime(screening.submitted_at)],
    ["CALL DURATION", duration ? `${duration} min` : "—"],
  ];
  const colW = CONTENT_W / 2;
  for (let i = 0; i < summaryPairs.length; i += 2) {
    ensure(30);
    const rowY = y;
    for (let c = 0; c < 2; c += 1) {
      const pair = summaryPairs[i + c];
      if (!pair) continue;
      const x = MARGIN_X + c * colW;
      page.drawText(pair[0], { x, y: rowY, size: 8, font: bold, color: gray });
      page.drawText(pair[1].slice(0, 60), { x, y: rowY - 12, size: 10, font, color: dark });
    }
    y -= 30;
  }

  ensure(30);
  page.drawText("RECOMMENDATION", { x: MARGIN_X, y, size: 8, font: bold, color: gray });
  page.drawText(rec.toUpperCase(), { x: MARGIN_X, y: y - 15, size: 14, font: bold, color: recColor });
  if (screening.recommendation === "decline") {
    page.drawText(`Reason: ${declineReasonLabel(screening.decline_reason)}`, {
      x: MARGIN_X + 130,
      y: y - 14,
      size: 10,
      font,
      color: dark,
    });
  } else if (screening.recommendation === "hold") {
    page.drawText(
      `Pending: ${(screening.hold_pending || "—").slice(0, 55)} · Follow up ${screening.hold_follow_up_date || "—"}`,
      { x: MARGIN_X + 130, y: y - 14, size: 10, font, color: dark },
    );
  }
  y -= 34;

  // ── Sections (from the same definitions as the live form) ──
  for (const section of SCREENING_SECTIONS) {
    sectionHeader(section.title);

    if (section.isConsents) {
      for (const item of CONSENT_ITEMS) {
        const c = screening.consents?.[item.key];
        const val = c?.value === "yes" ? "YES" : c?.value === "no" ? "NO" : "NOT CAPTURED";
        const color = c?.value === "yes" ? green : c?.value === "no" ? red : gray;
        ensure(30);
        page.drawText(val, { x: MARGIN_X, y, size: 10, font: bold, color });
        drawWrapped(item.label, { x: MARGIN_X + 46, size: 10, f: bold, gap: 0 });
        const meta = [
          c?.at ? `Recorded ${fmtDateTime(c.at)}` : null,
          c?.by_name ? `by ${c.by_name}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        if (meta) drawWrapped(meta, { x: MARGIN_X + 46, size: 8, color: gray, gap: 0 });
        if (c?.note) drawWrapped(`Note: ${c.note}`, { x: MARGIN_X + 46, size: 9, color: dark, gap: 0 });
        y -= 8;
      }
      const cState = consentsState(screening.consents || {});
      drawWrapped(
        cState.allYes
          ? "All consents recorded as YES."
          : `${cState.answered}/${cState.total} consents captured${cState.noItems.length > 0 ? ` — recorded NO: ${cState.noItems.map((n) => n.label).join("; ")}` : ""}.`,
        { size: 9, f: bold, color: cState.allYes ? green : amber, gap: 4 },
      );
      continue;
    }

    if (section.id === "scenarios") {
      const values = (screening.answers?.scenarios || {}) as Record<string, unknown>;
      for (const pair of SCENARIO_PAIRS) {
        const answer = values[pair.answerKey];
        const rating = values[pair.ratingKey];
        ensure(30);
        page.drawText(pair.label, { x: MARGIN_X, y, size: 9, font: bold, color: dark });
        page.drawText(typeof rating === "number" ? `Rated ${rating} / 5` : "Not rated", {
          x: PAGE_W - MARGIN_X - 70,
          y,
          size: 9,
          font: bold,
          color: typeof rating === "number" ? purple : gray,
        });
        y -= 13;
        drawWrapped(answer ? String(answer) : "—", { size: 10, gap: 8 });
      }
      const notes = values._notes;
      if (notes) qa("SECTION NOTES", String(notes));
      continue;
    }

    const values = (screening.answers?.[section.id] || {}) as Record<string, unknown>;
    for (const q of section.questions) {
      const text = answerText(q, values[q.key]);
      const color = q.kind === "gate" && values[q.key] === "fail" ? red : q.kind === "gate" && values[q.key] === "pending" ? amber : undefined;
      qa(q.label.toUpperCase(), text, color);
    }
    const notes = values._notes;
    if (notes) qa("SECTION NOTES", String(notes));
  }

  // ── Scorecard ──
  sectionHeader("Scorecard");
  for (const item of SCORECARD_ITEMS) {
    const v = screening.scorecard?.[item.key];
    ensure(16);
    page.drawText(item.label, { x: MARGIN_X, y, size: 10, font, color: dark });
    page.drawText(typeof v === "number" ? `${v} / 5` : "—", {
      x: MARGIN_X + 230,
      y,
      size: 10,
      font: bold,
      color: typeof v === "number" ? purple : gray,
    });
    y -= 15;
  }
  const hq = hardQualifierState(screening.answers || {});
  const cs = consentsState(screening.consents || {});
  ensure(34);
  page.drawText("Hard qualifiers", { x: MARGIN_X, y, size: 10, font, color: dark });
  page.drawText(
    hq.failed.length > 0 ? "FAIL" : hq.pending.length > 0 ? "PENDING" : hq.answered === hq.total ? "PASS" : "INCOMPLETE",
    { x: MARGIN_X + 230, y, size: 10, font: bold, color: hq.failed.length > 0 ? red : hq.pending.length > 0 ? amber : green },
  );
  y -= 15;
  page.drawText("Consents complete", { x: MARGIN_X, y, size: 10, font, color: dark });
  page.drawText(cs.allYes ? "YES" : "NO", {
    x: MARGIN_X + 230,
    y,
    size: 10,
    font: bold,
    color: cs.allYes ? green : red,
  });
  y -= 20;

  // ── Final outcome ──
  sectionHeader("Final Recommendation");
  drawWrapped(rec.toUpperCase(), { size: 14, f: bold, color: recColor, gap: 2 });
  if (screening.recommendation === "decline") {
    qa("STANDARDIZED REASON", declineReasonLabel(screening.decline_reason));
    if (screening.decline_notes) qa("NOTES", screening.decline_notes);
  }
  if (screening.recommendation === "hold") {
    qa("PENDING", screening.hold_pending || "—");
    qa("FOLLOW-UP DATE", screening.hold_follow_up_date || "—");
  }
  drawWrapped(
    "This record was generated automatically on submission of the live phone-screening form and is immutable. Corrections are made by running a new screening; all records are retained.",
    { size: 8, color: gray, gap: 0 },
  );

  // ── Footer on every page ──
  const pages = pdf.getPages();
  const generated = `Generated ${new Date().toUTCString()} — Novara Cleaning Talent Hub · Screening ${screening.id}`;
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN_X, y: 44 },
      end: { x: PAGE_W - MARGIN_X, y: 44 },
      thickness: 0.5,
      color: gray,
    });
    p.drawText(generated, { x: MARGIN_X, y: 32, size: 7, font, color: gray });
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE_W - MARGIN_X - 60,
      y: 32,
      size: 7,
      font,
      color: gray,
    });
  });

  return pdf.save();
}
