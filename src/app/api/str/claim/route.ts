// ─── POST /api/str/claim ───────────────────────────────────────────────────
//
// Public Claim This Rate for a *typical* STR listing. Captures name, email,
// phone, and whether the Host is signing as an individual or a business
// entity (Agreement §6.10 personal-guarantee branch). Prices properties from
// the Host rate table, locks the quote for 48 hours, mints the existing
// tokenized host onboarding session, continues in-browser, and sends the
// same link by SMS/email. No admin step.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { claimTypicalHost } from "@/lib/host-landing/landing-server";

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
    const result = await claimTypicalHost(getAdminSupabase(), req, body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[str/claim]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not claim that rate. Please try again." },
      { status: 500 },
    );
  }
}
