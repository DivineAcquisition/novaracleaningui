// ─── POST /api/portfolio/claim ─────────────────────────────────────────────
//
// Public Claim This Rate for a *typical* set of units. Captures name, email,
// and phone only. Locks standing rates for the standard quote-lock window,
// registers units through the residential engine, mints the existing
// tokenized onboarding session, continues in-browser, and sends the same
// link by SMS/email. No admin step.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { claimTypicalPortfolio } from "@/lib/property-manager/landing-server";

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
    const result = await claimTypicalPortfolio(getAdminSupabase(), req, body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[portfolio/claim]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not claim that rate. Please try again." },
      { status: 500 },
    );
  }
}
