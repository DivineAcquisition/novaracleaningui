// ─── POST /api/memberships/ensure-agreement ───────────────────────────────────
//
// Sends the Recurring Service & Membership Agreement at most once per email.
// Used by:
//   • Stripe customer.subscription.created (purchase)
//   • customer-recurring-generate (first/next visit safety net)
//   • /api/bookings/send-agreement when the booking is a membership visit
//   • secret-gated { backfillActive: true } for active recurring accounts
//
// Auth: BOOKING_AGREEMENT_SECRET (query or x-booking-secret) or admin/VA JWT.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { hasBookingAgreementSecret } from "@/lib/booking-agreement-secret";
import {
  backfillActiveMembershipAgreements,
  ensureMembershipAgreement,
} from "@/lib/ensure-membership-agreement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const secretOk = await hasBookingAgreementSecret(req);
  let createdBy = "auto:membership-ensure";
  if (!secretOk) {
    try {
      const admin = await requireAdmin(req);
      createdBy = admin.email;
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ error: e.message }, { status: e.status || 401 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    if (body.backfillActive === true) {
      if (!secretOk) {
        return NextResponse.json({ error: "backfill requires the booking agreement secret" }, { status: 403 });
      }
      const results = await backfillActiveMembershipAgreements("auto:membership-backfill");
      return NextResponse.json({
        ok: true,
        backfill: true,
        considered: results.length,
        sent: results.filter((r) => !r.result.alreadySent && !r.result.skipped).length,
        alreadySent: results.filter((r) => r.result.alreadySent).length,
        results: results.map((r) => ({
          email: r.email,
          scheduleId: r.scheduleId,
          alreadySent: r.result.alreadySent || false,
          skipped: r.result.skipped || null,
        })),
      });
    }

    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    const membershipRateCents =
      body.membershipRateCents != null ? Math.round(Number(body.membershipRateCents)) : undefined;
    const oneTimeRateCents =
      body.oneTimeRateCents != null ? Math.round(Number(body.oneTimeRateCents)) : undefined;

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
      paymentUrl: body.paymentUrl ? String(body.paymentUrl).trim() : undefined,
      holdPayment: body.holdPayment !== false,
      sendEmail: body.sendEmail !== false,
      createdBy,
    });

    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[memberships/ensure-agreement]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
