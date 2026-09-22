// Deno PDF entry. Layout lives in qc-factual-summary-render.ts.
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { renderFactualSummaryPdf } from "./qc-factual-summary-render.ts";
import type { FactualSummary } from "./qc-factual-summary.ts";

export function buildFactualSummaryPdf(summary: FactualSummary): Promise<Uint8Array> {
  return renderFactualSummaryPdf({ PDFDocument, StandardFonts, rgb }, summary);
}
