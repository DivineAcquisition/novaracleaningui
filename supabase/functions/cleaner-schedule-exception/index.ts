// cleaner-schedule-exception
//
// CRUD for public.cleaner_schedule_exceptions. Phase-3 spec
// addScheduleException / removeScheduleException.
//
// Side effects on add:
//   * Inserts the exception row
//   * Finds existing job_assignments on that date and returns them
//     as conflicts. If add is within 48h, marks the assignment as
//     needs_reassignment and emits a HIGH severity event for the VA.
// On remove the row is deleted. Assignments already reassigned are
// NOT auto-restored.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_TYPES = new Set(["day_off", "sick", "vacation", "custom"]);

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
  const { data: roles } = await adminClient.from("user_roles").select("role").eq("user_id", uid);
  const allowed = (roles || []).some((r: any) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("forbidden");
  return uid;
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
  const { action, cleanerId } = body || {};
  if (!action || !cleanerId) return json({ error: "action + cleanerId required" }, 400);

  if (action === "list") {
    const startDate = body.startDate || new Date().toISOString().slice(0, 10);
    const endDate = body.endDate || new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await adminClient
      .from("cleaner_schedule_exceptions")
      .select("*").eq("cleaner_id", cleanerId)
      .gte("exception_date", startDate).lte("exception_date", endDate)
      .order("exception_date");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, exceptions: data || [] });
  }

  if (action === "add") {
    const { date, type } = body;
    if (!date) return json({ error: "date required" }, 400);
    if (!type || !VALID_TYPES.has(type)) {
      return json({ error: `type must be one of: ${[...VALID_TYPES].join(", ")}` }, 400);
    }
    const { data: inserted, error } = await adminClient
      .from("cleaner_schedule_exceptions")
      .insert({
        cleaner_id: cleanerId, exception_date: date, type, reason: body.reason || null,
        start_time: body.startTime || null, end_time: body.endTime || null,
        created_by: uid,
      })
      .select().maybeSingle();
    if (error) return json({ error: error.message }, 500);

    const { data: bookings } = await adminClient
      .from("bookings")
      .select("id, booking_number, service_date, time_slot, address, job_id")
      .eq("service_date", date)
      .not("job_id", "is", null);
    const jobIds = (bookings || []).map((b: any) => b.job_id);
    const { data: assignments } = await adminClient
      .from("job_assignments")
      .select("id, job_id, status")
      .eq("cleaner_id", cleanerId)
      .in("job_id", jobIds.length > 0 ? jobIds : ["00000000-0000-0000-0000-000000000000"])
      .in("status", ["assigned", "accepted"]);

    const conflicts = (bookings || []).filter((b: any) =>
      (assignments || []).some((a: any) => a.job_id === b.job_id)
    );

    const hoursUntil = Math.max(0, (new Date(date + "T00:00:00Z").getTime() - Date.now()) / 3600000);
    const isUrgent = hoursUntil <= 48 && conflicts.length > 0;

    if (isUrgent && assignments) {
      await adminClient.from("job_assignments")
        .update({ status: "needs_reassignment" })
        .in("id", assignments.map((a: any) => a.id));
    }

    await adminClient.from("events").insert({
      event_type: "cleaner.exception_added", cleaner_id: cleanerId,
      source: "cleaner-schedule-exception",
      summary: `${isUrgent ? "⚠️ URGENT " : ""}Schedule exception added — ${type} on ${date}` + (conflicts.length > 0 ? ` (${conflicts.length} jobs affected)` : ""),
      data: { type, date, reason: body.reason, conflicts: conflicts.length, urgent: isUrgent },
    });

    return json({ ok: true, exception: inserted, conflicts, urgent: isUrgent });
  }

  if (action === "remove") {
    const { exceptionId } = body;
    if (!exceptionId) return json({ error: "exceptionId required" }, 400);
    const { data: removed, error } = await adminClient
      .from("cleaner_schedule_exceptions")
      .delete().eq("id", exceptionId).eq("cleaner_id", cleanerId)
      .select().maybeSingle();
    if (error) return json({ error: error.message }, 500);
    await adminClient.from("events").insert({
      event_type: "cleaner.exception_removed", cleaner_id: cleanerId,
      source: "cleaner-schedule-exception",
      summary: `Schedule exception removed (was ${removed?.type} on ${removed?.exception_date})`,
      data: { exception: removed },
    });
    return json({ ok: true, removed });
  }

  return json({ error: `unknown action: ${action}` }, 400);
});
