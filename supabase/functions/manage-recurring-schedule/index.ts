// manage-recurring-schedule
//
// Token-protected customer self-service API behind
//   app.novaracleaning.com/manage-recurring/<token>
// (link is texted to the customer — no login required, same credential
// model as the contractor job links).
//
// The schedule's manage_token is the only gate. Actions:
//   { token }                                   → full state (schedule +
//       upcoming generated bookings + cadence-aware date preview)
//   { token, action:'set_next', date, timeSlot? } → move the next visit.
//       Frequency-aware: all future visits ripple from the new date. If a
//       booking was already generated for the old date it is moved too
//       (service_date, time_slot, linked job start) and re-synced.
//   { token, action:'set_time', timeSlot }        → change arrival window
//       (also updates the already-generated upcoming booking, if any)
//   { token, action:'set_cadence', cadence }      → weekly|biweekly|monthly
//   { token, action:'skip_next' }                 → skip one visit (cancels
//       the generated booking for that date when one exists)
//   { token, action:'pause' } / { action:'resume' }
//   { token, action:'request_new_cleaner' }
//
// Every change writes a `recurring.customer_update` event → internal
// dispatch Discord channel, so ops always sees customer-initiated changes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { advanceDate, previewDates } from "../_shared/recurring-manage.ts";
import { parseTimeSlotToClock } from "../_shared/sms.ts";
import { checkScheduleBuffer } from "../_shared/schedule-buffer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const VALID_CADENCES = ["weekly", "biweekly", "monthly"];
const OPEN_BOOKING_STATUSES = ["confirmed", "assigned", "pending_details", "booked"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const action = String(body?.action || "get").toLowerCase();
    if (!token) return json({ error: "Missing token" }, 400);

    const { data: sched } = await admin
      .from("customer_recurring_schedules")
      .select("*")
      .eq("manage_token", token)
      .maybeSingle();
    if (!sched) return json({ error: "This link is invalid or has been replaced. Text us for a fresh one." }, 404);

    const today = ymd(new Date());
    const customerName = `${sched.first_name || ""}`.trim();

    // The already-generated upcoming booking for the CURRENT next date (if the
    // generator ran ahead). Customer changes must move this too, or the crew
    // would still show up on the old date.
    // deno-lint-ignore no-explicit-any
    const loadUpcoming = async (): Promise<any[]> => {
      const { data } = await admin
        .from("bookings")
        .select("id, service_date, time_slot, status, service_type, cleaner_id, job_id")
        .eq("recurring_schedule_id", sched.id)
        .gte("service_date", today)
        .order("service_date", { ascending: true })
        .limit(6);
      return data || [];
    };

    // deno-lint-ignore no-explicit-any
    const emitOpsEvent = async (summary: string, data?: Record<string, any>) => {
      await admin.from("events").insert({
        event_type: "recurring.customer_update",
        source: "manage-recurring-schedule",
        summary,
        data: { schedule_id: sched.id, email: sched.email, ...data },
      }).then(() => undefined).catch(() => undefined);
    };

    // Move an already-generated open booking (and its job) to a new date/slot.
    const moveGeneratedBooking = async (
      fromDate: string,
      toDate: string,
      timeSlot: string | null,
    ): Promise<string | null> => {
      const { data: bk } = await admin
        .from("bookings")
        .select("id, job_id, service_date, time_slot, status")
        .eq("recurring_schedule_id", sched.id)
        .eq("service_date", fromDate)
        .in("status", OPEN_BOOKING_STATUSES)
        .maybeSingle();
      if (!bk) return null;

      const slot = timeSlot || bk.time_slot || sched.preferred_time_slot;

      // A customer moving their own visit can land it on top of the assigned
      // crew's other job. The customer's move always wins — but the crew comes
      // off rather than the day quietly becoming impossible, and dispatch is
      // told the visit needs re-staffing.
      const bufferCheck = await checkScheduleBuffer(admin, {
        bookingId: bk.id,
        serviceDate: toDate,
        timeSlot: slot,
      });
      const dropCrew = !bufferCheck.ok;

      await admin
        .from("bookings")
        .update({
          service_date: toDate,
          time_slot: slot,
          ...(dropCrew ? { cleaner_id: null, num_cleaners_assigned: 0 } : {}),
          team_notes: `Customer moved this recurring visit from ${fromDate} to ${toDate} via manage link (${new Date().toISOString().slice(0, 10)}).`
            + (dropCrew ? ` Crew withdrawn — ${bufferCheck.message || "no buffer around their other job"}` : ""),
        })
        .eq("id", bk.id);

      if (dropCrew) {
        if (bk.job_id) {
          await admin
            .from("job_assignments")
            .update({ status: "Withdrawn" })
            .eq("job_id", bk.job_id)
            .in("status", ["Offered", "Broadcast", "Accepted", "Confirmed", "Assigned"]);
        }
        await admin.from("events").insert({
          event_type: "dispatch.approval_needed",
          booking_id: bk.id,
          job_id: bk.job_id || null,
          source: "manage-recurring-schedule",
          summary:
            `🔁 Customer moved their recurring visit to ${toDate} ${slot}, which left no buffer around ` +
            `the assigned crew's other job. Crew withdrawn — needs re-staffing.\n${bufferCheck.message || ""}`,
          data: { reason: "buffer_conflict_on_customer_move", conflicts: bufferCheck.conflicts },
        }).then(() => undefined, () => undefined);
      }

      if (bk.job_id) {
        const clock = parseTimeSlotToClock(slot || "").start || "09:00:00";
        await admin
          .from("jobs")
          .update({ start_datetime: `${toDate}T${clock}` })
          .eq("id", bk.job_id)
          .then(() => undefined).catch(() => undefined);
      }
      // Re-sync GHL / calendar (best-effort).
      try { await admin.functions.invoke("send-zapier-webhook", { body: { bookingId: bk.id } }); } catch (_) { /* non-fatal */ }
      try { await admin.functions.invoke("create-google-calendar-event", { body: { bookingId: bk.id } }); } catch (_) { /* non-fatal */ }
      return bk.id;
    };

    // ─── Mutations ───────────────────────────────────────────────────────
    if (action !== "get") {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let summary = "";

      if (action === "pause") {
        patch.active = false;
        summary = `${sched.email} paused their ${sched.cadence} recurring plan from the manage link.`;
      } else if (action === "resume") {
        patch.active = true;
        summary = `${sched.email} resumed their ${sched.cadence} recurring plan.`;
      } else if (action === "skip_next") {
        if (!sched.next_service_date) return json({ error: "No upcoming clean to skip" }, 400);
        const skipped = sched.next_service_date;
        patch.next_service_date = advanceDate(skipped, sched.cadence);
        // If the visit was already generated as a booking, cancel it (the DB
        // cascade withdraws the job + assignments).
        const { data: bk } = await admin
          .from("bookings")
          .select("id")
          .eq("recurring_schedule_id", sched.id)
          .eq("service_date", skipped)
          .in("status", OPEN_BOOKING_STATUSES)
          .maybeSingle();
        if (bk?.id) {
          await admin
            .from("bookings")
            .update({ status: "cancelled", cancel_reason: "Customer skipped recurring visit via manage link" })
            .eq("id", bk.id);
        }
        summary = `${sched.email} skipped their ${skipped} visit — next clean is now ${patch.next_service_date}.`;
      } else if (action === "set_time") {
        const timeSlot = String(body?.timeSlot || body?.preferred_time_slot || "").trim();
        if (!timeSlot) return json({ error: "timeSlot required" }, 400);
        patch.preferred_time_slot = timeSlot;
        if (sched.next_service_date) {
          await moveGeneratedBooking(sched.next_service_date, sched.next_service_date, timeSlot);
        }
        summary = `${sched.email} changed their recurring arrival window to ${timeSlot}.`;
      } else if (action === "set_next") {
        const date = String(body?.date || "").trim();
        const timeSlot = body?.timeSlot ? String(body.timeSlot).trim() : null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "date (YYYY-MM-DD) required" }, 400);
        if (date <= today) return json({ error: "Pick a date at least one day out — for same-day changes text or call us." }, 400);
        const oldDate = sched.next_service_date;
        patch.next_service_date = date;
        if (timeSlot) patch.preferred_time_slot = timeSlot;
        if (oldDate) await moveGeneratedBooking(oldDate, date, timeSlot);
        summary = `${sched.email} moved their next recurring clean${oldDate ? ` from ${oldDate}` : ""} to ${date}${timeSlot ? ` (${timeSlot})` : ""}. Future visits follow every ${sched.cadence === "weekly" ? "week" : sched.cadence === "monthly" ? "month" : "2 weeks"} from the new date.`;
      } else if (action === "set_cadence") {
        const cadence = String(body?.cadence || "").toLowerCase();
        if (!VALID_CADENCES.includes(cadence)) return json({ error: "cadence must be weekly, biweekly, or monthly" }, 400);
        patch.cadence = cadence;
        summary = `${sched.email} changed their recurring frequency from ${sched.cadence} to ${cadence}.`;
      } else if (action === "request_new_cleaner") {
        patch.preferred_cleaner_id = null;
        patch.notes = `Customer requested a different cleaner on ${today} (via manage link). Admin: assign a new regular cleaner.`;
        summary = `${sched.email} requested a DIFFERENT cleaner for their recurring plan — assign a new regular in the admin hub.`;
      } else {
        return json({ error: `Unknown action: ${action}` }, 400);
      }

      const { error: updErr } = await admin
        .from("customer_recurring_schedules")
        .update(patch)
        .eq("id", sched.id);
      if (updErr) return json({ error: updErr.message }, 400);

      await emitOpsEvent(summary, { action });
      Object.assign(sched, patch);
    }

    // ─── Full state (all actions end here) ───────────────────────────────
    const upcoming = await loadUpcoming();
    const preview = sched.next_service_date && sched.active
      ? previewDates(sched.next_service_date, sched.cadence, 4)
      : [];

    return json({
      ok: true,
      schedule: {
        first_name: sched.first_name,
        cadence: sched.cadence,
        service_type: sched.service_type,
        add_ons: sched.add_ons || [],
        preferred_time_slot: sched.preferred_time_slot,
        next_service_date: sched.next_service_date,
        active: sched.active,
        price_cents: sched.price_cents,
        membership_plan: sched.membership_plan,
        address: sched.address,
        city: sched.city,
      },
      customerName,
      upcoming,
      preview,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[manage-recurring-schedule]", msg);
    return json({ error: msg }, 500);
  }
});
