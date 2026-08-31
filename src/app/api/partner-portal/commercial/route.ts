import { NextResponse } from "next/server";
import {
  commercialExhibitAText,
  commercialOverview,
  reportCommercialIssue,
  requestAdditionalService,
  requestAdditionalSite,
  requestScheduleChange,
  uploadCommercialDocument,
} from "@/lib/partner-portal/commercial";
import { portalCallbackUrl, requestIsLocal } from "@/lib/partner-portal/origins";
import { openCommercialPaymentSetup, refreshCommercialPaymentMethod } from "@/lib/partner-portal/payment-method";
import { isPreviewQuery, previewCommercialOverview } from "@/lib/partner-portal/preview";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  const invoiced = url.searchParams.get("billing") === "invoiced";
  if (url.searchParams.get("download") === "exhibit_a") {
    if (preview && requestIsLocal(req)) {
      return new NextResponse("EXHIBIT A — Harbor East office — $185.00 per visit\nCanton suite — $100.00 per visit\n", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": 'attachment; filename="exhibit-a-schedule-of-sites.txt"',
        },
      });
    }
    const session = await resolvePortalSession();
    if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (!session.identity.kinds.includes("commercial")) {
      return NextResponse.json({ ok: false, error: "No commercial relationship on this account." }, { status: 403 });
    }
    const text = await commercialExhibitAText(session.identity);
    if (!text) return NextResponse.json({ ok: false, error: "No Exhibit A on file." }, { status: 404 });
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="exhibit-a-schedule-of-sites.txt"',
        "Cache-Control": "no-store",
      },
    });
  }
  if (preview && requestIsLocal(req)) {
    return NextResponse.json(previewCommercialOverview(invoiced ? "invoiced" : "auto_pay"));
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
  if (isPreviewQuery(url.searchParams.get("preview")) && requestIsLocal(req)) {
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
  if (action === "update_payment_method") {
    return NextResponse.json(
      await openCommercialPaymentSetup(
        session.identity,
        portalCallbackUrl(req, "payment=updated&kind=commercial&session_id={CHECKOUT_SESSION_ID}"),
      ),
    );
  }
  if (action === "refresh_payment") {
    return NextResponse.json(
      await refreshCommercialPaymentMethod(session.identity, body.sessionId ? String(body.sessionId) : undefined),
    );
  }
  if (action === "upload_document") {
    return NextResponse.json(
      await uploadCommercialDocument(session.identity, {
        documentName: String(body.documentName || ""),
        documentType: body.documentType ? String(body.documentType) : undefined,
        documentBase64: String(body.documentBase64 || ""),
        note: body.note ? String(body.note) : body.message ? String(body.message) : undefined,
      }),
    );
  }
  return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
}
