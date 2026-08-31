import { NextResponse } from "next/server";
import {
  commercialOverview,
  reportCommercialIssue,
  requestAdditionalService,
  requestAdditionalSite,
  requestScheduleChange,
} from "@/lib/partner-portal/commercial";
import { isLocalHost } from "@/lib/partner-portal/origins";
import { isPreviewQuery, previewCommercialOverview } from "@/lib/partner-portal/preview";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  if (preview && isLocalHost(url.hostname)) {
    return NextResponse.json(previewCommercialOverview());
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("commercial")) {
    return NextResponse.json({ ok: false, error: "No commercial relationship on this account." }, { status: 403 });
  }
  return NextResponse.json(await commercialOverview(session.identity, url.searchParams.get("siteId")));
}

export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (isPreviewQuery(url.searchParams.get("preview")) && isLocalHost(url.hostname)) {
    return NextResponse.json({ ok: true, preview: true, message: "Preview only — not saved." });
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("commercial")) {
    return NextResponse.json({ ok: false, error: "No commercial relationship on this account." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "request_additional_site") {
    return NextResponse.json(
      await requestAdditionalSite(session.identity, {
        nickname: body.nickname ? String(body.nickname) : undefined,
        address: body.address ? String(body.address) : undefined,
        message: body.message ? String(body.message) : undefined,
      }),
    );
  }
  if (action === "request_additional_service") {
    return NextResponse.json(
      await requestAdditionalService(session.identity, {
        siteId: body.siteId ? String(body.siteId) : undefined,
        message: String(body.message || ""),
      }),
    );
  }
  if (action === "request_schedule_change") {
    return NextResponse.json(
      await requestScheduleChange(session.identity, {
        siteId: body.siteId ? String(body.siteId) : undefined,
        message: String(body.message || ""),
      }),
    );
  }
  if (action === "report_issue") {
    return NextResponse.json(
      await reportCommercialIssue(session.identity, {
        title: String(body.title || ""),
        description: String(body.description || ""),
        siteId: body.siteId ? String(body.siteId) : undefined,
        bookingId: body.bookingId ? String(body.bookingId) : undefined,
      }),
    );
  }
  return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
}
