// ─── POST /api/portfolio/estimate ──────────────────────────────────────────
//
// Public. No login. Runs the live residential standing-rate engine over the
// units typed on try.novaracleaning.com/portfolio and returns an estimated
// range plus the typical/unusual CTA. Never a second price list.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { estimateLandingPortfolio, parseEstimateInput } from "@/lib/property-manager/landing-server";

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
    const estimate = await estimateLandingPortfolio(getAdminSupabase(), parseEstimateInput(body));
    return NextResponse.json({ ...estimate, ok: true, priced: estimate.ok });
  } catch (err) {
    console.error("[portfolio/estimate]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not compute that estimate. Please try again." },
      { status: 500 },
    );
  }
}
