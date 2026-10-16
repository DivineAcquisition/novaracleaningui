import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin, requireUser } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { paymentSummaryFor, resolveCleanerId } from "@/lib/payout-method-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const db = getAdminSupabase();
  const { id: lineId } = await context.params;
  try {
    try {
      await requireAdmin(req);
      const summary = await paymentSummaryFor(db, lineId, null);
      if (!summary) return NextResponse.json({ error: "Payment summary not found." }, { status: 404 });
      return NextResponse.json({ ok: true, summary });
    } catch {
      const user = await requireUser(req);
      const cleanerId = await resolveCleanerId(db, user.userId, user.email);
      if (!cleanerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
      const summary = await paymentSummaryFor(db, lineId, cleanerId);
      if (!summary) return NextResponse.json({ error: "Payment summary not found." }, { status: 404 });
      return NextResponse.json({ ok: true, summary });
    }
  } catch (err) {
    const error = err as AdminAuthError;
    return NextResponse.json({ error: error.message || "Could not open the payment summary." }, { status: error.status || 500 });
  }
}
