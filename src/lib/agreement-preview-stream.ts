// Same-origin stream of a blank DocuSeal template PDF. pdf.js (and mobile
// browsers) cannot render DocuSeal's cross-origin file links, so onboarding
// pages fetch this proxy instead of the template URL directly.

import { NextResponse } from "next/server";
import { getAgreementPreviewUrl, type AgreementAudience } from "@/lib/docuseal";

export async function streamAgreementPreview(
  audience: AgreementAudience,
  filename: string,
  req: Request,
): Promise<NextResponse | Response> {
  try {
    const url = await getAgreementPreviewUrl(audience);
    if (!url) {
      return NextResponse.json({ error: "Agreement template is not configured." }, { status: 404 });
    }
    if (new URL(req.url).searchParams.get("debug") === "1") {
      return NextResponse.json({ docUrl: url }, { headers: { "Cache-Control": "no-store" } });
    }
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Could not load the agreement (${res.status}).` }, { status: 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
