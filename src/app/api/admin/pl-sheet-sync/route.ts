// ─── POST /api/admin/pl-sheet-sync ───────────────────────────────────────────
// Admin on-demand mirror of Supabase → branded P&L Google Sheet
// (Daily Log, Expenses & Reimb, Ad Spend, EOD).

import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ ok: false, error: e.message || "Unauthorized" }, { status: e.status || 401 });
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "Supabase env not configured." }, { status: 500 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/pl-sheet-sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "admin-pl-sheet-sync", ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      return NextResponse.json(
        { ok: false, error: json?.error || `Sheet sync failed (${res.status})`, ...json },
        { status: res.ok ? 200 : 502 },
      );
    }
    return NextResponse.json({ ok: true, ...json });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sheet sync failed" },
      { status: 500 },
    );
  }
}
