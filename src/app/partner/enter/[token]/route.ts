// ─── /partner/enter/[token] — the sign-in link from a partner's email ──────
//
// This is a Route Handler rather than a page on purpose. Opening the link has
// to write the portal session cookie, and Next only allows a cookie write from
// a Route Handler or Server Action — a Server Component render throws
// "Cookies can only be modified in a Server Action or Route Handler", which
// surfaced to partners as a 500 on every sign-in link.
//
// The URL is unchanged so links already sitting in inboxes keep working.

import { NextResponse } from "next/server";

import { consumeLoginToken } from "@/lib/partner-portal/handoff";
import { isLocalHost } from "@/lib/partner-portal/origins";
import { previewKindFromToken } from "@/lib/partner-portal/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { token: string } | Promise<{ token: string }> },
) {
  const { token } = await params;
  const host = request.headers.get("host") || "";

  const preview = previewKindFromToken(token);
  if (preview && isLocalHost(host)) {
    return NextResponse.redirect(new URL(`/partner?preview=${preview}`, request.url));
  }

  const result = await consumeLoginToken(token);
  if (!result.ok || !result.cookie) {
    const reason = encodeURIComponent(result.message || "invalid");
    return NextResponse.redirect(new URL(`/partner?link=${reason}`, request.url));
  }

  const response = NextResponse.redirect(new URL("/partner", request.url));
  response.cookies.set(result.cookie.name, result.cookie.value, result.cookie.options);
  return response;
}
