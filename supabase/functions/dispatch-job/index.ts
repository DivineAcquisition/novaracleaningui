import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  buildJobOfferSmsMessage,
  offerExpiresAtFromNow,
  sendJobOfferSms,
} from "../_shared/job-offer-sms.ts";
import { scoreCleanerForJob } from "../_shared/dispatch-scoring.ts";
import { autoOffersEnabled, requestDispatchApproval } from "../_shared/dispatch-approval.ts";
import { formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { checkScheduleBuffer } from "../_shared/schedule-buffer.ts";

// Pull the human-readable date + arrival window for a job from its linked
// booking. We display the booking's stored time_slot (e.g. "8-12" →
// "8:00 AM – 12:00 PM") instead of re-deriving from the job's stored
// timestamp, which avoids any UTC/ET drift in the SMS the cleaner sees.
async function getJobWhenLabels(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  jobId: string,
  fallbackStartDatetime?: string | null,
): Promise<{ dateLabel: string; arrivalWindow: string }> {
  let serviceDate: string | null = null;
  let timeSlot: string | null = null;
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("service_date, time_slot, arrival_window")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    serviceDate = b?.service_date ?? null;
    timeSlot = b?.time_slot ?? b?.arrival_window ?? null;
  } catch (_) { /* fall back below */ }

  const dateLabel = serviceDate
    ? formatServiceDate(serviceDate)
    : (fallbackStartDatetime
      ? new Date(fallbackStartDatetime).toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "");
  return { dateLabel, arrivalWindow: formatTimeSlot(timeSlot) };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DISPATCH] ${step}${detailsStr}`);
};

// Cleaner scoring (location / rating / workload / performance + the
// preferred-day soft penalty) lives in ../_shared/dispatch-scoring.ts
// so this auto-dispatch path and the manual VA-assign path score
// candidates with one identical formula. See scoreCleanerForJob.

/**
 * Broadcast fallback: when scoring returns ZERO qualified cleaners (or
 * there are no eligible cleaners at all), instead of throwing and
 * leaving the operator to find out via the dispatch_alerts table, we
 * SMS every active cleaner in the directory via GHL with a "first to
 * claim" link. The first cleaner to hit /cleaner/job-claim/<token>
 * wins; the rest see "already taken" when they tap the link.
 *
 * We insert one job_assignments row per active cleaner with status =
 * 'Broadcast' and a per-cleaner response_token. The claim endpoint
 * (`accept-job-offer`) atomically flips the winning row to 'Confirmed'
 * and bulk-cancels the others to 'Broadcast_Lost'.
 *
 * Also stamps the job row with a dispatch_alert so the admin map / 
 * dashboard surfaces the broadcast for human review.
 */
async function broadcastJob(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  job: any,
  reason: string,
): Promise<{ broadcastSent: number; broadcastSkipped: number; reason: string }> {
  await supabase.from("dispatch_alerts").insert({
    job_id: job.id,
    reason: `Broadcast fallback: ${reason}`,
    severity: "warning",
  }).then(() => undefined).catch(() => undefined);

  await supabase
    .from("jobs")
    .update({
      status: "Broadcast",
      manual_intervention_required: false,
      dispatch_alert_reason: `Broadcast — ${reason}`,
    })
    .eq("id", job.id)
    .then(() => undefined).catch(() => undefined);

  const { data: all } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, phone, email, sms_notifications_enabled")
    .eq("approved", true)
    .eq("available_for_bookings", true)
    .eq("status", "active");

  const eligible = (all || []).filter((c: any) => !!c.phone);
  if (eligible.length === 0) {
    return { broadcastSent: 0, broadcastSkipped: 0, reason: "no_active_cleaners" };
  }

  // Build the assignment rows + per-cleaner tokens
  const rows = eligible.map((c: any) => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    return {
      job_id: job.id,
      cleaner_id: c.id,
      status: "Broadcast",
      role: "Broadcast",
      response_token: token,
    };
  });

  const { data: inserted, error: insertErr } = await supabase
    .from("job_assignments")
    .insert(rows)
    .select("id, cleaner_id, response_token");
  if (insertErr) {
    logStep("broadcast insert failed", { err: insertErr.message });
    return { broadcastSent: 0, broadcastSkipped: 0, reason: "insert_failed" };
  }

  const { dateLabel: jobDateFormatted, arrivalWindow } = await getJobWhenLabels(
    supabase,
    job.id,
    job.start_datetime,
  );
  const whenLine = arrivalWindow
    ? `Date: ${jobDateFormatted}\nArrival: ${arrivalWindow}\n`
    : `Date: ${jobDateFormatted}\n`;
  const baseMsg = `🧹 Open Job — first to claim wins!\n\n${whenLine}Location: ${job.city || ""} ${job.zip || ""}\n~${job.duration_est_hours || 2.5} hrs · revenue share pay\n\nTap to grab it:`;

  let sent = 0; let skipped = 0;
  for (const c of eligible) {
    const row = (inserted || []).find((r: any) => r.cleaner_id === c.id);
    if (!row || !c.sms_notifications_enabled) { skipped++; continue; }
    const url = `https://contractor.novaracleaning.com/cleaner/job-offer/${row.response_token}`;
    try {
      await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone: c.phone,
          email: c.email || undefined,
          firstName: c.first_name || undefined,
          lastName: c.last_name || undefined,
          message: `${baseMsg}\n${url}\n\nReply STOP to opt out.`,
          type: "job_broadcast",
        },
      });
      sent++;
    } catch (_) {
      skipped++;
    }
  }
  logStep("Broadcast complete", { sent, skipped, reason });
  return { broadcastSent: sent, broadcastSkipped: skipped, reason };
}

/**
 * Check for scheduling conflicts
 */
async function hasSchedulingConflict(
  supabase: any,
  cleanerId: string,
  jobStartDatetime: string,
  durationHours: number
): Promise<boolean> {
  const jobEndDatetime = new Date(
    new Date(jobStartDatetime).getTime() + durationHours * 60 * 60 * 1000
  ).toISOString();

  const { data: conflicts } = await supabase
    .from("job_assignments")
    .select("id, jobs(start_datetime, duration_est_hours)")
    .eq("cleaner_id", cleanerId)
    .in("status", ["Offered", "Confirmed", "In Progress"]);

  if (!conflicts || conflicts.length === 0) return false;

  for (const assignment of conflicts) {
    const existingStart = new Date(assignment.jobs.start_datetime);
    const existingEnd = new Date(
      existingStart.getTime() + assignment.jobs.duration_est_hours * 60 * 60 * 1000
    );
    const newStart = new Date(jobStartDatetime);
    const newEnd = new Date(jobEndDatetime);

    // Check if there's an overlap
    if (newStart < existingEnd && newEnd > existingStart) {
      return true;
    }
  }

  return false;
}

/**
 * Auto-dispatch algorithm with comprehensive scoring:
 * 1. Filter by hard requirements
 * 2. Calculate match scores (location, rating, workload, performance)
 * 3. Check for conflicts
 * 4. Select best candidates
 * 5. Create job assignments and send notifications
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = body?.jobId as string;
    const backfill = body?.backfill === true;
    // Explicit admin sign-off carried by the caller (Dispatch console /
    // Bookings "send offers", or auto-dispatch-booking after its own gate).
    const approved = body?.approved === true || body?.sendOffers === true;
    logStep("Starting dispatch", { jobId, backfill, approved });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ─── HARD GATE (defense-in-depth) ────────────────────────────────────
    // Offer SMS may ONLY leave this function when the call carries the
    // admin-approval flag, or the operator explicitly re-enabled
    // auto-offers in app_settings. Any legacy/stale caller that invokes
    // dispatch-job without the flag parks the job in the Dispatch console
    // approval queue instead of texting contractors.
    if (!approved && !(await autoOffersEnabled(supabase))) {
      logStep("Blocked un-approved offer send — parking job for admin approval", { jobId });
      await requestDispatchApproval(
        supabase,
        jobId,
        "Offer send attempted without admin approval — approve to text cleaners",
      );
      return new Response(
        JSON.stringify({
          success: false,
          pendingApproval: true,
          offersSent: 0,
          noCleanersAvailable: false,
          reason: "approval_required",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    // If the job row is missing coordinates, try one geocode pass before
    // giving up — auto-dispatch-booking should have populated them, but
    // we've seen rows slip through (e.g. when geocode-address timed out
    // during the post-confirm fanout). One retry here lets dispatch
    // continue instead of hard-failing on cold-start.
    if (!job.lat || !job.lng) {
      try {
        const geo = await supabase.functions.invoke("geocode-address", {
          body: {
            address: job.address,
            city: job.city,
            state: job.state,
            zip: job.zip,
          },
        });
        // deno-lint-ignore no-explicit-any
        const g = (geo?.data as any) || {};
        if (g.lat && g.lng) {
          await supabase
            .from("jobs")
            .update({ lat: g.lat, lng: g.lng })
            .eq("id", jobId);
          job.lat = g.lat;
          job.lng = g.lng;
          logStep("Job geocoded on dispatch", { lat: job.lat, lng: job.lng });
        }
      } catch (geoErr) {
        logStep("dispatch geocode retry failed", { err: String((geoErr as Error).message) });
      }
    }
    if (!job.lat || !job.lng) {
      // We CAN still broadcast — no eligibility filter requires lat/lng.
      // Fall through and let the broadcast path pick it up. Just log.
      logStep("Job missing coordinates — distance scoring will skip; broadcast fallback available");
    }

    logStep("Job details", { 
      minCleaners: job.min_cleaners_required,
      location: `${job.city}, ${job.state}`,
      sqft: job.sq_ft,
      datetime: job.start_datetime
    });

    const { count: alreadyConfirmed } = await supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId)
      .or("status.ilike.confirmed,status.ilike.accepted");

    const { data: existingOnJob } = await supabase
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", jobId);

    const blockedCleanerIds = new Set(
      (existingOnJob || [])
        .filter((a: { status: string }) => {
          const s = String(a.status || "").toLowerCase();
          return [
            "offered", "confirmed", "accepted", "assigned", "in progress", "broadcast",
            "declined", "expired", "withdrawn", "broadcast_lost",
          ].includes(s);
        })
        .map((a: { cleaner_id: string }) => a.cleaner_id),
    );

    let slotsToFill = Math.max(0, (job.min_cleaners_required || 1) - (alreadyConfirmed ?? 0));
    if (backfill && slotsToFill === 0) {
      logStep("Backfill skipped — team already confirmed", { alreadyConfirmed });
      return new Response(
        JSON.stringify({ success: true, assignedCleaners: alreadyConfirmed ?? 0, backfill: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    if (slotsToFill === 0) slotsToFill = job.min_cleaners_required || 1;

    // Get current day of week
    const jobDate = new Date(job.start_datetime);
    const dayAbbrev = jobDate.toLocaleDateString('en-US', { weekday: 'long' }).substring(0, 3);

    // STAGE 1: Hard Requirements Filtering
    const { data: cleaners, error: cleanersError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("approved", true)
      .eq("available_for_bookings", true)
      .eq("status", "active")
      .not("home_lat", "is", null)
      .not("home_lng", "is", null);

    if (cleanersError) {
      throw new Error(`Error fetching cleaners: ${cleanersError.message}`);
    }

    if (!cleaners || cleaners.length === 0) {
      logStep("No active cleaners in directory");
      return new Response(
        JSON.stringify({
          success: false,
          noCleanersAvailable: true,
          offersSent: 0,
          reason: "no_active_cleaners",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    logStep(`Found ${cleaners.length} approved cleaners`);

    // Get upcoming jobs count for each cleaner. NOTE: a PostgREST
    // `.gte("jobs.start_datetime", …)` filter on the embedded `jobs`
    // table is silently ignored — it filtered nothing, so every past
    // Offered/Confirmed assignment inflated the workload count and made
    // cleaners look busier than they are. We pull start_datetime and
    // window to "now or later" in JS instead.
    const cleanerIds = cleaners.map(c => c.id);
    const nowMs = Date.now();
    const { data: upcomingJobsData } = await supabase
      .from("job_assignments")
      .select("cleaner_id, jobs(start_datetime)")
      .in("cleaner_id", cleanerIds)
      .in("status", ["Offered", "Confirmed"]);

    const upcomingJobsMap = new Map();
    upcomingJobsData?.forEach((assignment: any) => {
      const startRaw = assignment.jobs?.start_datetime;
      if (!startRaw || new Date(startRaw).getTime() < nowMs) return;
      const count = upcomingJobsMap.get(assignment.cleaner_id) || 0;
      upcomingJobsMap.set(assignment.cleaner_id, count + 1);
    });

    // STAGE 2: Calculate Scores and Apply Soft Filters
    //
    // Scoring is delegated to the shared `scoreCleanerForJob` so the
    // auto-dispatch path and the manual VA-assign path (admin-booking-
    // assign) use ONE formula. dispatch-job adds three extra hard gates
    // the shared scorer doesn't cover: the blocked-cleaner set (already
    // offered/declined on this job), a DB-backed schedule overlap
    // check across the cleaner's other assignments, and the schedule
    // buffer.
    //
    // The buffer gate matters most here: an offer a cleaner can't accept
    // without eating their breathing room is worse than no offer at all —
    // they'd accept, the guard would refuse the commitment, and the job
    // would look staffed while nobody was coming.
    const { data: dispatchBooking } = await supabase
      .from("bookings")
      .select("id")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const bufferBlocked = new Set<string>();
    if (dispatchBooking?.id) {
      const bufferView = await checkScheduleBuffer(supabase, {
        bookingId: dispatchBooking.id,
        cleanerIds: cleaners.map((c: { id: string }) => c.id),
      });
      for (const c of bufferView.conflicts || []) {
        if (c.cleaner_id) bufferBlocked.add(c.cleaner_id);
      }
    }

    const scoredCandidates = [];

    for (const cleaner of cleaners) {
      if (blockedCleanerIds.has(cleaner.id)) continue;

      const upcomingCount = upcomingJobsMap.get(cleaner.id) || 0;
      const result = scoreCleanerForJob(
        { ...cleaner, upcoming_jobs_count: upcomingCount },
        { lat: job.lat, lng: job.lng, weekday: dayAbbrev },
      );

      if (!result.available) {
        if (result.reason === "at_capacity") {
          logStep(`Cleaner ${cleaner.first_name} at max capacity`, { upcomingCount });
        }
        continue;
      }

      // Check for scheduling conflicts (hard requirement, dispatch-only)
      const hasConflict = await hasSchedulingConflict(
        supabase,
        cleaner.id,
        job.start_datetime,
        job.duration_est_hours
      );

      if (hasConflict) {
        logStep(`Cleaner ${cleaner.first_name} has scheduling conflict`);
        continue;
      }

      if (bufferBlocked.has(cleaner.id)) {
        logStep(`Cleaner ${cleaner.first_name} skipped — no schedule buffer around their other job`);
        continue;
      }

      scoredCandidates.push({
        ...cleaner,
        distance_miles: result.distance != null ? Math.round(result.distance * 10) / 10 : null,
        upcoming_jobs_count: upcomingCount,
        match_score: Math.round(result.score * 10) / 10,
        score_breakdown: result.breakdown ?? {
          location: 0,
          rating: 0,
          workload: 0,
          performance: 0,
          works_today: result.worksToday ?? true,
        }
      });
    }

    if (scoredCandidates.length === 0) {
      logStep("No new qualified candidates after scoring (pool exhausted for this job)");
      return new Response(
        JSON.stringify({
          success: false,
          noCleanersAvailable: true,
          offersSent: 0,
          reason: "no_qualified_candidates",
          openSlots: slotsToFill,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    logStep(`${scoredCandidates.length} qualified candidates found`);

    // STAGE 3: Sort by match score and select top N
    scoredCandidates.sort((a, b) => b.match_score - a.match_score);

    const selectedCleaners = scoredCandidates.slice(0, slotsToFill);

    if (selectedCleaners.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          noCleanersAvailable: true,
          offersSent: 0,
          reason: "no_selection",
          openSlots: slotsToFill,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check if we have enough cleaners
    if (selectedCleaners.length < slotsToFill) {
      logStep("Insufficient cleaners", {
        required: slotsToFill,
        available: selectedCleaners.length
      });

      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: `Only ${selectedCleaners.length} of ${job.min_cleaners_required} required cleaners available`,
        severity: "warning"
      });

      // Continue with available cleaners but flag for review
      await supabase
        .from("jobs")
        .update({ 
          status: "Dispatching",
          dispatch_alert_reason: `Insufficient cleaners (${selectedCleaners.length}/${slotsToFill})`
        })
        .eq("id", jobId);
    }

    logStep(`Selected ${selectedCleaners.length} cleaners`, {
      cleaners: selectedCleaners.map(c => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        score: c.match_score,
        distance: c.distance_miles,
        breakdown: c.score_breakdown
      }))
    });

    // STAGE 4: Create job assignments with estimated pay (revenue share)
    //
    // Pay is now a flat percentage of customer-paid job revenue, NOT
    // hourly. Pull the linked booking to get the revenue, then:
    //   pool = revenue_cents × max(payPercentage among cleaners) / 100
    //   per-cleaner = pool / cleaner_count
    //
    // Mixed-tier jobs use the HIGHEST tier on the team so a Foundation
    // cleaner working alongside an Elite cleaner still gets the 50%
    // pool share split.
    const { data: linkedBooking } = await supabase
      .from("bookings")
      .select("id, total_estimate_cents, final_charge_cents")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const revenueCents = Number(
      linkedBooking?.final_charge_cents || linkedBooking?.total_estimate_cents || 0,
    );
    const cleanerCount = Math.max(1, selectedCleaners.length);
    const teamMaxPct = selectedCleaners.reduce((m: number, c: any) => {
      const p = Number(c.pay_percentage) || 35;
      return p > m ? p : m;
    }, 35);
    const poolCents = Math.floor((revenueCents * teamMaxPct) / 100);
    const perCleanerPayCents = Math.floor(poolCents / cleanerCount);

    const expiresAtIso = offerExpiresAtFromNow();

    const assignments = selectedCleaners.map((cleaner, index) => {
      const tokenBytes = new Uint8Array(16);
      crypto.getRandomValues(tokenBytes);
      const responseToken = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      return {
        job_id: jobId,
        cleaner_id: cleaner.id,
        distance_miles: cleaner.distance_miles,
        role: index === 0 && (alreadyConfirmed ?? 0) === 0 ? "Lead" : "Support",
        status: "Offered",
        pay_rate_hr: cleaner.pay_rate_hr || 18,
        pay_percentage_snapshot: teamMaxPct,
        estimated_pay_cents: perCleanerPayCents,
        expires_at: expiresAtIso,
        response_token: responseToken,
      };
    });

    const { data: createdAssignments, error: assignError } = await supabase
      .from("job_assignments")
      .insert(assignments)
      .select("*, cleaners(*)");

    if (assignError) {
      throw new Error(`Error creating assignments: ${assignError.message}`);
    }

    // STAGE 5: SMS proximity-selected cleaners (10 min window, dedicated from #)
    logStep("Sending job-offer SMS to auto-selected cleaners");
    const teamSize = cleanerCount;
    const expiresAtDate = new Date(expiresAtIso);
    const { dateLabel: jobDateFormatted, arrivalWindow } = await getJobWhenLabels(
      supabase,
      jobId,
      job.start_datetime,
    );

    const smsPromises = createdAssignments.map(async (assignment: any) => {
      const c = assignment.cleaners;
      if (!c?.phone || c.sms_notifications_enabled === false) {
        console.log(`[SMS] Skipping ${c?.first_name || "cleaner"} — no phone or SMS off`);
        return;
      }

      const token = assignment.response_token;
      const offerUrl = `https://contractor.novaracleaning.com/cleaner/job-offer/${token}`;
      const sharePct = assignment.pay_percentage_snapshot || c.pay_percentage || 35;

      const message = buildJobOfferSmsMessage({
        jobDateFormatted,
        arrivalWindow,
        city: job.city || "",
        zip: job.zip || "",
        durationHours: Number(job.duration_est_hours) || 3,
        distanceMiles: Number(assignment.distance_miles) || 0,
        role: assignment.role || "Support",
        teamSize,
        perCleanerPayCents: assignment.estimated_pay_cents || perCleanerPayCents,
        sharePct,
        revenueCents,
        teamPoolCents: poolCents,
        offerUrl,
        expiresAt: expiresAtDate,
      });

      const result = await sendJobOfferSms(supabase, {
        phone: c.phone,
        email: c.email,
        firstName: c.first_name,
        lastName: c.last_name,
        message,
        jobId,
        assignmentId: assignment.id,
      });
      if (!result.ok) {
        console.error(`[SMS] Offer failed for ${c.first_name}:`, result.error);
      }

    });

    await Promise.all(smsPromises);
    logStep("Job-offer SMS sent", { count: createdAssignments.length, from: "+14432744402" });

    // STAGE 6: Job stays Offered until enough cleaners confirm (see accept-job-offer)
    const totalOffered = (alreadyConfirmed ?? 0) + selectedCleaners.length;
    await supabase
      .from("jobs")
      .update({
        status: totalOffered >= (job.min_cleaners_required || 1) ? "Offered" : "Dispatching",
      })
      .eq("id", jobId);

    // Trigger Zapier webhook
    try {
      logStep("Triggering Zapier webhook");
      await supabase.functions.invoke("send-zapier-webhook", {
        body: { jobId: jobId }
      });
    } catch (webhookError) {
      console.error("[WEBHOOK] Failed to send:", webhookError);
    }

    // Update cleaner scores in background (non-blocking)
    try {
      await supabase.functions.invoke("update-cleaner-scores", {
        body: { cleanerId: null } // Update all
      });
    } catch (scoreError) {
      console.error("[SCORES] Failed to update:", scoreError);
    }

    logStep("Dispatch complete", { assignmentCount: assignments.length });

    return new Response(
      JSON.stringify({
        success: true,
        offersSent: createdAssignments?.length ?? selectedCleaners.length,
        assignedCleaners: selectedCleaners.length,
        noCleanersAvailable: false,
        backfill,
        required: job.min_cleaners_required,
        cleaners: selectedCleaners.map(c => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          distance: c.distance_miles,
          score: c.match_score,
          breakdown: c.score_breakdown,
          role: c === selectedCleaners[0] ? "Lead" : "Support"
        }))
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
