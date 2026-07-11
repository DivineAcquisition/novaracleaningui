// ─── GET /api/va/agreement ───────────────────────────────────────────────────
//
// Streams the blank VA Independent Contractor Agreement template PDF from
// DocuSeal through our own origin. The onboarding wizard renders it with
// pdf.js, which needs a same-origin (or CORS-enabled) URL — DocuSeal file
// links don't send CORS headers, and mobile browsers won't render
// cross-origin PDFs in an iframe at all. Proxying solves both.

import { NextResponse } from "next/server";
import { getAgreementPreviewUrl } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse | Response> {
  try {
    const url = await getAgreementPreviewUrl("va_contractor");
    if (!url) {
      return NextResponse.json({ error: "Agreement template is not configured." }, { status: 404 });
    }
    // Ops probe: confirm which template document the server resolves
    // without streaming the whole PDF.
    if (new URL(req.url).searchParams.get("debug") === "1") {
      return NextResponse.json(
        { docUrl: url },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Could not load the agreement (${res.status}).` }, { status: 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="Novara-VA-Independent-Contractor-Agreement.pdf"',
        // The blank template rarely changes — cache at the edge for an hour.
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
