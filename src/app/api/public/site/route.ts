import { NextResponse } from "next/server";
import { visitorSitePayload } from "@/lib/public-site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = [
  "https://novaracleaning.com",
  "https://www.novaracleaning.com",
  "https://try.novaracleaning.com",
  "https://framer.com",
];

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED.includes(origin) || origin.endsWith(".framer.app") || origin.endsWith(".framer.website");
  return {
    "Access-Control-Allow-Origin": allow ? origin : ALLOWED[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "public, max-age=300",
  };
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** Public facts for the marketing site and the booking site. No draft labels. */
export function GET(req: Request) {
  return NextResponse.json(visitorSitePayload(), { headers: corsHeaders(req) });
}
