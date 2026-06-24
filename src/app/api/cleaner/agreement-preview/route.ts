// ─── GET /api/cleaner/agreement-preview ───────────────────────────────────────
//
// Returns the contractor agreement PDF URL so the contractor can preview the
// document in-app before signing. Authenticated (any signed-in user).

import { NextResponse } from "next/server";
import { requireUser, AdminAuthError } from "@/lib/admin-auth";
import { getAgreementPreviewUrl } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireUser(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }
  try {
    const url = await getAgreementPreviewUrl("contractor");
    if (!url) return NextResponse.json({ error: "Preview unavailable" }, { status: 404 });
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
