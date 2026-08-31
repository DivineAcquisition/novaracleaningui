import { NextResponse } from "next/server";
import {
  cancelTurnover,
  hostOverview,
  previewCancelFee,
  reportHostIssue,
  requestAdditionalProperty,
  requestTurnover,
  rescheduleTurnover,
} from "@/lib/partner-portal/host";
import { isLocalHost } from "@/lib/partner-portal/origins";
import { isPreviewQuery, previewHostOverview } from "@/lib/partner-portal/preview";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  if (preview && isLocalHost(url.hostname)) {
    return NextResponse.json(previewHostOverview());
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("host")) {
    return NextResponse.json({ ok: false, error: "No host relationship on this account." }, { status: 403 });
  }
  return NextResponse.json(await hostOverview(session.identity));
}

export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (isPreviewQuery(url.searchParams.get("preview")) && isLocalHost(url.hostname)) {
    return NextResponse.json({ ok: true, preview: true, message: "Preview only — not saved." });
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("host")) {
    return NextResponse.json({ ok: false, error: "No host relationship on this account." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "preview_cancel") {
    return NextResponse.json(await previewCancelFee(session.identity, String(body.turnoverId || "")));
  }
  if (action === "cancel") {
    return NextResponse.json(await cancelTurnover(session.identity, String(body.turnoverId || "")));
  }
  if (action === "reschedule") {
    return NextResponse.json(
      await rescheduleTurnover(session.identity, {
        turnoverId: String(body.turnoverId || ""),
        requestedDate: String(body.requestedDate || ""),
        windowStart: body.windowStart ? String(body.windowStart) : undefined,
        windowEnd: body.windowEnd ? String(body.windowEnd) : undefined,
      }),
    );
  }
  if (action === "request_turnover") {
    return NextResponse.json(
      await requestTurnover(session.identity, {
        propertyId: String(body.propertyId || ""),
        requestedDate: String(body.requestedDate || ""),
        windowStart: body.windowStart ? String(body.windowStart) : undefined,
        windowEnd: body.windowEnd ? String(body.windowEnd) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
        paymentOption: body.paymentOption ? String(body.paymentOption) : undefined,
      }),
    );
  }
  if (action === "request_additional_property") {
    return NextResponse.json(
      await requestAdditionalProperty(session.identity, {
        nickname: body.nickname ? String(body.nickname) : undefined,
        address: String(body.address || ""),
        bedrooms: body.bedrooms != null ? Number(body.bedrooms) : undefined,
        bathrooms: body.bathrooms != null ? Number(body.bathrooms) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      }),
    );
  }
  if (action === "report_issue") {
    return NextResponse.json(
      await reportHostIssue(session.identity, {
        title: String(body.title || ""),
        description: String(body.description || ""),
        turnoverId: body.turnoverId ? String(body.turnoverId) : undefined,
        propertyId: body.propertyId ? String(body.propertyId) : undefined,
      }),
    );
  }
  return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
}
