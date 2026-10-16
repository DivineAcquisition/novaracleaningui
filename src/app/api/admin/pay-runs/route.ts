import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  closePayRun,
  failPayRunLine,
  markPayRunLinePaid,
  refreshPayRun,
  releasePayRunHold,
  reopenPayRunLine,
} from "@/lib/payout-method-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(err: unknown) {
  const error = err as AdminAuthError;
  return NextResponse.json({ error: error.message || "Something went wrong." }, { status: error.status || 500 });
}

export async function GET(req: Request) {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    return failure(err);
  }
  try {
    const run = await refreshPayRun(getAdminSupabase(), principal.userId);
    return NextResponse.json({ ok: true, ...run });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not build the pay run." }, { status: 500 });
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
    if (action === "create") {
      const run = await refreshPayRun(db, principal.userId, { offCycle: true });
      return NextResponse.json({ ok: true, ...run });
    }
    if (action === "mark_paid") {
      const ids = Array.isArray(body.lineIds) ? body.lineIds.map(String) : [String(body.lineId || "")];
      const results = [];
      for (const lineId of ids.filter(Boolean)) {
        results.push({
          lineId,
          ...(await markPayRunLinePaid(db, lineId, principal.userId, {
            amountSentCents: body.amountSentCents != null ? Number(body.amountSentCents) : undefined,
            recipientName: body.recipientName ? String(body.recipientName) : null,
            mismatchNote: body.mismatchNote ? String(body.mismatchNote) : null,
            differenceReason: body.differenceReason ? String(body.differenceReason) : null,
            confirmationRef: body.confirmationRef ? String(body.confirmationRef) : null,
            screenshotPath: body.screenshotPath ? String(body.screenshotPath) : null,
            holdReleased: body.holdReleased === true,
          })),
        });
      }
      return NextResponse.json({ ok: results.every((row) => row.ok), results });
    }
    if (action === "fail") {
      const result = await failPayRunLine(db, String(body.lineId || ""), String(body.reason || ""), principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "reopen") {
      const result = await reopenPayRunLine(db, String(body.lineId || ""), String(body.reason || ""), principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "release_hold") {
      const result = await releasePayRunHold(db, String(body.lineId || ""), principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "close") {
      const result = await closePayRun(db, String(body.runId || ""), principal.userId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not update the pay run." }, { status: 500 });
  }
}
