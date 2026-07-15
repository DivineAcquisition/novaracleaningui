// ─── POST /api/memberships/send-agreement ─────────────────────────────────────
//
// Admin/VA: email the Recurring Service & Membership Agreement (DocuSeal)
// for a Glow / recurring signup. Optionally attach a held Stripe payment
// URL in metadata — when the customer finishes signing, the DocuSeal
// webhook releases that pay link by email/SMS (agree → then pay).

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { buildMembershipValues, sendAgreement } from "@/lib/docuseal";

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

  const name = body.name ? String(body.name).trim() : undefined;
  const phone = body.phone ? String(body.phone).trim() : undefined;
  const plan = body.plan ? String(body.plan) : undefined;
  const serviceAddress = body.serviceAddress ? String(body.serviceAddress) : undefined;
  const firstServiceDate = body.firstServiceDate ? String(body.firstServiceDate) : undefined;
  const membershipRateCents =
    body.membershipRateCents != null ? Math.round(Number(body.membershipRateCents)) : undefined;
  const oneTimeRateCents =
    body.oneTimeRateCents != null ? Math.round(Number(body.oneTimeRateCents)) : undefined;
  const initialDeepClean =
    body.initialDeepClean != null ? String(body.initialDeepClean) : undefined;
  const paymentUrl = body.paymentUrl ? String(body.paymentUrl).trim() : undefined;
  const holdPayment = body.holdPayment !== false && Boolean(paymentUrl);
  const sendEmail = body.sendEmail !== false;

  try {
    const values = buildMembershipValues({
      name,
      email,
      serviceAddress,
      plan,
      membershipRateCents:
        membershipRateCents != null && Number.isFinite(membershipRateCents)
          ? membershipRateCents
          : undefined,
      oneTimeRateCents:
        oneTimeRateCents != null && Number.isFinite(oneTimeRateCents)
          ? oneTimeRateCents
          : undefined,
      firstServiceDate,
      initialDeepClean,
    });

    const result = await sendAgreement({
      audience: "membership",
      email,
      name,
      values,
      sendEmail,
      createdBy: admin.email,
      metadata: {
        kind: "membership_agree_then_pay",
        hold_payment: holdPayment,
        payment_url: paymentUrl || null,
        phone: phone || null,
        plan: plan || null,
        name: name || null,
        first_name: name ? name.split(/\s+/)[0] : null,
        membership_rate_cents: membershipRateCents ?? null,
        first_service_date: firstServiceDate || null,
        home_size_id: body.homeSizeId ? String(body.homeSizeId) : null,
        schedule_id: body.scheduleId ? String(body.scheduleId) : null,
      },
    });

    return NextResponse.json({
      ...result,
      holdPayment,
      paymentUrl: holdPayment ? paymentUrl : null,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[memberships/send-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
