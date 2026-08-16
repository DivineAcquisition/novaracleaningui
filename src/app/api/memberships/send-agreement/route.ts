// ─── POST /api/memberships/send-agreement ─────────────────────────────────────
//
// Admin/VA: email the Recurring Service & Membership Agreement (DocuSeal)
// for a Glow / recurring signup. Optionally attach a held Stripe payment
// URL in metadata — when the customer finishes signing, the DocuSeal
// webhook releases that pay link by email/SMS (agree → then pay).
// Idempotent per email: a second click returns alreadySent instead of
// mailing another copy.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { ensureMembershipAgreement } from "@/lib/ensure-membership-agreement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const membershipRateCents =
    body.membershipRateCents != null ? Math.round(Number(body.membershipRateCents)) : undefined;
  const oneTimeRateCents =
    body.oneTimeRateCents != null ? Math.round(Number(body.oneTimeRateCents)) : undefined;
  const paymentUrl = body.paymentUrl ? String(body.paymentUrl).trim() : undefined;

  try {
    const result = await ensureMembershipAgreement({
      email,
      name: body.name ? String(body.name).trim() : undefined,
      phone: body.phone ? String(body.phone).trim() : undefined,
      plan: body.plan ? String(body.plan) : undefined,
      serviceAddress: body.serviceAddress ? String(body.serviceAddress) : undefined,
      firstServiceDate: body.firstServiceDate ? String(body.firstServiceDate) : undefined,
      membershipRateCents:
        membershipRateCents != null && Number.isFinite(membershipRateCents) ? membershipRateCents : undefined,
      oneTimeRateCents:
        oneTimeRateCents != null && Number.isFinite(oneTimeRateCents) ? oneTimeRateCents : undefined,
      initialDeepClean: body.initialDeepClean != null ? String(body.initialDeepClean) : undefined,
      homeSizeId: body.homeSizeId ? String(body.homeSizeId) : undefined,
      scheduleId: body.scheduleId ? String(body.scheduleId) : undefined,
      paymentUrl,
      holdPayment: body.holdPayment !== false && Boolean(paymentUrl),
      sendEmail: body.sendEmail !== false,
      createdBy: admin.email,
    });

    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[memberships/send-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
