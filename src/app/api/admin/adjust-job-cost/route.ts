// ─── POST /api/admin/adjust-job-cost ───────────────────────────────────────
//
// Adjust the recorded job cost (revenue) on a booking — used when a job had to
// be partially refunded or re-priced. Optionally issues a Stripe refund for the
// difference. Propagates the new number everywhere:
//   • bookings.final_charge_cents (authoritative revenue) — this also fires the
//     notify_ghl_sync + notify_airtable_revops triggers automatically.
//   • Airtable Jobs (customer paid) — synced directly here for immediacy.
//   • GHL opportunity (monetaryValue) — re-synced directly here for immediacy.
//   • manual_payouts (revenue/profit/%) so Payroll reflects the new cost.
//
// Admin/VA gated. All money is integer cents.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncJobByBookingId, DEFAULT_LIVE_ENTRY_SOURCE } from "@/lib/airtable/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bookingId = String(body.bookingId || "");
  const newJobCostCents = Math.round(Number(body.newJobCostCents));
  const refundCents = body.refundCents != null ? Math.round(Number(body.refundCents)) : 0;
  const reason = body.reason ? String(body.reason) : null;

  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
  if (!Number.isFinite(newJobCostCents) || newJobCostCents < 0) {
    return NextResponse.json({ error: "newJobCostCents must be a non-negative integer" }, { status: 400 });
  }
  if (refundCents && (!Number.isFinite(refundCents) || refundCents < 0)) {
    return NextResponse.json({ error: "refundCents must be a non-negative integer" }, { status: 400 });
  }

  const supabase = getAdminSupabase();

  try {
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("id, booking_number, final_charge_cents, total_estimate_cents, payment_intent_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    const previousCents = Number(booking.final_charge_cents ?? booking.total_estimate_cents ?? 0);

    // 1) Persist the new job cost. This is the authoritative revenue that GHL
    //    (monetaryValue) and Airtable (customer paid) read from, and it fires
    //    the booking-change triggers automatically.
    const { error: updErr } = await supabase
      .from("bookings")
      .update({ final_charge_cents: newJobCostCents, updated_at: new Date().toISOString() })
      .eq("id", bookingId);
    if (updErr) throw updErr;

    // 2) Optional Stripe refund (partial) via the proven admin-refund-booking
    //    function — keeps the booking active (markCancelled: false).
    let refund: { ok: boolean; refundId?: string; error?: string } | null = null;
    if (refundCents > 0) {
      try {
        const { data: refData, error: refErr } = await supabase.functions.invoke("admin-refund-booking", {
          body: {
            bookingId,
            amountCents: refundCents,
            reason: reason || "job cost adjustment",
            markCancelled: false,
          },
        });
        const d = refData as { success?: boolean; refundId?: string; error?: string } | null;
        if (refErr) refund = { ok: false, error: refErr.message };
        else if (d?.error) refund = { ok: false, error: d.error };
        else refund = { ok: !!d?.success, refundId: d?.refundId };
      } catch (e) {
        refund = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    // 3) Keep any custom payout for this booking consistent (profit/% follow
    //    the new revenue).
    try {
      const { data: payout } = await supabase
        .from("manual_payouts")
        .select("id, amount_cents")
        .eq("booking_id", bookingId)
        .neq("status", "cancelled")
        .maybeSingle();
      if (payout?.id) {
        const amt = Number(payout.amount_cents) || 0;
        const profit = newJobCostCents - amt;
        const pct = newJobCostCents > 0 ? Math.round((amt / newJobCostCents) * 10000) / 100 : 0;
        await supabase
          .from("manual_payouts")
          .update({ revenue_cents: newJobCostCents, profit_cents: profit, pct_paid: pct, updated_at: new Date().toISOString() })
          .eq("id", payout.id);
      }
    } catch {
      /* non-blocking */
    }

    // 4) Direct Airtable sync (belt + suspenders alongside the DB trigger).
    let airtableSynced = false;
    try {
      const recId = await syncJobByBookingId(bookingId, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE });
      airtableSynced = !!recId;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[adjust-job-cost] airtable sync failed (non-blocking)", (e as Error).message);
    }

    // 5) Direct GHL re-sync for immediacy (the trigger also covers this).
    try {
      await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId, source: "adjust-job-cost" } });
    } catch {
      /* non-blocking — trigger covers it */
    }

    await supabase.from("events").insert({
      event_type: "booking.job_cost_adjusted",
      booking_id: bookingId,
      source: "adjust-job-cost",
      summary: `Job cost adjusted ${(previousCents / 100).toFixed(2)} → ${(newJobCostCents / 100).toFixed(2)}${refundCents ? ` · refunded $${(refundCents / 100).toFixed(2)}` : ""}`,
      data: { previousCents, newJobCostCents, refundCents, reason, by: principal.userId, refund, airtableSynced },
    }).then(() => undefined, () => undefined);

    return NextResponse.json({
      ok: true,
      bookingId,
      previousCents,
      newJobCostCents,
      refund,
      airtableSynced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[adjust-job-cost]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
