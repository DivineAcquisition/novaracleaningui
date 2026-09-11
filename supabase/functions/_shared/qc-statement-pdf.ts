// Deno twin of src/lib/qc-statement-pdf.ts — same layout, pdf-lib from esm.sh.
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import type { QcStatementPdfInput } from "./qc-statement.ts";

export type { QcStatementPdfInput };

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

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

export async function buildQcStatementPdf(input: QcStatementPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const purple = rgb(0.361, 0.063, 0.996);
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.42, 0.45, 0.5);

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
    for (const rawLine of pdfSafe(text || "—").split("\n")) {
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
    return out.length ? out : ["—"];
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

  const kindLabel = String(input.kind || "original") === "supplemental"
    ? `Supplemental statement #${input.sequence}`
    : "Contractor statement";

  page.drawText("NOVARA CLEANING", { x: MARGIN_X, y, size: 20, font: bold, color: purple });
  y -= 22;
  page.drawText(kindLabel, { x: MARGIN_X, y, size: 13, font: bold, color: dark });
  y -= 16;
  page.drawText(
    pdfSafe(`QC #${input.issueNumber} · ${input.bookingRef} · submitted ${fmtWhen(input.submittedAt)}`),
    { x: MARGIN_X, y, size: 9, font, color: gray },
  );
  y -= 20;
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1.5, color: purple });
  y -= 20;

  sectionHeader("Job context");
  qa("Service date", input.serviceDate || "—");
  qa("General location", input.generalLocation || "—");
  qa("Service type", input.serviceType || "—");
  qa("Contractor", input.contractorName || "—");
  sectionHeader("What was reported");
  qa("Factual report on file", input.reportSummary || "—");
  qa(
    "Notice",
    "This statement is the contractor's opportunity to give their account in writing. It becomes part of the case record. No conclusion has been reached.",
  );
  sectionHeader("Contractor account");
  qa("Account of what happened", input.account);
  qa("Arrived", input.arrived || "—");
  qa("Started", input.started || "—");
  qa("Left", input.left || "—");
  qa("Notable in between", input.timelineNotes || "—");
  qa("Direct response to the report", input.reportResponse);
  qa("Anyone else present", input.othersPresent || "—");
  sectionHeader("Attestation");
  qa("Name", input.attestationName || "—");
  qa("Timestamp", fmtWhen(input.attestedAt));
  qa(
    "Confirmation",
    `${input.attestationName || "The contractor"} confirmed this statement is true and accurate to the best of their knowledge.`,
  );
  sectionHeader("Supporting documentation");
  if (!input.attachmentNames.length) qa("Uploads", "None attached.");
  else qa("Uploads", input.attachmentNames.map((n, i) => `${i + 1}. ${n}`).join("\n"));
  qa("Drive folder", input.driveFolderUrl || "Not yet mirrored to Drive.");

  const pages = pdf.getPages();
  const generated = `Generated ${new Date().toUTCString()} — Novara Cleaning · QC contractor statement · case #${input.issueNumber}`;
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN_X, y: 44 }, end: { x: PAGE_W - MARGIN_X, y: 44 }, thickness: 0.5, color: purple });
    p.drawText(pdfSafe(generated), { x: MARGIN_X, y: 30, size: 7, font, color: gray });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: PAGE_W - MARGIN_X - bold.widthOfTextAtSize(label, 7),
      y: 30,
      size: 7,
      font,
      color: gray,
    });
  });

  return pdf.save();
}
