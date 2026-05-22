// dispatch-job v139 (2026-05-22)
//
// Changes from v138:
//   * SMS to cleaner now goes via send-ghl-sms (not send-sms-notification)
//   * Link points to https://contractor.novaracleaning.com/cleaner/job-offer/<token>
//     instead of the raw Supabase function URL
//   * Each assignment gets an expires_at = +60 min from offer time
//   * Up to 4 cleaners can be offered the same job (min_cleaners_required
//     still drives selection; we keep the scoring/conflict logic intact)
//   * Concurrency: the page + accept-job-offer check has_overlap_for_cleaner
//     before flipping to Confirmed so a cleaner can hold multiple jobs
//     simultaneously as long as time windows don't intersect.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CONTRACTOR_BASE = "https://contractor.novaracleaning.com";
const OFFER_TTL_MIN = 60;

const logStep = (s: string, d?: any) =>
  console.log(`[DISPATCH] ${s}${d ? ` - ${JSON.stringify(d)}` : ""}`);

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationScore(d: number, max: number) {
  if (d > max) return 0;
  if (d <= 5) return 30;
  if (d <= 10) return 25;
  if (d <= 15) return 20;
  if (d <= 20) return 15;
  if (d <= 25) return 10;
  return 5;
}
function ratingScore(avg: number | null, n: number | null) {
  if (!avg || !n) return 15;
  if (avg >= 5) return 25;
  if (avg >= 4.5) return 22;
  if (avg >= 4) return 18;
  if (avg >= 3.5) return 12;
  if (avg >= 3) return 8;
  return 4;
}
function workloadScore(c: number) {
  if (c === 0) return 25;
  if (c <= 2) return 20;
  if (c <= 4) return 15;
  if (c <= 6) return 10;
  if (c <= 8) return 5;
  return 2;
}
function perfScore(accept: number | null, onTime: number | null) {
  return Math.round(((accept || 0) * 10) + ((onTime || 0) * 10));
}

async function hasConflict(
  supabase: any,
  cleanerId: string,
  startIso: string,
  hours: number,
): Promise<boolean> {
  const endIso = new Date(new Date(startIso).getTime() + hours * 3600 * 1000).toISOString();
  const { data, error } = await supabase.rpc("has_overlap_for_cleaner", {
    _cleaner_id: cleanerId,
    _start_at: startIso,
    _end_at: endIso,
    _exclude_id: null,
  });
  if (error) {
    console.warn("[DISPATCH] overlap RPC error", error.message);
    return false;
  }
  return data === true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { jobId } = await req.json();
    logStep("start", { jobId });
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw new Error(`Job not found: ${jobErr?.message || ""}`);
    if (!job.lat || !job.lng) throw new Error("Job location not geocoded");

    const jobDate = new Date(job.start_datetime);
    const dayAbbrev = jobDate.toLocaleDateString("en-US", { weekday: "long" }).slice(0, 3);

    const { data: cleaners, error: cleanersErr } = await supabase
      .from("cleaners")
      .select("*")
      .eq("approved", true)
      .eq("available_for_bookings", true)
      .eq("status", "active")
      .not("home_lat", "is", null)
      .not("home_lng", "is", null);
    if (cleanersErr) throw new Error(cleanersErr.message);
    if (!cleaners?.length) {
      await supabase
        .from("dispatch_alerts")
        .insert({ job_id: jobId, reason: "No available cleaners found", severity: "critical" });
      await supabase
        .from("jobs")
        .update({
          status: "Dispatching",
          manual_intervention_required: true,
          dispatch_alert_reason: "No available cleaners",
        })
        .eq("id", jobId);
      throw new Error("No available cleaners");
    }

    const ids = cleaners.map((c: any) => c.id);
    const { data: upcoming } = await supabase
      .from("job_assignments")
      .select("cleaner_id, jobs(start_datetime)")
      .in("cleaner_id", ids)
      .in("status", ["Offered", "Confirmed"])
      .gte("jobs.start_datetime", new Date().toISOString());
    const upcomingMap = new Map<string, number>();
    (upcoming || []).forEach((r: any) =>
      upcomingMap.set(r.cleaner_id, (upcomingMap.get(r.cleaner_id) || 0) + 1),
    );

    const candidates: any[] = [];
    for (const c of cleaners) {
      const dist = haversineDistance(c.home_lat, c.home_lng, job.lat, job.lng);
      if (dist > (c.max_travel_miles || 20)) continue;
      const upc = upcomingMap.get(c.id) || 0;
      if (upc >= (c.max_weekly_bookings || 10)) continue;
      const overlap = await hasConflict(
        supabase,
        c.id,
        job.start_datetime,
        job.duration_est_hours || 3,
      );
      if (overlap) continue;
      const worksToday =
        !c.preferred_work_days?.length || c.preferred_work_days.includes(dayAbbrev);
      const total =
        locationScore(dist, c.max_travel_miles || 20) +
        ratingScore(c.average_rating, c.total_ratings) +
        workloadScore(upc) +
        perfScore(c.acceptance_rate, c.on_time_rate);
      candidates.push({
        ...c,
        distance_miles: Math.round(dist * 10) / 10,
        upcoming_jobs_count: upc,
        match_score: Math.round((worksToday ? total : total * 0.9) * 10) / 10,
      });
    }

    if (!candidates.length) {
      await supabase
        .from("dispatch_alerts")
        .insert({ job_id: jobId, reason: "No cleaners meet requirements", severity: "critical" });
      await supabase
        .from("jobs")
        .update({
          status: "Dispatching",
          manual_intervention_required: true,
          dispatch_alert_reason: "No qualified cleaners",
        })
        .eq("id", jobId);
      throw new Error("No qualified candidates found");
    }

    candidates.sort((a, b) => b.match_score - a.match_score);
    const need = Math.max(1, Number(job.min_cleaners_required || 1));
    const selected = candidates.slice(0, need);

    if (selected.length < need) {
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: `Only ${selected.length} of ${need} required cleaners available`,
        severity: "warning",
      });
    }

    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + OFFER_TTL_MIN * 60 * 1000).toISOString();

    const rows = selected.map((c, idx) => {
      const tokenBytes = new Uint8Array(16);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const estimatedPayCents = Math.round(
        (c.pay_rate_hr || 18) * (job.duration_est_hours || 3) * 100,
      );
      return {
        job_id: jobId,
        cleaner_id: c.id,
        distance_miles: c.distance_miles,
        role: idx === 0 ? "Lead" : "Support",
        status: "Offered",
        pay_rate_hr: c.pay_rate_hr || 18,
        estimated_pay_cents: estimatedPayCents,
        response_token: token,
        expires_at: expiresIso,
        assigned_at: nowIso,
      };
    });

    const { data: created, error: insErr } = await supabase
      .from("job_assignments")
      .insert(rows)
      .select("*, cleaners(*)");
    if (insErr) throw new Error(insErr.message);

    for (const c of selected) {
      try {
        await supabase
          .from("cleaners")
          .update({ total_offers_received: (c.total_offers_received || 0) + 1 })
          .eq("id", c.id);
      } catch { /* non-blocking */ }
    }

    const jobDateFormatted = new Date(job.start_datetime).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const startTime = new Date(job.start_datetime).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    await Promise.all(
      (created || []).map(async (a: any) => {
        if (!a.cleaners?.phone) return;
        if (a.cleaners.sms_notifications_enabled === false) return;
        const url = `${CONTRACTOR_BASE}/cleaner/job-offer/${a.response_token}`;
        const payDollars = ((a.estimated_pay_cents || 0) / 100).toFixed(0);
        const message =
          `🧹 Novara job offer ${jobDateFormatted} · ${startTime}\n` +
          `${job.city || ""}${job.zip ? " " + job.zip : ""} · ${a.distance_miles?.toFixed?.(1) || "?"} mi\n` +
          `Earn ~$${payDollars} · ${a.role || "Lead"}\n\n` +
          `Accept or decline within ${OFFER_TTL_MIN} min:\n${url}`;
        try {
          await supabase.functions.invoke("send-ghl-sms", {
            body: {
              phone: a.cleaners.phone,
              email: a.cleaners.email,
              firstName: a.cleaners.first_name,
              lastName: a.cleaners.last_name,
              message,
              type: "SMS",
            },
          });
        } catch (err) {
          console.warn(`[DISPATCH] SMS via GHL failed for ${a.cleaners.first_name}:`, err);
        }
        try {
          await supabase.from("sms_logs").insert({
            to_phone: a.cleaners.phone,
            type: "job_offer",
            message,
            status: "sent",
            cleaner_id: a.cleaner_id,
            job_assignment_id: a.id,
          });
        } catch { /* non-blocking */ }
      }),
    );

    await supabase.from("jobs").update({ status: "Assigned" }).eq("id", jobId);

    try { await supabase.functions.invoke("send-zapier-webhook", { body: { jobId } }); } catch { /* non-blocking */ }

    return new Response(
      JSON.stringify({
        success: true,
        assignedCleaners: selected.length,
        required: need,
        cleaners: selected.map((c, idx) => ({
          id: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
          distance: c.distance_miles,
          score: c.match_score,
          role: idx === 0 ? "Lead" : "Support",
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
