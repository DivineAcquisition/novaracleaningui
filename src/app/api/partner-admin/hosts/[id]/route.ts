// ─── GET /api/partner-admin/hosts/[id] ───────────────────────────────────────
//
// Full host account page (spec §4): summary, properties (with rates + status),
// turnover history, computed revenue snapshot, and notes. Admin/VA gated.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getHostDetail } from "@/lib/airtable/partner-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  try {
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    const host = await getHostDetail(params.id, force);
    if (!host) return NextResponse.json({ error: "Host not found." }, { status: 404 });
    return NextResponse.json({ ok: true, host });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[partner-admin/hosts/:id]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
