// ─── POST /api/str/call ────────────────────────────────────────────────────
//
// Public Book a Call for unusual STR listings (large homes, many listings,
// or anything flagged non-standard). Captures the lead and returns the
// existing discovery-call calendar. Does not mint onboarding.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { bookCallStr } from "@/lib/host-landing/landing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await bookCallStr(getAdminSupabase(), body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[str/call]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not submit that request. Please try again." },
      { status: 500 },
    );
  }
}
