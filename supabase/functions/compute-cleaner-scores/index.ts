// compute-cleaner-scores
//
// The Novara scoring engine — computed from real data, never hardcoded.
// Runs every 6h from pg_cron and on demand from the admin console.
//
// Two separate signals + one derived, per cleaner:
//   • novara_score (RELIABILITY, 0–100) — weighted composite of
//       acceptance  — % of offers accepted (job_assignments history)
//       workload    — consistency/volume carried vs the fleet (workload_score)
//       volume      — total completed jobs (tenure; 50 jobs = full marks)
//   • quality_score (QUALITY, 0–100) —
//       customer rating (average_rating 0–5 → 0–100)
//       minus a severity-weighted QC-case penalty (cases per completed job
//       from the QC hub; critical 3× · high 2× · medium 1× · low 0.5×)
//   • overall_score — reliability/quality split (admin-weightable)
//
// Weights live in app_settings.scoring_weights. Active admin overrides
// (cleaner_score_overrides.active) PIN a field's value until cleared — the
// computed value is still calculated and recorded in the event log.
//
// HISTORY, NOT COUNTERS: the cleaners.total_offers_* / completed_bookings
// counters proved stale (0 for everyone while job_assignments and paid
// payouts showed real work). Every run derives the inputs from the raw
// ledgers front-to-end and BACKFILLS the counters, so the engine
// self-heals and the directory columns stay truthful:
//   offers    = job_assignments that reached a terminal answer
//               (accepted: Confirmed/In Progress/Accepted/Completed;
//                negative: Declined/Expired/Withdrawn;
//                excluded: Offered (pending) and Broadcast_Lost (lost the
//                race through no fault of theirs))
//   completed = distinct completed bookings where they were the assigned
//               cleaner OR were paid on the job (crew via manual_payouts)
//
// Tips are intentionally invisible to this engine (spec: a tip is a gift,
// not a performance metric).

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
const log = (m: string, d?: unknown) =>
  console.log(`[compute-cleaner-scores] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

interface Weights {
  acceptance: number;
  workload: number;
  volume: number;
  reliability: number;
  quality: number;
}
const DEFAULT_WEIGHTS: Weights = { acceptance: 40, workload: 30, volume: 30, reliability: 60, quality: 40 };

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

const QC_SEVERITY_WEIGHT: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0.5 };
const VOLUME_FULL_MARKS = 50; // completed jobs for a 100 volume score

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    // Weights (admin-configurable).
    const { data: wRow } = await supabase.from("app_settings").select("value").eq("key", "scoring_weights").maybeSingle();
    const w: Weights = { ...DEFAULT_WEIGHTS, ...(wRow?.value || {}) };
    const relSum = Math.max(1, w.acceptance + w.workload + w.volume);
    const ovSum = Math.max(1, w.reliability + w.quality);

    // Cleaner base data (skip terminated).
    const { data: cleaners } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, status, acceptance_rate, workload_score, completed_bookings, average_rating, total_offers_received, total_offers_accepted")
      .neq("status", "terminated")
      .limit(1000);
    if (!cleaners || cleaners.length === 0) return json({ ok: true, computed: 0 });

    const fleetMaxWorkload = Math.max(1, ...cleaners.map((c: Record<string, unknown>) => Number(c.workload_score) || 0));

    // ── Front-to-end history: offer outcomes from job_assignments ──
    const ACCEPTED_STATUSES = new Set(["confirmed", "in progress", "accepted", "completed"]);
    const NEGATIVE_STATUSES = new Set(["declined", "expired", "withdrawn"]);
    const offerStats = new Map<string, { accepted: number; negative: number }>();
    {
      const { data: assigns } = await supabase
        .from("job_assignments")
        .select("cleaner_id, status")
        .not("cleaner_id", "is", null)
        .limit(20000);
      for (const a of assigns || []) {
        const s = String(a.status || "").toLowerCase();
        const e = offerStats.get(a.cleaner_id) || { accepted: 0, negative: 0 };
        if (ACCEPTED_STATUSES.has(s)) e.accepted++;
        else if (NEGATIVE_STATUSES.has(s)) e.negative++;
        else { offerStats.set(a.cleaner_id, e); continue; } // Offered / Broadcast_Lost: no answer to score
        offerStats.set(a.cleaner_id, e);
      }
    }

    // ── Lifetime completed jobs: assigned-and-completed bookings ∪ paid
    //    crew payouts (covers second/third cleaners on crew jobs) ──
    const completedJobs = new Map<string, Set<string>>();
    const addCompleted = (cleanerId: string, bookingId: string) => {
      const s = completedJobs.get(cleanerId) || new Set<string>();
      s.add(bookingId);
      completedJobs.set(cleanerId, s);
    };
    {
      const { data: doneBookings } = await supabase
        .from("bookings")
        .select("id, cleaner_id")
        .eq("status", "completed")
        .not("cleaner_id", "is", null)
        .limit(20000);
      for (const b of doneBookings || []) addCompleted(b.cleaner_id, b.id);
      const { data: paidPayouts } = await supabase
        .from("manual_payouts")
        .select("cleaner_id, booking_id, cleaner_breakdown")
        .eq("status", "paid")
        .limit(20000);
      for (const p of paidPayouts || []) {
        if (p.cleaner_id && p.booking_id) addCompleted(p.cleaner_id, p.booking_id);
        // Crew splits: every cleaner in the breakdown completed the job.
        if (Array.isArray(p.cleaner_breakdown) && p.booking_id) {
          for (const entry of p.cleaner_breakdown) {
            const cid = String((entry as Record<string, unknown>)?.cleanerId || "");
            if (cid) addCompleted(cid, p.booking_id);
          }
        }
      }
    }

    // QC cases per cleaner (last 90 days), severity-weighted.
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: issues } = await supabase
      .from("qc_issues")
      .select("cleaner_id, severity")
      .not("cleaner_id", "is", null)
      .gte("created_at", since)
      .limit(5000);
    const qcWeight = new Map<string, number>();
    for (const i of issues || []) {
      const wgt = QC_SEVERITY_WEIGHT[String(i.severity)] ?? 1;
      qcWeight.set(i.cleaner_id, (qcWeight.get(i.cleaner_id) || 0) + wgt);
    }

    // Completed jobs per cleaner (last 90 days) for the per-job case rate.
    const { data: recentJobs } = await supabase
      .from("bookings")
      .select("cleaner_id")
      .eq("status", "completed")
      .not("cleaner_id", "is", null)
      .gte("completed_at", since)
      .limit(10000);
    const recentJobCount = new Map<string, number>();
    for (const b of recentJobs || []) {
      recentJobCount.set(b.cleaner_id, (recentJobCount.get(b.cleaner_id) || 0) + 1);
    }

    // Active overrides pin values.
    const { data: overrides } = await supabase
      .from("cleaner_score_overrides")
      .select("cleaner_id, field, new_value")
      .eq("active", true);
    const pinned = new Map<string, Map<string, number>>();
    for (const o of overrides || []) {
      if (o.new_value == null) continue;
      const m = pinned.get(o.cleaner_id) || new Map<string, number>();
      m.set(o.field, Number(o.new_value));
      pinned.set(o.cleaner_id, m);
    }

    const nowIso = new Date().toISOString();
    let computed = 0;
    for (const c of cleaners) {
      // Acceptance from the raw assignment history; fall back to the
      // legacy counters/rate only when there is no history at all.
      const hist = offerStats.get(c.id) || { accepted: 0, negative: 0 };
      const answered = hist.accepted + hist.negative;
      let acceptancePct: number;
      if (answered > 0) {
        acceptancePct = clamp((hist.accepted / answered) * 100);
      } else if ((Number(c.total_offers_received) || 0) > 0) {
        acceptancePct = clamp(((Number(c.total_offers_accepted) || 0) / Number(c.total_offers_received)) * 100);
      } else {
        const raw = Number(c.acceptance_rate) || 0;
        acceptancePct = clamp(raw <= 1 ? raw * 100 : raw);
      }

      const completedCount = Math.max(
        completedJobs.get(c.id)?.size || 0,
        Number(c.completed_bookings) || 0,
      );

      const workloadPct = clamp(((Number(c.workload_score) || 0) / fleetMaxWorkload) * 100);
      const volumePct = clamp((completedCount / VOLUME_FULL_MARKS) * 100);

      const novaraComputed = round1(
        (acceptancePct * w.acceptance + workloadPct * w.workload + volumePct * w.volume) / relSum,
      );

      // Quality: customer rating baseline (no rating yet → neutral 75),
      // minus the severity-weighted QC case rate.
      const rating = Number(c.average_rating) || 0;
      const ratingScore = rating > 0 ? clamp((rating / 5) * 100) : 75;
      const jobs90 = recentJobCount.get(c.id) || 0;
      const caseWeight = qcWeight.get(c.id) || 0;
      // Penalty: weighted cases per job × 35, capped at 60. One medium case
      // across 10 jobs ≈ −3.5; three high cases in 10 jobs ≈ −21.
      const penalty = jobs90 > 0 ? Math.min(60, (caseWeight / jobs90) * 35) : Math.min(60, caseWeight * 5);
      const qualityComputed = round1(clamp(ratingScore - penalty));

      const overallComputed = round1(
        (novaraComputed * w.reliability + qualityComputed * w.quality) / ovSum,
      );

      const pins = pinned.get(c.id);
      const novara = pins?.get("novara_score") ?? novaraComputed;
      const quality = pins?.get("quality_score") ?? qualityComputed;
      const overall = pins?.get("overall_score") ??
        (pins?.has("novara_score") || pins?.has("quality_score")
          ? round1((novara * w.reliability + quality * w.quality) / ovSum)
          : overallComputed);

      // Backfill the counters from history so the directory (acceptance %,
      // completed jobs) tells the same story as the scores.
      const counterPatch: Record<string, unknown> = {};
      if (answered > 0) {
        counterPatch.total_offers_received = answered;
        counterPatch.total_offers_accepted = hist.accepted;
        counterPatch.acceptance_rate = Math.round((hist.accepted / answered) * 100) / 100; // 0–1
      }
      if (completedCount > (Number(c.completed_bookings) || 0)) {
        counterPatch.completed_bookings = completedCount;
      }

      await supabase.from("cleaners").update({
        novara_score: novara,
        quality_score: quality,
        overall_score: overall,
        scores_computed_at: nowIso,
        ...counterPatch,
      }).eq("id", c.id);
      computed++;
    }

    log("computed", { cleaners: computed, weights: w });
    return json({ ok: true, computed, weights: w });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
