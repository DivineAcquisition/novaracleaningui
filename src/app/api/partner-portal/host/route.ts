import { NextResponse } from "next/server";
import {
  cancelTurnover,
  finalizeTurnoverCheckout,
  hostOverview,
  hostRateSchedulePdf,
  previewCancelFee,
  reportHostIssue,
  requestAdditionalProperty,
  requestTurnover,
  rescheduleTurnover,
} from "@/lib/partner-portal/host";
import { portalCallbackUrl, requestIsLocal } from "@/lib/partner-portal/origins";
import { openHostPaymentSetup, refreshHostPaymentMethod } from "@/lib/partner-portal/payment-method";
import { isPreviewQuery, previewHostOverview } from "@/lib/partner-portal/preview";
import { buildRateSchedulePdf } from "@/lib/partner-portal/rate-schedule-pdf";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  if (url.searchParams.get("download") === "rate_schedule") {
    if (preview && requestIsLocal(req)) {
      const bytes = await buildRateSchedulePdf({
        hostName: "Jordan Hale",
        properties: previewHostOverview().properties,
      });
      return pdfResponse(bytes);
    }
    const session = await resolvePortalSession();
    if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (!session.identity.kinds.includes("host")) {
      return NextResponse.json({ ok: false, error: "No host relationship on this account." }, { status: 403 });
    }
    return pdfResponse(await hostRateSchedulePdf(session.identity));
  }
  if (preview && requestIsLocal(req)) {
    return NextResponse.json(previewHostOverview());
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("host")) {
    return NextResponse.json({ ok: false, error: "No host relationship on this account." }, { status: 403 });
  }
  return NextResponse.json(await hostOverview(session.identity));
}

function pdfResponse(bytes: Uint8Array): NextResponse {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="property-rate-schedule.pdf"',
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (isPreviewQuery(url.searchParams.get("preview")) && requestIsLocal(req)) {
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
        successUrl: portalCallbackUrl(req, "turnover=paid&kind=host&session_id={CHECKOUT_SESSION_ID}"),
        cancelUrl: portalCallbackUrl(req, "kind=host"),
      }),
    );
  }
  if (action === "update_payment_method") {
    return NextResponse.json(
      await openHostPaymentSetup(
        session.identity,
        portalCallbackUrl(req, "payment=updated&kind=host&session_id={CHECKOUT_SESSION_ID}"),
      ),
    );
  }
  if (action === "refresh_payment") {
    return NextResponse.json(
      await refreshHostPaymentMethod(session.identity, body.sessionId ? String(body.sessionId) : undefined),
    );
  }
  if (action === "finalize_turnover") {
    return NextResponse.json(await finalizeTurnoverCheckout(session.identity, String(body.sessionId || "")));
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
