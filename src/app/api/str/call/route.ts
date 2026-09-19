// ─── POST /api/str/call ────────────────────────────────────────────────────
//
// Book a Call for property sets Part Two designates a quote (5+ BR), an
// unusually large property count, or anything the host flagged as
// non-standard. Creates the lead and returns the discovery calendar — it
// never mints an onboarding session, because the rates aren't set yet.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { bookStrCall } from "@/lib/str-landing/landing-server";

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
    const result = await bookStrCall(getAdminSupabase(), body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[str/call]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not book that call. Please try again." },
      { status: 500 },
    );
  }
}
