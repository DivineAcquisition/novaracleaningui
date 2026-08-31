// ─── GET /api/commercial/agreement ─────────────────────────────────────────
//
// Streams the blank Commercial Cleaning Services Agreement from DocuSeal
// through our origin so pdf.js can render every page on mobile.

import { streamAgreementPreview } from "@/lib/agreement-preview-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return streamAgreementPreview(
    "commercial",
    "Novara-Commercial-Cleaning-Services-Agreement.pdf",
    req,
  );
}
