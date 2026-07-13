// notify-crew-change
//
// One small function behind three DB triggers, closing the "cleaner shows
// up to a job that changed under them" gaps. Because these fire on the DB
// transition itself, EVERY ops path is covered (edge functions, admin
// consoles, manual SQL) — not just the flows someone remembered to patch.
//
//   { kind: "withdrawn", assignmentId }
//     job_assignments accepted-family → Withdrawn. Texts the displaced
//     cleaner that the office took them off the job (reassignment used to
//     be completely silent for them).
//
//   { kind: "cancelled", bookingId }
//     bookings.status → cancelled. Texts the SUPPORT crew (everyone on
//     job_assignments except the lead on bookings.cleaner_id — the lead is
//     texted inline by cancel-booking / admin-refund-booking).
//
//   { kind: "rescheduled", bookingId }
//     bookings.rescheduled_at changed. Texts the SUPPORT crew the new
//     date/time (reschedule-booking already texts the lead inline).
//
//   { kind: "reassign_cleanup", jobId, keepCleanerIds }
//     events INSERT of booking.manually_assigned (mode=replace). Withdraws
//     stale Confirmed/In-Progress assignment rows for cleaners NOT in the
//     new crew — admin-booking-assign historically left them "Confirmed"
//     forever, so the displaced cleaner kept seeing the job. The withdrawal
//     itself then fires the "withdrawn" trigger above, which texts them.
//
// All sends are best-effort and deduped through the events log.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

function refOf(booking: { booking_number?: number | null } | null, fallback: string): string {
  return booking?.booking_number
    ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
    : fallback;
}

async function sms(admin: SB, phone: string, firstName: string | null, message: string): Promise<boolean> {
  const { error } = await admin.functions.invoke("send-ghl-sms", {
    body: { phone, firstName: firstName || undefined, message, type: "job_offer" },
  });
  return !error;
}

/** Support crew = assigned cleaners on the job other than the booking lead. */
async function supportCrew(admin: SB, booking: { job_id: string | null; cleaner_id: string | null }) {
  if (!booking.job_id) return [];
  const { data: assigns } = await admin
    .from("job_assignments")
    .select("cleaner_id, status")
    .eq("job_id", booking.job_id)
    .in("status", ["Confirmed", "Accepted", "In Progress", "Assigned"]);
  const ids = [...new Set(
    (assigns || [])
      .map((a: { cleaner_id: string | null }) => a.cleaner_id)
      .filter((id: string | null): id is string => !!id && id !== booking.cleaner_id),
  )];
  if (ids.length === 0) return [];
  const { data: crew } = await admin
    .from("cleaners").select("id, phone, first_name").in("id", ids);
  return crew || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body?.kind || "");

    // ─── Reassignment cleanup (fires on the manually_assigned event) ─────
    if (kind === "reassign_cleanup") {
      const jobId = String(body?.jobId || "");
      const keep = Array.isArray(body?.keepCleanerIds) ? body.keepCleanerIds.map(String) : [];
      if (!jobId) return json({ ok: false, error: "jobId required" }, 400);
      const { data: staleRows } = await admin
        .from("job_assignments")
        .select("id, cleaner_id, status")
        .eq("job_id", jobId)
        .in("status", ["Confirmed", "In Progress"]);
      const staleIds = (staleRows || [])
        .filter((r: { cleaner_id: string }) => !keep.includes(r.cleaner_id))
        .map((r: { id: string }) => r.id);
      if (staleIds.length > 0) {
        // The withdrawal fires the assignment trigger → "withdrawn" texts.
        await admin.from("job_assignments").update({ status: "Withdrawn" }).in("id", staleIds);
      }
      return json({ ok: true, withdrawn: staleIds.length });
    }

    // ─── Displaced cleaner (reassignment / unassign) ─────────────────────
    if (kind === "withdrawn") {
      const assignmentId = String(body?.assignmentId || "");
      if (!assignmentId) return json({ ok: false, error: "assignmentId required" }, 400);

      const { data: assignment } = await admin
        .from("job_assignments")
        .select("id, cleaner_id, job_id, status")
        .eq("id", assignmentId)
        .maybeSingle();
      if (!assignment?.cleaner_id) return json({ ok: true, skipped: "no_assignment" });
      if (String(assignment.status).toLowerCase() !== "withdrawn") {
        return json({ ok: true, skipped: `status:${assignment.status}` });
      }

      // Dedupe: one withdrawal text per assignment row, ever.
      const { data: prior } = await admin
        .from("events").select("id")
        .eq("event_type", "cleaner.withdrawn_notified")
        .eq("data->>assignment_id", assignmentId)
        .limit(1);
      if (prior && prior.length > 0) return json({ ok: true, skipped: "already_sent" });

      // Replace flows withdraw-then-reupsert staying cleaners within ~1s.
      // Wait out that window so the still-on-job check below sees the
      // final state and we never text a cleaner who kept the job.
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // If the cleaner is still on the job under another active row (e.g.
      // their offer row was withdrawn but their confirmed row lives on, or
      // the replace re-upserted them), say nothing.
      const { data: stillActive } = await admin
        .from("job_assignments")
        .select("id")
        .eq("job_id", assignment.job_id)
        .eq("cleaner_id", assignment.cleaner_id)
        .in("status", ["Confirmed", "Accepted", "In Progress", "Assigned", "Completed"])
        .limit(1);
      if (stillActive && stillActive.length > 0) return json({ ok: true, skipped: "still_on_job" });

      const { data: booking } = await admin
        .from("bookings")
        .select("id, booking_number, service_date, time_slot")
        .eq("job_id", assignment.job_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: cleaner } = await admin
        .from("cleaners").select("phone, first_name").eq("id", assignment.cleaner_id).maybeSingle();
      if (!cleaner?.phone) return json({ ok: true, skipped: "no_phone" });

      const ref = refOf(booking, "a job you had");
      const when = booking?.service_date
        ? ` on ${booking.service_date}${booking.time_slot ? ` (${booking.time_slot})` : ""}`
        : "";
      const sent = await sms(
        admin, cleaner.phone, cleaner.first_name,
        `Novara: You've been taken off ${ref}${when} — the office reassigned it. No action needed and this doesn't affect your standing. Questions? Text the office. Reply STOP to opt out.`,
      );

      await admin.from("events").insert({
        event_type: "cleaner.withdrawn_notified",
        booking_id: booking?.id || null,
        cleaner_id: assignment.cleaner_id,
        source: "notify-crew-change",
        summary: `Told ${cleaner.first_name || "cleaner"} they were taken off ${ref}`,
        data: { assignment_id: assignmentId, sent },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, sent });
    }

    // ─── Support crew on cancel / reschedule ─────────────────────────────
    if (kind === "cancelled" || kind === "rescheduled") {
      const bookingId = String(body?.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);

      const { data: booking } = await admin
        .from("bookings")
        .select("id, booking_number, status, cleaner_id, job_id, service_date, time_slot")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: true, skipped: "no_booking" });

      // Dedupe: one text per booking per state (cancel: forever; resched:
      // per target date).
      const dedupeKey = kind === "cancelled" ? "cancelled" : `rescheduled:${booking.service_date}`;
      const { data: prior } = await admin
        .from("events").select("id")
        .eq("event_type", "cleaner.crew_change_notified")
        .eq("booking_id", bookingId)
        .eq("data->>key", dedupeKey)
        .limit(1);
      if (prior && prior.length > 0) return json({ ok: true, skipped: "already_sent" });

      const crew = await supportCrew(admin, booking);
      if (crew.length === 0) return json({ ok: true, skipped: "no_support_crew" });

      const ref = refOf(booking, "a job you're assigned to");
      let sent = 0;
      for (const c of crew) {
        if (!c.phone) continue;
        const msg = kind === "cancelled"
          ? `Novara Cleaning: ${ref}${booking.service_date ? ` on ${booking.service_date}` : ""} has been cancelled. No action needed. Reply STOP to opt out.`
          : `Novara Cleaning: ${ref} has been rescheduled to ${booking.service_date}${booking.time_slot ? ` (${booking.time_slot})` : ""}. Check your portal for the updated schedule. Reply STOP to opt out.`;
        if (await sms(admin, c.phone, c.first_name, msg)) sent++;
      }

      await admin.from("events").insert({
        event_type: "cleaner.crew_change_notified",
        booking_id: bookingId,
        source: "notify-crew-change",
        summary: `${kind === "cancelled" ? "Cancel" : "Reschedule"} notice sent to ${sent}/${crew.length} support crew for ${ref}`,
        data: { key: dedupeKey, kind, sent },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, sent, crew: crew.length });
    }

    return json({ ok: false, error: `Unknown kind '${kind}'` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[notify-crew-change]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
