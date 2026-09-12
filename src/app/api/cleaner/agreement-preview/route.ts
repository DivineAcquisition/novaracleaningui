// ─── GET /api/cleaner/agreement-preview ───────────────────────────────────────
//
// Streams the blank Independent Contractor Agreement through our origin so
// pdf.js can render every page. Returning a DocuSeal file URL and putting it
// in an <iframe> looks like "the PDF is not loading" — DocuSeal does not set
// X-Frame-Options, but mobile Safari and several desktop PDF viewers still
// refuse to paint a cross-origin PDF inside a frame.
//
// Unauthenticated on purpose: PdfViewer fetches this URL without a JWT, and
// the blank template is not PII. Same pattern as /api/va/agreement and
// /api/commercial/agreement.

import { streamAgreementPreview } from "@/lib/agreement-preview-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return streamAgreementPreview(
    "contractor",
    "NovaraCleaning-Independent-Contractor-Agreement.pdf",
    req,
  );
}
