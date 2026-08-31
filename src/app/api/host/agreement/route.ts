// ─── GET /api/host/agreement ───────────────────────────────────────────────
//
// Streams the blank Host Partnership Agreement from DocuSeal through our
// origin so pdf.js can render every page on mobile.

import { streamAgreementPreview } from "@/lib/agreement-preview-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return streamAgreementPreview("str_host", "Novara-Host-Partnership-Agreement.pdf", req);
}
