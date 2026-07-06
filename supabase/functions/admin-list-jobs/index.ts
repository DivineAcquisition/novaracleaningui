// admin-list-jobs
//
// Read API powering the admin Dispatch console. Returns dispatch jobs with
// their linked booking summary + cleaner assignments + live contractor
// checklist progress + add-on approval requests, plus the set of confirmed
// bookings that don't have a job yet (so the operator can kick off
// dispatch for them) and the dispatch feature settings (contractor
// add-ons on/off, auto-offers on/off). Admin/VA gated; service role.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

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

function localYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string) {
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
    await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 500);
    const dateRange = String(body?.dateRange || "active").toLowerCase();

    // ─── Jobs ───────────────────────────────────────────────────────────
    let jq = admin
      .from("jobs")
      .select(
        "id, status, service_type, sq_ft, bedrooms, bathrooms, address, city, state, zip, start_datetime, duration_est_hours, min_cleaners_required, manual_intervention_required, dispatch_alert_reason, created_at",
      );

    const today = localYmd();
    if (dateRange === "active") {
      // Upcoming or undated jobs that aren't finished/cancelled.
      jq = jq.or(`start_datetime.gte.${today}T00:00:00,start_datetime.is.null`);
    } else if (dateRange === "next_14") {
      const end = new Date();
      end.setDate(end.getDate() + 14);
      jq = jq.gte("start_datetime", `${today}T00:00:00`).lte("start_datetime", `${localYmd(end)}T23:59:59`);
    } else if (dateRange === "past_7") {
      const past = new Date();
      past.setDate(past.getDate() - 7);
      jq = jq.gte("start_datetime", `${localYmd(past)}T00:00:00`);
    }

    const { data: jobsData, error: jobsErr } = await jq
      .order("start_datetime", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (jobsErr) throw jobsErr;

    const jobs = (jobsData || []) as Record<string, unknown>[];
    const jobIds = jobs.map((j) => String(j.id));

    // ─── Assignments + cleaner names ────────────────────────────────────
    const assignmentsByJob = new Map<string, Record<string, unknown>[]>();
    if (jobIds.length > 0) {
      const { data: assigns } = await admin
        .from("job_assignments")
        .select(
          "id, job_id, cleaner_id, role, status, distance_miles, estimated_pay_cents, pay_percentage_snapshot, expires_at, accepted_at, declined_at, created_at",
        )
        .in("job_id", jobIds);

      const cleanerIds = Array.from(
        new Set((assigns || []).map((a) => a.cleaner_id).filter(Boolean) as string[]),
      );
      const cleanerNames = new Map<string, string>();
      if (cleanerIds.length > 0) {
        const { data: cleaners } = await admin
          .from("cleaners")
          .select("id, first_name, last_name, phone")
          .in("id", cleanerIds);
        for (const c of cleaners || []) {
          cleanerNames.set(
            String(c.id),
            `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
          );
        }
      }

      for (const a of assigns || []) {
        const jid = String(a.job_id);
        const list = assignmentsByJob.get(jid) || [];
        list.push({ ...a, cleaner_name: cleanerNames.get(String(a.cleaner_id)) || null });
        assignmentsByJob.set(jid, list);
      }
    }

    // ─── Booking summary per job (date/time the customer booked) ─────────
    const bookingByJob = new Map<string, Record<string, unknown>>();
    if (jobIds.length > 0) {
      const { data: bks } = await admin
        .from("bookings")
        .select(
          "id, booking_number, status, service_date, time_slot, arrival_window, first_name, last_name, phone, total_estimate_cents, add_ons, job_id",
        )
        .in("job_id", jobIds);
      for (const b of bks || []) {
        if (b.job_id) bookingByJob.set(String(b.job_id), b);
      }
    }

    // ─── Contractor checklist progress per job ────────────────────────────
    const checklistByJob = new Map<string, Record<string, unknown>>();
    if (jobIds.length > 0) {
      const { data: cls } = await admin
        .from("job_checklists")
        .select("job_id, token, service_type, total_items, completed_items, progress_pct, started_at, completed_at, last_activity_at, last_activity_by")
        .in("job_id", jobIds);
      for (const c of cls || []) {
        checklistByJob.set(String(c.job_id), c);
      }
    }

    // ─── Add-on approval requests per job (pending first) ────────────────
    const addonRequestsByJob = new Map<string, Record<string, unknown>[]>();
    if (jobIds.length > 0) {
      const { data: reqs } = await admin
        .from("job_addon_requests")
        .select("id, job_id, booking_id, cleaner_id, cleaner_name, addon_id, addon_label, amount_cents, cleaner_share_cents, note, status, charge_status, created_at, reviewed_at")
        .in("job_id", jobIds)
        .order("created_at", { ascending: false });
      for (const r of reqs || []) {
        const jid = String(r.job_id);
        const list = addonRequestsByJob.get(jid) || [];
        list.push(r);
        addonRequestsByJob.set(jid, list);
      }
    }

    const enriched = jobs.map((j) => ({
      ...j,
      booking: bookingByJob.get(String(j.id)) || null,
      assignments: assignmentsByJob.get(String(j.id)) || [],
      checklist: checklistByJob.get(String(j.id)) || null,
      addon_requests: addonRequestsByJob.get(String(j.id)) || [],
    }));

    // ─── Confirmed bookings with no job yet (need dispatch) ──────────────
    const { data: needsDispatch } = await admin
      .from("bookings")
      .select(
        "id, booking_number, status, service_date, time_slot, arrival_window, first_name, last_name, city, state, zip_code, total_estimate_cents",
      )
      .is("job_id", null)
      .in("status", ["confirmed", "pending_details"])
      .gte("service_date", today)
      .order("service_date", { ascending: true })
      .limit(100);

    // ─── Dispatch feature settings ────────────────────────────────────────
    const settings: Record<string, unknown> = {
      contractor_addons_enabled: true,
      dispatch_auto_offers_enabled: false,
    };
    try {
      const { data: settingRows } = await admin
        .from("app_settings")
        .select("key, value")
        .in("key", ["contractor_addons_enabled", "dispatch_auto_offers_enabled"]);
      for (const row of settingRows || []) {
        settings[String(row.key)] = row.value === true || row.value === "true";
      }
    } catch (_) { /* defaults stand */ }

    return json({
      success: true,
      jobs: enriched,
      unassignedBookings: needsDispatch || [],
      settings,
      filters: { dateRange, limit },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-list-jobs]", msg);
    return json({ error: msg }, 500);
  }
});
