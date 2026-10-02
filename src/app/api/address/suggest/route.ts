// ─── GET /api/address/suggest?q= ───────────────────────────────────────────
//
// Keyless address suggestions for every address field's dropdown. Used when
// Google Places returns nothing (key not authorized, referrer blocked, etc.).
// Public: the booking funnel needs it before anyone signs in.

import { NextResponse } from "next/server";
import { suggestAddresses } from "@/lib/address-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 200);
  if (q.length < 3) return NextResponse.json({ suggestions: [] });
  const suggestions = await suggestAddresses(q);
  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
