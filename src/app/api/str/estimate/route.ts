// ─── POST /api/str/estimate ────────────────────────────────────────────────
//
// Instant quote for the STR landing page. Pricing never happens in the
// browser: every rate here comes from the Part Two reference bands, and the
// typical/unusual CTA split comes back with it.

import { NextResponse } from "next/server";
import { parseStrProperties } from "@/lib/str-landing/landing";
import { strEstimate } from "@/lib/str-landing/landing-server";

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
    const estimate = strEstimate(parseStrProperties(body.properties));
    return NextResponse.json(estimate, { status: 200 });
  } catch (err) {
    console.error("[str/estimate]", (err as Error).message);
    return NextResponse.json({ ok: false, error: "Could not build that estimate." }, { status: 500 });
  }
}
