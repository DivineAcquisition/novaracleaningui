// ─── POST /api/portfolio/start ─────────────────────────────────────────────
//
// Public Get Started for a *typical* portfolio. Creates the PM account,
// registers the units through the residential engine, mints the existing
// tokenized onboarding session, and returns the link. No admin step.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { startTypicalPortfolio } from "@/lib/property-manager/landing-server";

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
    const result = await startTypicalPortfolio(getAdminSupabase(), req, body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[portfolio/start]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not start onboarding. Please try again." },
      { status: 500 },
    );
  }
}
