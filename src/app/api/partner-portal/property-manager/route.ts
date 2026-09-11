import { NextResponse } from "next/server";
import { requestIsLocal } from "@/lib/partner-portal/origins";
import { isPreviewQuery, previewPropertyManagerOverview } from "@/lib/partner-portal/preview";
import {
  addPortalUnit,
  bookPortalTurnover,
  cancelPortalTurnover,
  propertyManagerOverview,
  reportPropertyManagerIssue,
  unitRegistryText,
  updatePortalUnitAccess,
} from "@/lib/partner-portal/property-manager";
import { resolvePortalSession } from "@/lib/partner-portal/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRY_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Content-Disposition": 'attachment; filename="unit-registry-and-standing-rates.txt"',
  "Cache-Control": "no-store",
};

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function str(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  return s ? s : undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const preview = isPreviewQuery(url.searchParams.get("preview"));
  const download = url.searchParams.get("download");

  if (download === "unit_registry") {
    if (preview && requestIsLocal(req)) {
      return new NextResponse(
        "UNIT REGISTRY & STANDING RATES\nKeystone Residential Management\n\n" +
          "— Adams St 2B\n  118 Adams St, Baltimore, MD\n  980 sqft · 2 bed · 1 bath\n" +
          "  Move-Out: $322\n  Move-In: $322\n  Standard (vacant refresh): $184\n",
        { headers: REGISTRY_HEADERS },
      );
    }
    const session = await resolvePortalSession();
    if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    if (!session.identity.kinds.includes("property_manager")) {
      return NextResponse.json(
        { ok: false, error: "No property management relationship on this account." },
        { status: 403 },
      );
    }
    const text = await unitRegistryText(session.identity);
    if (!text) return NextResponse.json({ ok: false, error: "No registry on file." }, { status: 404 });
    return new NextResponse(text, { headers: REGISTRY_HEADERS });
  }

  if (preview && requestIsLocal(req)) {
    return NextResponse.json(previewPropertyManagerOverview());
  }

  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("property_manager")) {
    return NextResponse.json(
      { ok: false, error: "No property management relationship on this account." },
      { status: 403 },
    );
  }
  return NextResponse.json(
    await propertyManagerOverview(session.identity, url.searchParams.get("unitId")),
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  if (isPreviewQuery(url.searchParams.get("preview")) && requestIsLocal(req)) {
    return NextResponse.json({ ok: true, preview: true, message: "Preview only — not saved." });
  }
  const session = await resolvePortalSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!session.identity.kinds.includes("property_manager")) {
    return NextResponse.json(
      { ok: false, error: "No property management relationship on this account." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "book_turnover") {
    return NextResponse.json(
      await bookPortalTurnover(session.identity, {
        unitId: String(body.unitId || ""),
        serviceType: String(body.serviceType || ""),
        neededByDate: String(body.neededByDate || ""),
        neededByTime: str(body.neededByTime),
        notes: str(body.notes),
      }),
    );
  }

  if (action === "cancel_turnover") {
    return NextResponse.json(
      await cancelPortalTurnover(session.identity, {
        turnoverId: String(body.turnoverId || ""),
        reason: str(body.reason),
      }),
    );
  }

  if (action === "add_unit") {
    return NextResponse.json(
      await addPortalUnit(session.identity, {
        unitLabel: str(body.unitLabel),
        address: String(body.address || ""),
        city: str(body.city),
        state: str(body.state),
        zipCode: str(body.zipCode),
        sqft: num(body.sqft),
        bedrooms: num(body.bedrooms),
        bathrooms: num(body.bathrooms),
        accessMethod: str(body.accessMethod),
        accessCode: str(body.accessCode),
        accessNotes: str(body.accessNotes),
        parkingNotes: str(body.parkingNotes),
        notes: str(body.notes),
        flagNonStandard: body.flagNonStandard === true,
      }),
    );
  }

  if (action === "update_unit_access") {
    return NextResponse.json(
      await updatePortalUnitAccess(session.identity, {
        unitId: String(body.unitId || ""),
        accessMethod: str(body.accessMethod),
        accessCode: str(body.accessCode),
        accessNotes: str(body.accessNotes),
        parkingNotes: str(body.parkingNotes),
      }),
    );
  }

  if (action === "report_issue") {
    return NextResponse.json(
      await reportPropertyManagerIssue(session.identity, {
        title: String(body.title || ""),
        description: String(body.description || ""),
        unitId: str(body.unitId),
        turnoverId: str(body.turnoverId),
      }),
    );
  }

  return NextResponse.json({ ok: false, error: `Unknown action "${action}".` }, { status: 400 });
}
