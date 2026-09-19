// ─── POST /api/str/estimate ────────────────────────────────────────────────
//
// Public. No login. Computes the per-turnover estimate from Host Partnership
// Agreement Part Two (base + linen + restock by bedroom band). Same function
// Claim uses. Never a second price list.

import { NextResponse } from "next/server";
import { estimateLandingStr, parseEstimateInput } from "@/lib/host-landing/landing-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const estimate = estimateLandingStr(parseEstimateInput(body));
  return NextResponse.json({ ...estimate, ok: true, priced: estimate.ok });
}
