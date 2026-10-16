import { NextResponse } from "next/server";

import { AdminAuthError, requireUser } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { confirmPayoutCode, readContractorPayout, resendPayoutCode, resolveCleanerId, submitManualMethod } from "@/lib/payout-method-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function caller(req: Request) {
  const user = await requireUser(req);
  const cleanerId = await resolveCleanerId(getAdminSupabase(), user.userId, user.email);
  if (!cleanerId) throw new AdminAuthError("No contractor profile for this login.", 404);
  return { user, cleanerId };
}

export async function GET(req: Request) {
  try {
    const { cleanerId } = await caller(req);
    return NextResponse.json({ ok: true, ...(await readContractorPayout(getAdminSupabase(), cleanerId)) });
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message || "Could not load payout details." }, { status: error.status || 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user, cleanerId } = await caller(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "submit");
    const db = getAdminSupabase();
    if (action === "confirm_code") {
      const result = await confirmPayoutCode(db, cleanerId, String(body.code || ""));
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "resend_code") {
      const result = await resendPayoutCode(db, cleanerId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    const result = await submitManualMethod(db, cleanerId, {
      methodCode: String(body.methodCode || ""),
      identifier: String(body.identifier || ""),
      identifierAgain: String(body.identifierAgain || ""),
      accountName: String(body.accountName || ""),
      acknowledged: body.acknowledged === true,
      acknowledgmentText: String(body.acknowledgmentText || ""),
      actorId: user.userId,
      actorRole: "contractor",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message || "Could not save payout details." }, { status: error.status || 500 });
  }
}
