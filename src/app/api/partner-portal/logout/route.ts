import { NextResponse } from "next/server";
import { revokePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  await revokePortalSession();
  return NextResponse.json({ ok: true });
}
