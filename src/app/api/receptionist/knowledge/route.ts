import { NextResponse } from "next/server";
import { RECEPTIONIST_KNOWLEDGE } from "@/lib/receptionist-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(RECEPTIONIST_KNOWLEDGE, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
