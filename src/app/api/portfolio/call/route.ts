// ─── POST /api/portfolio/call ──────────────────────────────────────────────
//
// Public Book a Call for unusual / non-standard portfolios. Lightweight
// discovery (same pattern as commercial intake): capture the lead, notify
// admin, optionally return a scheduling URL. Does not mint onboarding.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { bookCallPortfolio } from "@/lib/property-manager/landing-server";

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
    const result = await bookCallPortfolio(getAdminSupabase(), body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[portfolio/call]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not submit that request. Please try again." },
      { status: 500 },
    );
  }
}
