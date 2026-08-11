// ─── POST /api/admin/booking-crew ──────────────────────────────────────────
//
// Ops helpers for the Bookings → Current crew panel:
//   • set_lead — promote one assignee to Lead (updates roles + bookings.cleaner_id)
//
// Admin/VA gated. Pay-tier increases stay on cleaner-admin-action (admin UI
// gates that button to full admins).

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncJobByBookingId, DEFAULT_LIVE_ENTRY_SOURCE } from "@/lib/airtable/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE = ["Confirmed", "Accepted", "Assigned", "Offered", "In Progress"];

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

  const action = String(body.action || "");
  const bookingId = String(body.bookingId || "");
  const cleanerId = String(body.cleanerId || "");
  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 });
  if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

  const supabase = getAdminSupabase();

  try {
    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .select("id, status, job_id, cleaner_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!booking) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    if (["cancelled", "completed"].includes(String(booking.status))) {
      return NextResponse.json({ error: "Booking is terminal — crew can't be edited." }, { status: 400 });
    }

    if (action === "set_lead") {
      if (!cleanerId) return NextResponse.json({ error: "cleanerId required" }, { status: 400 });
      if (!booking.job_id) {
        // Legacy booking with only bookings.cleaner_id — just re-point the lead.
        const { error } = await supabase
          .from("bookings")
          .update({ cleaner_id: cleanerId, updated_at: new Date().toISOString() })
          .eq("id", bookingId);
        if (error) throw error;
      } else {
        const { data: active } = await supabase
          .from("job_assignments")
          .select("id, cleaner_id, role, status")
          .eq("job_id", booking.job_id)
          .in("status", ACTIVE);
        const onCrew = (active || []).some((a) => a.cleaner_id === cleanerId);
        if (!onCrew) {
          return NextResponse.json({ error: "That cleaner is not on this crew." }, { status: 400 });
        }

        // Demote everyone else, promote the chosen lead.
        await supabase
          .from("job_assignments")
          .update({ role: "Support" })
          .eq("job_id", booking.job_id)
          .in("status", ACTIVE)
          .then(() => undefined, () => undefined);

        const { error: leadErr } = await supabase
          .from("job_assignments")
          .update({ role: "Lead" })
          .eq("job_id", booking.job_id)
          .eq("cleaner_id", cleanerId)
          .in("status", ACTIVE);
        if (leadErr) throw leadErr;

        const { error: bookErr } = await supabase
          .from("bookings")
          .update({ cleaner_id: cleanerId, updated_at: new Date().toISOString() })
          .eq("id", bookingId);
        if (bookErr) throw bookErr;
      }

      try {
        await supabase.functions.invoke("send-zapier-webhook", {
          body: { bookingId, source: "booking-crew-set-lead" },
        });
      } catch {
        /* trigger covers it */
      }
      let airtableSynced = false;
      try {
        const recId = await syncJobByBookingId(bookingId, { entrySource: DEFAULT_LIVE_ENTRY_SOURCE });
        airtableSynced = !!recId;
      } catch {
        /* non-blocking */
      }

      await supabase
        .from("events")
        .insert({
          event_type: "booking.crew_lead_set",
          booking_id: bookingId,
          cleaner_id: cleanerId,
          source: "booking-crew",
          summary: `Lead set to cleaner ${cleanerId}`,
          data: { cleanerId, by: principal.userId, airtableSynced },
        })
        .then(() => undefined, () => undefined);

      return NextResponse.json({ ok: true, bookingId, cleanerId, airtableSynced });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[booking-crew]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
