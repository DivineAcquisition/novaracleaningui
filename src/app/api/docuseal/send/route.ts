// ─── POST /api/docuseal/send ──────────────────────────────────────────────────
//
// Admin/VA-gated: send a NovaraCleaning agreement for e-signature via DocuSeal.
// Body: { audience, email, name?, values?, role?, sendEmail?, bookingId?,
//         hostEmail?, cleanerId? }
// audience ∈ one_time | membership | str_host | commercial | contractor | va_contractor.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { sendAgreement, type AgreementAudience } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUDIENCES: AgreementAudience[] = [
  "one_time",
  "membership",
  "str_host",
  "commercial",
  "contractor",
  "va_contractor",
  "va_contractor_hourly",
];

export async function POST(req: Request): Promise<NextResponse> {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const audience = body?.audience as AgreementAudience;
  if (!AUDIENCES.includes(audience)) {
    return NextResponse.json(
      { error: `audience must be one of: ${AUDIENCES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body?.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  try {
    const result = await sendAgreement({
      audience,
      email: String(body.email).trim(),
      name: body.name ? String(body.name) : undefined,
      values: body.values && typeof body.values === "object" ? body.values : undefined,
      role: body.role ? String(body.role) : undefined,
      sendEmail: body.sendEmail !== false,
      bookingId: body.bookingId || undefined,
      hostEmail: body.hostEmail || undefined,
      cleanerId: body.cleanerId || undefined,
      createdBy: admin.email,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[docuseal/send]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
