import { NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/partner-portal/magic-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  try {
    await requestMagicLink(String((body as { email?: string })?.email || ""));
  } catch {
    // Same response either way — never enumerate emails or fail the sign-in screen.
  }
  return NextResponse.json({
    ok: true,
    message: "If we have a partnership on this email, a sign-in link is on its way.",
  });
}
