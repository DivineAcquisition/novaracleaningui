// Deno PDF entry for Form 1099-NEC Copy B and Copy C.
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { renderNec1099Pdf } from "./nec-1099-render.ts";
import type { Nec1099Form } from "./nec-1099.ts";

export function buildNec1099Pdf(form: Nec1099Form, copy: string): Promise<Uint8Array> {
  return renderNec1099Pdf({ PDFDocument, StandardFonts, rgb }, form, copy);
}
