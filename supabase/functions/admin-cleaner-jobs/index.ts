// admin-cleaner-jobs
//
// Admin/VA: view a cleaner's pending job OFFERS + upcoming assigned jobs from
// the Cleaners workspace, and accept/decline an offer ON THE CLEANER'S BEHALF.
//
// Accept/decline reuse the exact same accept-job-offer logic the cleaner's own
// SMS link uses (via the assignment's response_token), so everything stays in
// sync: job_assignments status, jobs.status, bookings.cleaner_id +
// num_cleaners_assigned + status, cleaner acceptance metrics, the
// job.assignment.accepted event, the GHL/contractor sync, and the contractor
// checklist link. Admin accept overrides the 10-minute offer expiry (bumps
// expires_at) since the admin is acting deliberately.
//
// Body:
//   { action: "list",     cleanerId }
//   { action: "accept",   assignmentId }
//   { action: "decline",  assignmentId }
//   { action: "check_in", assignmentId }   — start the job on the cleaner's
//     behalf (same job-check-in flow the portal uses: stamps check-in time,
//     flips statuses, fires the BEFORE-photos SMS to the cleaner)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return u.user.id;
}

const OFFER_STATUSES = ["offered", "broadcast"];
const ACTIVE_JOB_STATUSES = ["confirmed", "accepted", "assigned", "in progress"];

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list").toLowerCase();

    // ─── LIST ────────────────────────────────────────────────────────────
    if (action === "list") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ error: "cleanerId required" }, 400);

      const { data: assignments } = await admin
        .from("job_assignments")
        .select(
          "id, job_id, cleaner_id, role, status, distance_miles, estimated_pay_cents, pay_percentage_snapshot, expires_at, accepted_at, created_at, response_token",
        )
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(100);

      const rows = (assignments || []) as Record<string, unknown>[];
      const jobIds = Array.from(new Set(rows.map((a) => String(a.job_id)).filter(Boolean)));

      const jobsById = new Map<string, Record<string, unknown>>();
      const bookingByJob = new Map<string, Record<string, unknown>>();
      if (jobIds.length > 0) {
        const { data: jobs } = await admin
          .from("jobs")
          .select("id, status, service_type, address, city, state, zip, start_datetime, duration_est_hours, min_cleaners_required, check_in_time")
          .in("id", jobIds);
        for (const j of jobs || []) jobsById.set(String(j.id), j);

        const { data: bks } = await admin
          .from("bookings")
          .select("id, booking_number, status, service_date, time_slot, arrival_window, first_name, last_name, total_estimate_cents, photo_upload_token, before_photo_link_sent_at, after_photo_link_sent_at, job_id")
          .in("job_id", jobIds);
        for (const b of bks || []) if (b.job_id) bookingByJob.set(String(b.job_id), b);
      }

      const now = Date.now();
      const shape = (a: Record<string, unknown>) => {
        const job = jobsById.get(String(a.job_id)) || {};
        const booking = bookingByJob.get(String(a.job_id)) || null;
        const expiresAt = a.expires_at ? new Date(String(a.expires_at)).getTime() : null;
        return {
          assignmentId: a.id,
          jobId: a.job_id,
          bookingId: (booking as Record<string, unknown> | null)?.id ?? null,
          status: a.status,
          role: a.role,
          distance_miles: a.distance_miles,
          estimated_pay_cents: a.estimated_pay_cents,
          expires_at: a.expires_at,
          expired: expiresAt != null && expiresAt < now,
          service_type: (job as Record<string, unknown>).service_type ?? null,
          job_status: (job as Record<string, unknown>).status ?? null,
          check_in_time: (job as Record<string, unknown>).check_in_time ?? null,
          start_datetime: (job as Record<string, unknown>).start_datetime ?? null,
          address: (job as Record<string, unknown>).address ?? null,
          city: (job as Record<string, unknown>).city ?? null,
          state: (job as Record<string, unknown>).state ?? null,
          booking: booking
            ? {
              booking_number: (booking as Record<string, unknown>).booking_number ?? null,
              status: (booking as Record<string, unknown>).status ?? null,
              service_date: (booking as Record<string, unknown>).service_date ?? null,
              time_slot: (booking as Record<string, unknown>).time_slot ?? (booking as Record<string, unknown>).arrival_window ?? null,
              customer: `${(booking as Record<string, unknown>).first_name || ""} ${(booking as Record<string, unknown>).last_name || ""}`.trim(),
              total_estimate_cents: (booking as Record<string, unknown>).total_estimate_cents ?? null,
              before_sent: !!(booking as Record<string, unknown>).before_photo_link_sent_at,
              after_sent: !!(booking as Record<string, unknown>).after_photo_link_sent_at,
            }
            : null,
        };
      };

      const offers = rows
        .filter((a) => OFFER_STATUSES.includes(String(a.status || "").toLowerCase()))
        .map(shape);
      const jobs = rows
        .filter((a) => ACTIVE_JOB_STATUSES.includes(String(a.status || "").toLowerCase()))
        .map(shape);

      return json({ ok: true, offers, jobs });
    }

    // ─── CHECK IN ON BEHALF ──────────────────────────────────────────────
    if (action === "check_in") {
      const assignmentId = String(body?.assignmentId || "");
      if (!assignmentId) return json({ error: "assignmentId required" }, 400);

      const { data: assignment } = await admin
        .from("job_assignments")
        .select("id, job_id, cleaner_id, status")
        .eq("id", assignmentId)
        .maybeSingle();
      if (!assignment) return json({ error: "Assignment not found" }, 404);
      const st = String(assignment.status || "").toLowerCase();
      if (!ACTIVE_JOB_STATUSES.includes(st)) {
        return json({ error: `Can't check in — the assignment is ${assignment.status}. Accept the offer first.` }, 409);
      }

      const { data: result, error: invErr } = await admin.functions.invoke("job-check-in", {
        body: { jobAssignmentId: assignmentId, action: "check_in", cleanerId: assignment.cleaner_id },
      });
      if (invErr) return json({ error: `Check-in failed: ${invErr.message}` }, 502);
      const payload = (result || {}) as Record<string, unknown>;
      if (payload.error) return json({ error: String(payload.error) }, 409);

      await admin.from("events").insert({
        event_type: "job.admin_check_in",
        cleaner_id: assignment.cleaner_id,
        job_id: assignment.job_id,
        source: "admin-cleaner-jobs",
        summary: "Admin checked the cleaner in / started the job on their behalf",
        data: { assignment_id: assignmentId, by: callerId },
      }).then(() => undefined, () => undefined);

      return json({
        ok: true,
        action: "check_in",
        alreadyCheckedIn: payload.alreadyCheckedIn === true,
        checkInTime: payload.checkInTime ?? null,
      });
    }

    // ─── ACCEPT / DECLINE ON BEHALF ───────────────────────────────────────
    if (action === "accept" || action === "decline") {
      const assignmentId = String(body?.assignmentId || "");
      if (!assignmentId) return json({ error: "assignmentId required" }, 400);

      const { data: assignment } = await admin
        .from("job_assignments")
        .select("id, job_id, cleaner_id, status, response_token, expires_at")
        .eq("id", assignmentId)
        .maybeSingle();
      if (!assignment) return json({ error: "Assignment not found" }, 404);

      const status = String(assignment.status || "").toLowerCase();
      if (action === "accept" && (status === "confirmed" || status === "accepted")) {
        return json({ ok: true, status: "already_accepted" });
      }
      if (action === "accept" && !OFFER_STATUSES.includes(status)) {
        return json({ error: `This offer can't be accepted (current status: ${assignment.status}).` }, 409);
      }

      // Ensure there's a token to drive the shared accept path.
      let token = assignment.response_token as string | null;
      if (!token) {
        token = randomToken();
        await admin.from("job_assignments").update({ response_token: token }).eq("id", assignmentId);
      }

      // Admin override of the offer-expiry window (accept-job-offer 410s on
      // an expired offer). Push expiry an hour out so the deliberate admin
      // action always lands.
      if (action === "accept") {
        await admin
          .from("job_assignments")
          .update({ expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
          .eq("id", assignmentId);
      }

      const { data: result, error: invErr } = await admin.functions.invoke("accept-job-offer", {
        body: { token, action },
      });
      if (invErr) return json({ error: `Could not ${action} on behalf: ${invErr.message}` }, 502);
      const payload = (result || {}) as Record<string, unknown>;
      if (payload.ok === false) {
        // Surface overlap / taken / expired reasons to the admin verbatim.
        return json({
          ok: false,
          reason: payload.reason ?? "failed",
          error: String(payload.message || `Could not ${action} this offer.`),
        }, 409);
      }

      await admin.from("events").insert({
        event_type: action === "accept" ? "job.assignment.admin_accepted" : "job.assignment.admin_declined",
        cleaner_id: assignment.cleaner_id,
        job_id: assignment.job_id,
        source: "admin-cleaner-jobs",
        summary: `Admin ${action === "accept" ? "accepted" : "declined"} a job offer on the cleaner's behalf`,
        data: { assignment_id: assignmentId, by: callerId },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, action, status: payload.status ?? "ok", checklistUrl: payload.checklistUrl ?? null });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-cleaner-jobs]", msg);
    return json({ error: msg }, msg.includes("signed in") || msg.includes("only") ? 401 : 500);
  }
});
