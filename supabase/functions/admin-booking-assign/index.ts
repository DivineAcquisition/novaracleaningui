// admin-booking-assign
//
// Admin/VA manual assign or reassign cleaners from the directory to a booking.
// Updates job_assignments + bookings, then syncs GHL ops fields via PIT.
//
// Body:
//   { bookingId, cleanerIds: string[], mode?: "replace" | "add" }
//   mode "replace" (default): withdraw open offers, set new Confirmed team
//   mode "add": append Confirmed assignments (up to 3 total active)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import {
  invokeFullBookingGhlSync,
  syncBookingOpsFieldsToGhl,
} from "../_shared/ghl-booking-ops-sync.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function ensureAdminOrVa(admin: any, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const callerId = u?.user?.id;
  if (!callerId) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  const allowed = (roles || []).some((r: any) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return callerId;
}

function parseTimeSlot(timeSlot: string): string {
  const map: Record<string, string> = {
    morning: "09:00:00",
    midday: "12:00:00",
    afternoon: "15:00:00",
  };
  return map[String(timeSlot || "").toLowerCase()] || "09:00:00";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "").trim();
    const cleanerIds = (Array.isArray(body?.cleanerIds) ? body.cleanerIds : [])
      .map((id: unknown) => String(id).trim())
      .filter(Boolean)
      .slice(0, 3);
    const mode = String(body?.mode || "replace").toLowerCase();

    if (!bookingId) return json({ error: "bookingId required" }, 400);
    if (cleanerIds.length === 0) return json({ error: "cleanerIds required (1–3)" }, 400);

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();
    if (bErr || !booking) return json({ error: "booking not found" }, 404);

    const { data: cleaners } = await admin
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, status, approved, available_for_bookings, pay_percentage")
      .in("id", cleanerIds);
    if (!cleaners || cleaners.length !== cleanerIds.length) {
      return json({ error: "One or more cleaners not found in directory" }, 404);
    }
    for (const c of cleaners) {
      if (c.status === "terminated") {
        return json({ error: `Cannot assign terminated cleaner: ${c.first_name} ${c.last_name}` }, 400);
      }
      if (!c.approved || c.status !== "active") {
        return json({ error: `Cleaner not active/approved: ${c.first_name} ${c.last_name}` }, 400);
      }
    }

    let jobId = booking.job_id as string | null;
    if (!jobId) {
      const startTime = parseTimeSlot(booking.time_slot || "morning");
      const startDatetime = `${booking.service_date}T${startTime}`;
      const duration = Number(booking.estimated_duration_hours) || 3;
      const { data: job, error: jobErr } = await admin
        .from("jobs")
        .insert({
          customer_id: booking.customer_id || null,
          address: booking.address,
          city: booking.city,
          state: booking.state,
          zip: booking.zip_code,
          service_type: booking.service_type,
          start_datetime: startDatetime,
          duration_est_hours: duration,
          sq_ft: booking.sqft || 2000,
          bedrooms: booking.bedrooms || 0,
          bathrooms: booking.bathrooms || 0,
          min_cleaners_required: cleanerIds.length,
          status: "Assigned",
          notes: booking.dispatch_notes || booking.team_notes || null,
        })
        .select("id")
        .single();
      if (jobErr || !job) throw jobErr || new Error("job create failed");
      jobId = job.id;
      await admin.from("bookings").update({ job_id: jobId }).eq("id", bookingId);
    }

    if (mode === "replace") {
      await admin
        .from("job_assignments")
        .update({ status: "Withdrawn" })
        .eq("job_id", jobId)
        .in("status", ["Offered", "Broadcast", "Accepted"]);
    }

    const now = new Date().toISOString();
    for (let i = 0; i < cleanerIds.length; i++) {
      const cid = cleanerIds[i];
      const role = i === 0 ? "Lead" : "Support";
      const { error: upsertErr } = await admin.from("job_assignments").upsert(
        {
          job_id: jobId,
          cleaner_id: cid,
          role,
          status: "Confirmed",
          accepted_at: now,
          responded_at: now,
        },
        { onConflict: "job_id,cleaner_id" },
      );
      if (upsertErr) throw upsertErr;
    }

    const leadId = cleanerIds[0];
    await admin
      .from("bookings")
      .update({
        cleaner_id: leadId,
        assigned_at: now,
        status: booking.status === "confirmed" ? "assigned" : booking.status,
        num_cleaners_assigned: cleanerIds.length,
      })
      .eq("id", bookingId);

    await admin.from("jobs").update({ status: "Assigned" }).eq("id", jobId);

    await admin.from("events").insert({
      event_type: "booking.manually_assigned",
      booking_id: bookingId,
      job_id: jobId,
      source: "admin-booking-assign",
      summary: `Manual assign: ${cleaners.map((c: any) => `${c.first_name} ${c.last_name}`).join(", ")}`,
      data: { cleanerIds, mode, by: callerId },
    });

    await syncBookingOpsFieldsToGhl(admin, bookingId);
    await invokeFullBookingGhlSync(admin, bookingId);

    return json({
      success: true,
      bookingId,
      jobId,
      cleanerIds,
      assigned: cleaners.map((c: any) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        phone: c.phone,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-booking-assign]", msg);
    return json({ error: msg }, 500);
  }
});
