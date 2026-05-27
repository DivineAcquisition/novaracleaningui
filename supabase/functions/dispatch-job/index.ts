import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DISPATCH] ${step}${detailsStr}`);
};

/**
 * Haversine formula to calculate distance between two lat/lng points in miles
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate location score (0-30 points)
 */
function calculateLocationScore(distanceMiles: number, maxTravelMiles: number): number {
  if (distanceMiles > maxTravelMiles) return 0;
  if (distanceMiles <= 5) return 30;
  if (distanceMiles <= 10) return 25;
  if (distanceMiles <= 15) return 20;
  if (distanceMiles <= 20) return 15;
  if (distanceMiles <= 25) return 10;
  return 5;
}

/**
 * Calculate rating score (0-25 points)
 */
function calculateRatingScore(averageRating: number | null, totalRatings: number | null): number {
  // New cleaners get benefit of doubt
  if (!averageRating || !totalRatings || totalRatings === 0) return 15;
  
  if (averageRating >= 5.0) return 25;
  if (averageRating >= 4.5) return 22;
  if (averageRating >= 4.0) return 18;
  if (averageRating >= 3.5) return 12;
  if (averageRating >= 3.0) return 8;
  return 4;
}

/**
 * Calculate workload score (0-25 points)
 */
function calculateWorkloadScore(upcomingJobsCount: number): number {
  if (upcomingJobsCount === 0) return 25;
  if (upcomingJobsCount <= 2) return 20;
  if (upcomingJobsCount <= 4) return 15;
  if (upcomingJobsCount <= 6) return 10;
  if (upcomingJobsCount <= 8) return 5;
  return 2;
}

/**
 * Calculate performance score (0-20 points)
 */
function calculatePerformanceScore(acceptanceRate: number | null, onTimeRate: number | null): number {
  const acceptanceScore = (acceptanceRate || 0) * 10; // Max 10 points
  const onTimeScore = (onTimeRate || 0) * 10; // Max 10 points
  return Math.round(acceptanceScore + onTimeScore);
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
    const { jobId } = await req.json();
    logStep("Starting dispatch", { jobId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    if (!job.lat || !job.lng) {
      throw new Error("Job location not geocoded");
    }

    logStep("Job details", { 
      minCleaners: job.min_cleaners_required,
      location: `${job.city}, ${job.state}`,
      sqft: job.sq_ft,
      datetime: job.start_datetime
    });

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
      logStep("No available cleaners found");
      
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: "No available cleaners found",
        severity: "critical"
      });

      await supabase
        .from("jobs")
        .update({ 
          status: "Dispatching",
          manual_intervention_required: true,
          dispatch_alert_reason: "No available cleaners"
        })
        .eq("id", jobId);

      throw new Error("No available cleaners");
    }

    logStep(`Found ${cleaners.length} approved cleaners`);

    // Get upcoming jobs count for each cleaner
    const cleanerIds = cleaners.map(c => c.id);
    const { data: upcomingJobsData } = await supabase
      .from("job_assignments")
      .select("cleaner_id, jobs(start_datetime)")
      .in("cleaner_id", cleanerIds)
      .in("status", ["Offered", "Confirmed"])
      .gte("jobs.start_datetime", new Date().toISOString());

    const upcomingJobsMap = new Map();
    upcomingJobsData?.forEach((assignment: any) => {
      const count = upcomingJobsMap.get(assignment.cleaner_id) || 0;
      upcomingJobsMap.set(assignment.cleaner_id, count + 1);
    });

    // STAGE 2: Calculate Scores and Apply Soft Filters
    const scoredCandidates = [];

    for (const cleaner of cleaners) {
      // Check preferred work days (soft filter)
      const worksToday = !cleaner.preferred_work_days || 
                         cleaner.preferred_work_days.length === 0 ||
                         cleaner.preferred_work_days.includes(dayAbbrev);

      // Calculate distance
      const distance = haversineDistance(
        cleaner.home_lat,
        cleaner.home_lng,
        job.lat,
        job.lng
      );

      // Check if within max travel distance (hard requirement)
      const withinDistance = distance <= (cleaner.max_travel_miles || 20);
      if (!withinDistance) continue;

      // Check max weekly bookings (hard requirement)
      const upcomingCount = upcomingJobsMap.get(cleaner.id) || 0;
      if (upcomingCount >= (cleaner.max_weekly_bookings || 10)) {
        logStep(`Cleaner ${cleaner.first_name} at max capacity`, { upcomingCount });
        continue;
      }

      // Check for scheduling conflicts (hard requirement)
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

      // Calculate comprehensive match score (0-100 points)
      const locationScore = calculateLocationScore(distance, cleaner.max_travel_miles || 20);
      const ratingScore = calculateRatingScore(cleaner.average_rating, cleaner.total_ratings);
      const workloadScore = calculateWorkloadScore(upcomingCount);
      const performanceScore = calculatePerformanceScore(cleaner.acceptance_rate, cleaner.on_time_rate);
      
      const totalScore = locationScore + ratingScore + workloadScore + performanceScore;

      // Soft penalty for working outside preferred days (reduce score by 10%)
      const finalScore = worksToday ? totalScore : totalScore * 0.9;

      scoredCandidates.push({
        ...cleaner,
        distance_miles: Math.round(distance * 10) / 10,
        upcoming_jobs_count: upcomingCount,
        match_score: Math.round(finalScore * 10) / 10,
        score_breakdown: {
          location: locationScore,
          rating: ratingScore,
          workload: workloadScore,
          performance: performanceScore,
          works_today: worksToday
        }
      });
    }

    if (scoredCandidates.length === 0) {
      logStep("No qualified candidates found");
      
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: "No cleaners meet requirements (distance, availability, conflicts)",
        severity: "critical"
      });

      await supabase
        .from("jobs")
        .update({ 
          status: "Dispatching",
          manual_intervention_required: true,
          dispatch_alert_reason: "No qualified cleaners"
        })
        .eq("id", jobId);

      throw new Error("No qualified candidates found");
    }

    logStep(`${scoredCandidates.length} qualified candidates found`);

    // STAGE 3: Sort by match score and select top N
    scoredCandidates.sort((a, b) => b.match_score - a.match_score);

    const selectedCleaners = scoredCandidates.slice(0, job.min_cleaners_required);

    // Check if we have enough cleaners
    if (selectedCleaners.length < job.min_cleaners_required) {
      logStep("Insufficient cleaners", {
        required: job.min_cleaners_required,
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
          dispatch_alert_reason: `Insufficient cleaners (${selectedCleaners.length}/${job.min_cleaners_required})`
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
      const p = Number(c.pay_percentage) || 40;
      return p > m ? p : m;
    }, 40);
    const poolCents = Math.floor((revenueCents * teamMaxPct) / 100);
    const perCleanerPayCents = Math.floor(poolCents / cleanerCount);

    const assignments = selectedCleaners.map((cleaner, index) => ({
      job_id: jobId,
      cleaner_id: cleaner.id,
      distance_miles: cleaner.distance_miles,
      role: index === 0 ? "Lead" : "Support",
      status: "Offered",
      // pay_rate_hr kept on the row for legacy back-compat (it's no
      // longer the source of truth — pay_percentage_snapshot is).
      pay_rate_hr: cleaner.pay_rate_hr || 18,
      pay_percentage_snapshot: teamMaxPct,
      estimated_pay_cents: perCleanerPayCents,
    }));

    const { data: createdAssignments, error: assignError } = await supabase
      .from("job_assignments")
      .insert(assignments)
      .select("*, cleaners(*)");

    if (assignError) {
      throw new Error(`Error creating assignments: ${assignError.message}`);
    }

    // STAGE 5: Send SMS notifications to cleaners
    logStep("Sending SMS notifications");
    const smsPromises = createdAssignments.map(async (assignment: any) => {
      if (!assignment.cleaners.sms_notifications_enabled) {
        console.log(`[SMS] Skipping ${assignment.cleaners.first_name} - SMS disabled`);
        return;
      }

      const jobDateFormatted = new Date(job.start_datetime).toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric' 
      });
      // SMS pay copy now reflects revenue share, not hourly. The
      // assignment.estimated_pay_cents already accounts for cleaner
      // count + tier %, so just format and ship.
      const estimatedPay = ((assignment.estimated_pay_cents || 0) / 100).toFixed(2);
      const sharePct = assignment.pay_percentage_snapshot
        || assignment.cleaners?.pay_percentage
        || 40;
      const tokenBytes = new Uint8Array(16);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      await supabase.from('job_assignments').update({ response_token: token }).eq('id', assignment.id);

      // Point cleaners at the in-portal token page, NOT the legacy
      // `respond-to-offer` HTML edge function. The portal page calls
      // `accept-job-offer`, which actually flips `bookings.cleaner_id`
      // for Lead roles — the legacy HTML accept path leaves that field
      // null, so `complete-booking` later fails with "No cleaner
      // assigned". Single source of truth, fewer edge cases.
      const offerUrl = `https://contractor.novaracleaning.com/cleaner/job-offer/${token}`;

      const message = `🧹 New Job Offer!

Date: ${jobDateFormatted}
Location: ${job.city}, ${job.zip}
Pay: $${estimatedPay} (${sharePct}% revenue share, ~${job.duration_est_hours}hrs)
Distance: ${assignment.distance_miles.toFixed(1)} miles

Respond within 15 min:
${offerUrl}

Open in the cleaner portal to accept or decline.`;

      try {
        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: assignment.cleaners.phone,
            message,
            type: "job_offer",
            jobAssignmentId: assignment.id
          }
        });
      } catch (smsError) {
        console.error(`[SMS] Failed to send to ${assignment.cleaners.first_name}:`, smsError);
      }
    });

    await Promise.all(smsPromises);
    logStep("SMS notifications sent");

    // STAGE 6: Update job status
    await supabase
      .from("jobs")
      .update({ status: "Assigned" })
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
        assignedCleaners: selectedCleaners.length,
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
