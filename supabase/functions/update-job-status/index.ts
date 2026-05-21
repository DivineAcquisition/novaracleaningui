// update-job-status
//
// Manual VA-triggered job status transitions. Phase-3 spec.
//
// IMPORTANT: This function deliberately does NOT mutate `job_assignments`
// in ways that would race with the existing `respond-to-offer` flow.
// It writes to job_status_history (canonical timeline) plus an event,
// then updates the minimal fields needed (en_route_at, completed_at,
// no_show_at, cancelled_at) on bookings/jobs without altering the
// dispatch-driven status enum on job_assignments.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_STATUSES = new Set(["en_route", "in_progress", "completed", "cancelled", "no_show"]);
const VALID_ORDER: Record<string, number> = {
  pending_details: 0, booked: 0, confirmed: 1, assigned: 2,
  en_route: 3, in_progress: 4, completed: 5,
  cancelled: 99, no_show: 99,
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function callerId(adminClient: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: user, error } = await userClient.auth.getUser();
  if (error || !user?.user) throw new Error("unauthorized");
  const uid = user.user.id;
  const { data: roles } = await adminClient
    .from("user_roles").select("role").eq("user_id", uid);
  const allowed = (roles || []).some((r: any) => ["admin", "va", "csr"].includes(r.role));
  if (!allowed) throw new Error("forbidden");
  return uid;
}

async function safeInvoke(
  adminClient: any, name: string, body: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await adminClient.functions.invoke(name, { body });
    if (error) return { ok: false, error: String(error.message || error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let uid: string;
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing bearer" }, 401);
    uid = await callerId(adminClient, jwt);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  const { bookingId, newStatus, reason, noShowBy, cancelledBy, metadata } = body || {};
  if (!bookingId || !ALLOWED_STATUSES.has(newStatus)) {
    return json({ error: `bookingId required, newStatus must be one of: ${[...ALLOWED_STATUSES].join(", ")}` }, 400);
  }
  if (newStatus === "no_show" && !noShowBy) return json({ error: "noShowBy required for no_show" }, 400);
  if (newStatus === "cancelled" && !cancelledBy) return json({ error: "cancelledBy required for cancelled" }, 400);

  const { data: booking, error: bErr } = await adminClient
    .from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (bErr || !booking) return json({ error: "booking not found" }, 404);

  const fromStatus = booking.status as string;
  const toStatus = newStatus as string;
  if (VALID_ORDER[toStatus] !== undefined && VALID_ORDER[fromStatus] !== undefined) {
    if (VALID_ORDER[toStatus] < VALID_ORDER[fromStatus] && toStatus !== "cancelled" && toStatus !== "no_show") {
      return json({ error: `cannot go backwards from ${fromStatus} -> ${toStatus}`, code: "INVALID_TRANSITION" }, 409);
    }
    if (fromStatus === toStatus) {
      return json({ ok: true, note: "already in this status (idempotent no-op)", booking });
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };

  switch (toStatus) {
    case "en_route":
      patch.en_route_at = now;
      break;
    case "in_progress":
      patch.started_at = now;
      patch.status = "in_progress";
      break;
    case "completed":
      patch.completed_at = now;
      patch.status = "completed";
      break;
    case "cancelled":
      patch.cancelled_at = now;
      patch.cancellation_reason = reason || null;
      patch.status = "cancelled";
      break;
    case "no_show":
      patch.no_show_at = now;
      patch.no_show_by = noShowBy;
      patch.status = "cancelled";
      break;
  }

  const { error: uErr } = await adminClient.from("bookings").update(patch).eq("id", bookingId);
  if (uErr) return json({ error: `failed to update booking: ${uErr.message}` }, 500);

  if (booking.job_id) {
    const jobPatch: Record<string, unknown> = {};
    if (toStatus === "en_route") jobPatch.en_route_at = now;
    if (toStatus === "no_show") { jobPatch.no_show_at = now; jobPatch.no_show_by = noShowBy; }
    if (Object.keys(jobPatch).length > 0) {
      await adminClient.from("jobs").update(jobPatch).eq("id", booking.job_id);
    }
    await adminClient.from("job_status_history").insert({
      job_id: booking.job_id, from_status: fromStatus, to_status: toStatus,
      changed_by: uid, metadata: { reason, noShowBy, cancelledBy, ...metadata, source: "update-job-status" },
    });
  }

  if (toStatus === "no_show" && noShowBy === "cleaner" && booking.job_id) {
    const { data: assignment } = await adminClient
      .from("job_assignments").select("cleaner_id").eq("job_id", booking.job_id)
      .in("status", ["Offered", "Accepted", "Confirmed", "In Progress"]).maybeSingle();
    if (assignment?.cleaner_id) {
      const { data: c } = await adminClient.from("cleaners").select("no_show_count").eq("id", assignment.cleaner_id).maybeSingle();
      await adminClient.from("cleaners").update({ no_show_count: (c?.no_show_count ?? 0) + 1 }).eq("id", assignment.cleaner_id);
      await adminClient.from("cleaner_flags").insert({
        cleaner_id: assignment.cleaner_id, issue_type: "no_show", severity: "high",
        details: `Auto-flag: no-show on booking ${booking.booking_number || bookingId}. ${reason || ""}`.trim(),
        flagged_by: uid, job_id: booking.job_id,
      });
    }
  }

  if (toStatus === "cancelled" && cancelledBy === "cleaner" && booking.job_id) {
    await adminClient
      .from("job_assignments")
      .update({ status: "Needs Reassignment" })
      .eq("job_id", booking.job_id)
      .in("status", ["Offered", "Accepted", "Confirmed"]);
  }

  await adminClient.from("events").insert({
    event_type: `booking.${toStatus}`,
    booking_id: bookingId, job_id: booking.job_id,
    source: "update-job-status",
    summary: `Booking ${booking.booking_number ? `NOV-${String(booking.booking_number).padStart(5, "0")}` : bookingId} — ${fromStatus} → ${toStatus}${reason ? " (" + reason + ")" : ""}`,
    data: { from: fromStatus, to: toStatus, reason, noShowBy, cancelledBy, by: uid, metadata },
  });

  if (["cancelled", "completed", "no_show"].includes(toStatus)) {
    await safeInvoke(adminClient, "book-ghl-appointment", {
      bookingId, action: toStatus === "cancelled" || toStatus === "no_show" ? "cancel" : "update",
    });
  }

  const { data: updated } = await adminClient.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  return json({ ok: true, booking: updated, transition: { from: fromStatus, to: toStatus } });
});
