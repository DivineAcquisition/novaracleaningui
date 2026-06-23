// ─── GET /api/partner-admin/hosts ────────────────────────────────────────────
//
// Powers the STR partner-admin landing view (spec §3) and the "Needs Attention"
// dashboard (spec §6) in one round-trip. Admin/VA gated server-side; the Airtable
// PAT never leaves the server. Snapshot is cached 5 min (spec §7); pass ?refresh=1
// to force a fresh read after a write.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getDashboard, listHosts } from "@/lib/airtable/partner-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  try {
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    const [hosts, dashboard] = await Promise.all([listHosts(force), getDashboard(false)]);
    return NextResponse.json({ ok: true, hosts, dashboard });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[partner-admin/hosts]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
