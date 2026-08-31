import { NextResponse } from "next/server";
import { isLocalHost } from "@/lib/partner-portal/origins";
import { isPreviewQuery, previewMe } from "@/lib/partner-portal/preview";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  if (preview && isLocalHost(url.hostname)) {
    return NextResponse.json(previewMe(preview));
  }

  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, signedIn: false }, { status: 401 });
  const { identity } = session;
  return NextResponse.json({
    ok: true,
    signedIn: true,
    email: identity.email,
    displayName: identity.displayName,
    kinds: identity.kinds,
    hosts: identity.hosts.map((h) => ({ id: h.id, name: h.name, status: h.status, paymentOption: h.paymentOption })),
    accounts: identity.accounts.map((a) => ({
      id: a.id,
      businessName: a.businessName,
      status: a.status,
      billingMethod: a.billingMethod,
    })),
    expiresAt: session.expiresAt,
  });
}
