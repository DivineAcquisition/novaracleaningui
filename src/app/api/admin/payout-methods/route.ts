import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  draftStripeOptionsNotice,
  getPayoutSettings,
  listContractorPayoutAdmin,
  monthlyPayoutReport,
  payoutAdminReport,
  classifyUnclassifiedPayouts,
  recordOverpayment,
  sendDueReminders,
  setPayoutHold,
  stripeOptionsOutreach,
  updatePayoutSettings,
} from "@/lib/payout-method-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(err: unknown) {
  const error = err as AdminAuthError;
  return NextResponse.json({ error: error.message || "Something went wrong." }, { status: error.status || 500 });
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (err) {
    return failure(err);
  }
  const db = getAdminSupabase();
  const url = new URL(req.url);
  const cleanerId = url.searchParams.get("cleanerId");
  const report = url.searchParams.get("report");
  try {
    if (cleanerId) return NextResponse.json({ ok: true, ...(await listContractorPayoutAdmin(db, cleanerId)) });
    if (report === "monthly") {
      const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      return NextResponse.json({ ok: true, ...(await monthlyPayoutReport(db, month)) });
    }
    return NextResponse.json({ ok: true, ...(await payoutAdminReport(db)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load payout methods." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    return failure(err);
  }
  const db = getAdminSupabase();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "classify_unclassified") {
      const include = body.include;
      if (include !== true && include !== false) {
        return NextResponse.json({ error: "Choose whether these payouts count toward Novara's 1099." }, { status: 400 });
      }
      const result = await classifyUnclassifiedPayouts(db, String(body.methodCode || ""), include, principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "save_settings") {
      const settings = await updatePayoutSettings(db, {
        ...(body.settings || {}),
        acknowledgmentText: body.acknowledgmentText,
      });
      return NextResponse.json({ ok: true, settings });
    }
    if (action === "overpayment") {
      const result = await recordOverpayment(db, {
        cleanerId: String(body.cleanerId || ""),
        amountCents: Number(body.amountCents),
        reason: String(body.reason || ""),
        actorId: principal.userId,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "hold") {
      const result = await setPayoutHold(db, String(body.cleanerId || ""), Boolean(body.hold), principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "draft_options_notice") {
      return NextResponse.json({ ok: true, ...(await draftStripeOptionsNotice(db, String(body.cleanerId || ""))) });
    }
    if (action === "send_options_notice") {
      const result = await stripeOptionsOutreach(db, {
        cleanerId: String(body.cleanerId || ""),
        actorId: principal.userId,
        approved: body.approved === true,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "send_reminders") {
      return NextResponse.json(await sendDueReminders(db));
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update payout methods." }, { status: 500 });
  }
}
