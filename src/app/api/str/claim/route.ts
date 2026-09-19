// ─── POST /api/str/claim ───────────────────────────────────────────────────
//
// Public Claim This Rate for a *typical* STR property set. Captures name,
// email, phone, and the individual-vs-entity answer. Locks the band rates
// for the standard quote-lock window, registers the properties at those
// rates, mints the existing tokenized host onboarding session, continues
// in-browser, and sends the same link by SMS and email. No admin step.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { claimStrRate } from "@/lib/str-landing/landing-server";

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
    const result = await claimStrRate(getAdminSupabase(), req, body);
    return NextResponse.json(result, { status: result.status });
  } catch (err) {
    console.error("[str/claim]", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: "Could not claim that rate. Please try again." },
      { status: 500 },
    );
  }
}
