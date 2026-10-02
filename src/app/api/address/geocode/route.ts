// ─── GET /api/address/geocode?q= ───────────────────────────────────────────
//
// Resolve a full one-line address to street / city / state / ZIP and a point.
// US Census geocoder first, then the best keyless street match. Used when a
// suggestion is picked and when someone types an address without picking.

import { NextResponse } from "next/server";
import { geocodeAddressLine } from "@/lib/address-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 300);
  if (q.length < 3) return NextResponse.json({ match: null });
  const match = await geocodeAddressLine(q);
  return NextResponse.json(
    { match },
    { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
  );
}
