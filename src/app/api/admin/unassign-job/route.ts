// ─── POST /api/admin/unassign-job ──────────────────────────────────────────
//
// Fully unassign a cleaner (or the whole crew) from a job so it stops being
// active on any cleaner's dashboard:
//   • bookings.cleaner_id → null, num_cleaners_assigned → 0, status reset to
//     'confirmed' (unless already completed/cancelled).
//   • job_assignments for the job → 'Withdrawn' (same casing admin-booking-assign
//     writes on replace, so the two unassign paths are indistinguishable; drops
//     dashboards, which only read active statuses).
//   • jobs.status → 'unassigned' so it's an open job again.
//   • Re-sync GHL (opportunity back to unassigned stage) + Airtable.
//
// Admin/VA gated.

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
  // Optional: only withdraw a single cleaner (defaults to the whole crew).
  const cleanerId = body.cleanerId ? String(body.cleanerId) : null;
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  const supabase = getAdminSupabase();

  try {
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("id, status, job_id, cleaner_id, num_cleaners_assigned")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

    // 1) Withdraw the dispatch assignment(s) so they leave cleaner dashboards.
    if (booking.job_id) {
      let q = supabase
        .from("job_assignments")
        .update({ status: "Withdrawn" })
        .eq("job_id", booking.job_id);
      if (cleanerId) q = q.eq("cleaner_id", cleanerId);
      await q.then(() => undefined, () => undefined);

      // Mark the job open again only when nobody is left assigned.
      // Do not .limit(1) here — we need the full remaining set for the count
      // when a single cleaner is dropped from a multi-person crew.
      const { data: remaining } = await supabase
        .from("job_assignments")
        .select("id, cleaner_id")
        .eq("job_id", booking.job_id)
        .not("status", "in", "(withdrawn,cancelled,declined,expired)");
      if (!remaining || remaining.length === 0) {
        await supabase
          .from("jobs")
          .update({ status: "unassigned", updated_at: new Date().toISOString() })
          .eq("id", booking.job_id)
          .then(() => undefined, () => undefined);
      }
    }

    // 2) Clear the booking's cleaner so the public contractor portal (which
    //    reads bookings.cleaner_id) drops it. Reset to confirmed unless the
    //    booking is already terminal.
    const resetStatus = ["completed", "cancelled"].includes(String(booking.status))
      ? undefined
      : "confirmed";
    const patch: Record<string, unknown> = {
      cleaner_id: null,
      num_cleaners_assigned: 0,
      updated_at: new Date().toISOString(),
    };
    if (resetStatus) patch.status = resetStatus;
    // When only one cleaner of a crew is removed, keep the booking assigned to
    // the rest: re-point cleaner_id to a remaining active assignee if any.
    if (cleanerId && booking.job_id) {
      const { data: keep } = await supabase
        .from("job_assignments")
        .select("cleaner_id")
        .eq("job_id", booking.job_id)
        .not("status", "in", "(withdrawn,cancelled,declined,expired)");
      if (keep && keep.length > 0) {
        patch.cleaner_id = keep[0].cleaner_id;
        delete patch.status; // still assigned to someone
        patch.num_cleaners_assigned = keep.length;
      }
    }

    const { error: updErr } = await supabase.from("bookings").update(patch).eq("id", bookingId);
    if (updErr) throw updErr;

    // 3) Re-sync GHL (back to unassigned stage) + Airtable.
    try {
      await supabase.functions.invoke("send-zapier-webhook", { body: { bookingId, source: "unassign-job" } });
    } catch {
      /* trigger covers it */
    }
    let airtableSynced = false;
    try {
      const recId = await syncJobByBookingId(bookingId, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE });
      airtableSynced = !!recId;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[unassign-job] airtable sync failed (non-blocking)", (e as Error).message);
    }

    await supabase.from("events").insert({
      event_type: "booking.cleaner_unassigned",
      booking_id: bookingId,
      source: "unassign-job",
      summary: cleanerId
        ? `Cleaner ${cleanerId} unassigned from booking`
        : "All cleaners unassigned from booking",
      data: { cleanerId, by: principal.userId, airtableSynced },
    }).then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true, bookingId, airtableSynced });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[unassign-job]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
