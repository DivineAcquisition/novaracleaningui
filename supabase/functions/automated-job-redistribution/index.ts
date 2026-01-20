/**
 * Automated Job Redistribution Function
 * 
 * Handles automatic redistribution of jobs when cleaners decline or don't respond.
 * Implements priority escalation: Normal → High → Urgent
 * 
 * Escalation Rules:
 * - Normal (30 min response): Initial assignment
 * - High (20 min response): After 2 declines OR 2+ hours elapsed
 * - Urgent (15 min response): After 3 declines OR 4+ hours elapsed
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[REDISTRIBUTION] ${step}${detailsStr}`);
};

// Priority configuration
const PRIORITY_CONFIG = {
  normal: { responseMinutes: 30, label: 'Normal' },
  high: { responseMinutes: 20, label: 'High' },
  urgent: { responseMinutes: 15, label: 'Urgent' }
};

// Escalation thresholds
const ESCALATION_RULES = {
  toHigh: { declines: 2, hoursElapsed: 2 },
  toUrgent: { declines: 3, hoursElapsed: 4 }
};

interface RedistributionRequest {
  jobId?: string;
  assignmentId?: string;
  reason?: 'declined' | 'expired' | 'manual';
  processAll?: boolean; // Process all jobs needing redistribution
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: RedistributionRequest = await req.json();
    logStep("Starting redistribution", body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // If processAll is true, find all jobs needing redistribution
    if (body.processAll) {
      return await processAllPendingJobs(supabase);
    }

    // Single job redistribution
    if (!body.jobId && !body.assignmentId) {
      throw new Error("Either jobId or assignmentId is required");
    }

    let jobId = body.jobId;

    // If assignmentId provided, get the jobId
    if (body.assignmentId && !jobId) {
      const { data: assignment } = await supabase
        .from("job_assignments")
        .select("job_id")
        .eq("id", body.assignmentId)
        .single();
      
      if (!assignment) {
        throw new Error("Assignment not found");
      }
      jobId = assignment.job_id;
    }

    const result = await redistributeJob(supabase, jobId!, body.reason || 'manual');
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Process all jobs that need redistribution
 */
async function processAllPendingJobs(supabase: any) {
  logStep("Processing all pending jobs");

  // Find jobs with expired offers
  const now = new Date().toISOString();
  
  const { data: expiredOffers } = await supabase
    .from("job_assignments")
    .select("id, job_id, cleaner_id")
    .eq("status", "Offered")
    .lt("response_deadline", now);

  let processed = 0;
  let errors = 0;

  // Mark expired offers
  for (const offer of expiredOffers || []) {
    try {
      // Update assignment status
      await supabase
        .from("job_assignments")
        .update({ 
          status: "Expired",
          decline_reason: "Response deadline exceeded"
        })
        .eq("id", offer.id);

      // Update analytics
      await supabase.rpc('increment_analytics_expirations', { 
        p_job_id: offer.job_id 
      }).catch(() => {
        // RPC might not exist, use direct update
        supabase
          .from("assignment_analytics")
          .update({ 
            total_expirations: supabase.raw('total_expirations + 1') 
          })
          .eq("job_id", offer.job_id);
      });

      // Trigger redistribution
      await redistributeJob(supabase, offer.job_id, 'expired');
      processed++;
    } catch (err) {
      logStep("Error processing expired offer", { offerId: offer.id, error: err });
      errors++;
    }
  }

  // Find jobs that need more cleaners
  const { data: understaffedJobs } = await supabase
    .from("jobs")
    .select(`
      id,
      min_cleaners_required,
      job_assignments!inner(status)
    `)
    .in("status", ["Dispatching", "Assigned"])
    .eq("job_assignments.status", "Confirmed");

  for (const job of understaffedJobs || []) {
    const confirmedCount = job.job_assignments?.length || 0;
    if (confirmedCount < job.min_cleaners_required) {
      try {
        await redistributeJob(supabase, job.id, 'manual');
        processed++;
      } catch (err) {
        errors++;
      }
    }
  }

  logStep("Batch processing complete", { processed, errors });

  return new Response(
    JSON.stringify({ 
      success: true, 
      processed, 
      errors,
      expiredOffers: expiredOffers?.length || 0
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/**
 * Redistribute a single job to the next available cleaner
 */
async function redistributeJob(
  supabase: any, 
  jobId: string, 
  reason: string
): Promise<any> {
  logStep("Redistributing job", { jobId, reason });

  // 1. Get job details and current assignment state
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // 2. Get assignment analytics
  let { data: analytics } = await supabase
    .from("assignment_analytics")
    .select("*")
    .eq("job_id", jobId)
    .single();

  // Create analytics if doesn't exist
  if (!analytics) {
    const { data: newAnalytics } = await supabase
      .from("assignment_analytics")
      .insert({
        job_id: jobId,
        total_cleaners_needed: job.min_cleaners_required,
        first_offer_sent_at: new Date().toISOString()
      })
      .select()
      .single();
    analytics = newAnalytics;
  }

  // 3. Calculate current state
  const { data: currentAssignments } = await supabase
    .from("job_assignments")
    .select("*")
    .eq("job_id", jobId);

  const confirmedCount = currentAssignments?.filter((a: any) => a.status === "Confirmed").length || 0;
  const declinedCount = currentAssignments?.filter((a: any) => 
    a.status === "Declined" || a.status === "Expired"
  ).length || 0;
  const pendingCount = currentAssignments?.filter((a: any) => a.status === "Offered").length || 0;

  logStep("Current state", { 
    confirmedCount, 
    declinedCount, 
    pendingCount,
    needed: job.min_cleaners_required 
  });

  // 4. Check if job is fully staffed
  if (confirmedCount >= job.min_cleaners_required) {
    logStep("Job fully staffed, no redistribution needed");
    
    await supabase
      .from("assignment_analytics")
      .update({
        status: 'completed',
        fully_assigned_at: new Date().toISOString(),
        total_cleaners_assigned: confirmedCount
      })
      .eq("job_id", jobId);

    return { success: true, message: "Job fully staffed", confirmedCount };
  }

  // 5. Calculate hours elapsed since first offer
  const hoursElapsed = analytics?.first_offer_sent_at 
    ? (Date.now() - new Date(analytics.first_offer_sent_at).getTime()) / (1000 * 60 * 60)
    : 0;

  // 6. Determine new priority level
  let newPriority = 'normal';
  if (declinedCount >= ESCALATION_RULES.toUrgent.declines || hoursElapsed >= ESCALATION_RULES.toUrgent.hoursElapsed) {
    newPriority = 'urgent';
  } else if (declinedCount >= ESCALATION_RULES.toHigh.declines || hoursElapsed >= ESCALATION_RULES.toHigh.hoursElapsed) {
    newPriority = 'high';
  }

  const priorityChanged = newPriority !== job.current_priority;
  
  if (priorityChanged) {
    logStep("Escalating priority", { from: job.current_priority, to: newPriority });
    
    // Update job priority
    await supabase
      .from("jobs")
      .update({
        current_priority: newPriority,
        escalation_count: (job.escalation_count || 0) + 1,
        last_escalation_at: new Date().toISOString()
      })
      .eq("id", jobId);

    // Update analytics
    const escalationUpdate: any = {
      escalation_count: (analytics?.escalation_count || 0) + 1,
      current_priority: newPriority
    };
    
    if (newPriority === 'high' && !analytics?.escalated_to_high_at) {
      escalationUpdate.escalated_to_high_at = new Date().toISOString();
    }
    if (newPriority === 'urgent' && !analytics?.escalated_to_urgent_at) {
      escalationUpdate.escalated_to_urgent_at = new Date().toISOString();
    }

    await supabase
      .from("assignment_analytics")
      .update(escalationUpdate)
      .eq("job_id", jobId);
  }

  // 7. Get next cleaner from queue
  const { data: queuedCleaners } = await supabase
    .from("assignment_queue")
    .select("*, cleaners(*)")
    .eq("job_id", jobId)
    .eq("status", "queued")
    .order("queue_position", { ascending: true })
    .limit(1);

  let nextCleaner = queuedCleaners?.[0];

  // 8. If no queued cleaners, find new candidates
  if (!nextCleaner) {
    logStep("No queued cleaners, finding new candidates");
    
    // Get already assigned cleaner IDs
    const assignedCleanerIds = currentAssignments?.map((a: any) => a.cleaner_id) || [];
    
    // Find available cleaners not already assigned
    const { data: availableCleaners } = await supabase
      .from("cleaners")
      .select("*")
      .eq("status", "active")
      .eq("available_for_bookings", true)
      .eq("approved", true)
      .not("id", "in", `(${assignedCleanerIds.join(",") || "null"})`)
      .not("home_lat", "is", null)
      .not("home_lng", "is", null);

    if (!availableCleaners || availableCleaners.length === 0) {
      logStep("No available cleaners found - manual intervention required");
      
      await supabase
        .from("jobs")
        .update({ 
          manual_intervention_required: true,
          dispatch_alert_reason: "No cleaners available for redistribution"
        })
        .eq("id", jobId);

      await supabase
        .from("assignment_analytics")
        .update({
          status: 'manual_intervention',
          manual_intervention_required: true,
          failure_reason: "No cleaners available"
        })
        .eq("job_id", jobId);

      // Create dispatch alert
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: "No cleaners available for redistribution after " + declinedCount + " declines",
        severity: "critical"
      });

      return { 
        success: false, 
        message: "No available cleaners",
        manualInterventionRequired: true 
      };
    }

    // Score and queue new candidates
    const scoredCandidates = await scoreCandidates(supabase, job, availableCleaners);
    
    // Add to queue
    for (let i = 0; i < scoredCandidates.length; i++) {
      await supabase
        .from("assignment_queue")
        .upsert({
          job_id: jobId,
          cleaner_id: scoredCandidates[i].id,
          priority_level: newPriority,
          queue_position: i + 1,
          match_score: scoredCandidates[i].match_score,
          distance_miles: scoredCandidates[i].distance_miles,
          status: 'queued'
        }, {
          onConflict: 'job_id,cleaner_id'
        });
    }

    // Get the first queued cleaner
    nextCleaner = {
      ...scoredCandidates[0],
      cleaners: scoredCandidates[0]
    };
  }

  if (!nextCleaner) {
    return { success: false, message: "No candidates available" };
  }

  // 9. Create new job assignment
  const responseDeadline = new Date(
    Date.now() + PRIORITY_CONFIG[newPriority as keyof typeof PRIORITY_CONFIG].responseMinutes * 60 * 1000
  ).toISOString();

  // Generate secure token
  const acceptToken = crypto.randomUUID().replace(/-/g, '');
  const declineToken = crypto.randomUUID().replace(/-/g, '');

  // Create tokens
  const { data: acceptTokenData } = await supabase
    .from("job_assignment_tokens")
    .insert({
      token: acceptToken,
      action: 'accept',
      expires_at: responseDeadline
    })
    .select()
    .single();

  const { data: declineTokenData } = await supabase
    .from("job_assignment_tokens")
    .insert({
      token: declineToken,
      action: 'decline',
      expires_at: responseDeadline
    })
    .select()
    .single();

  // Create assignment
  const estimatedPayCents = Math.round(
    (nextCleaner.cleaners?.pay_rate_hr || 18) * job.duration_est_hours * 100
  );

  const { data: newAssignment, error: assignError } = await supabase
    .from("job_assignments")
    .insert({
      job_id: jobId,
      cleaner_id: nextCleaner.cleaner_id || nextCleaner.id,
      status: "Offered",
      role: confirmedCount === 0 ? "Lead" : "Support",
      priority_level: newPriority,
      response_deadline: responseDeadline,
      offer_sent_at: new Date().toISOString(),
      distance_miles: nextCleaner.distance_miles,
      pay_rate_hr: nextCleaner.cleaners?.pay_rate_hr || 18,
      estimated_pay_cents: estimatedPayCents,
      escalation_level: job.escalation_count || 0
    })
    .select()
    .single();

  if (assignError) {
    throw new Error(`Failed to create assignment: ${assignError.message}`);
  }

  // Update token with assignment ID
  await supabase
    .from("job_assignment_tokens")
    .update({ job_assignment_id: newAssignment.id })
    .in("id", [acceptTokenData?.id, declineTokenData?.id].filter(Boolean));

  // Update queue status
  await supabase
    .from("assignment_queue")
    .update({ 
      status: 'offered',
      offered_at: new Date().toISOString(),
      response_deadline: responseDeadline
    })
    .eq("job_id", jobId)
    .eq("cleaner_id", nextCleaner.cleaner_id || nextCleaner.id);

  // 10. Update analytics
  await supabase
    .from("assignment_analytics")
    .update({
      total_offers_sent: (analytics?.total_offers_sent || 0) + 1
    })
    .eq("job_id", jobId);

  // 11. Send notification to cleaner
  const cleaner = nextCleaner.cleaners || nextCleaner;
  
  if (cleaner.phone && cleaner.sms_notifications_enabled !== false) {
    const jobDateFormatted = new Date(job.start_datetime).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
    const priorityEmoji = newPriority === 'urgent' ? '🚨' : newPriority === 'high' ? '⚡' : '🧹';
    const estimatedPay = ((cleaner.pay_rate_hr || 18) * job.duration_est_hours).toFixed(2);
    const baseUrl = Deno.env.get("SUPABASE_URL") + "/functions/v1/respond-to-offer";
    const responseMinutes = PRIORITY_CONFIG[newPriority as keyof typeof PRIORITY_CONFIG].responseMinutes;

    const message = `${priorityEmoji} ${newPriority === 'urgent' ? 'URGENT ' : newPriority === 'high' ? 'Priority ' : ''}Job Offer!

📅 ${jobDateFormatted}
📍 ${job.city}, ${job.zip}
💰 $${estimatedPay} (${job.duration_est_hours}hrs)
📏 ${nextCleaner.distance_miles?.toFixed(1) || '?'} miles

⏰ Respond in ${responseMinutes} min:
✅ Accept: ${baseUrl}?token=${acceptToken}
❌ Decline: ${baseUrl}?token=${declineToken}`;

    try {
      await supabase.functions.invoke("send-sms-notification", {
        body: {
          toPhone: cleaner.phone,
          message,
          type: "job_offer",
          jobAssignmentId: newAssignment.id
        }
      });
      logStep("SMS sent", { cleanerId: cleaner.id, phone: cleaner.phone });
    } catch (smsError) {
      logStep("SMS failed (non-critical)", { error: smsError });
    }
  }

  logStep("Redistribution complete", {
    newAssignmentId: newAssignment.id,
    cleanerId: cleaner.id,
    priority: newPriority,
    responseDeadline
  });

  return {
    success: true,
    assignmentId: newAssignment.id,
    cleanerId: cleaner.id,
    cleanerName: `${cleaner.first_name} ${cleaner.last_name}`,
    priority: newPriority,
    responseDeadline,
    confirmedCount,
    needed: job.min_cleaners_required
  };
}

/**
 * Score candidates for job assignment
 */
async function scoreCandidates(supabase: any, job: any, cleaners: any[]) {
  const scoredCandidates = [];

  for (const cleaner of cleaners) {
    // Calculate distance
    const distance = haversineDistance(
      cleaner.home_lat,
      cleaner.home_lng,
      job.lat,
      job.lng
    );

    // Skip if outside max travel distance
    if (distance > (cleaner.max_travel_miles || 20)) continue;

    // Calculate score components
    const locationScore = calculateLocationScore(distance, cleaner.max_travel_miles || 20);
    const ratingScore = (cleaner.average_rating || 4) * 5; // 0-25
    const performanceScore = ((cleaner.acceptance_rate || 50) / 100) * 20; // 0-20

    const totalScore = locationScore + ratingScore + performanceScore;

    scoredCandidates.push({
      ...cleaner,
      distance_miles: Math.round(distance * 10) / 10,
      match_score: Math.round(totalScore * 10) / 10
    });
  }

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.match_score - a.match_score);

  return scoredCandidates.slice(0, 10); // Top 10 candidates
}

/**
 * Haversine formula for distance calculation
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
 * Calculate location score based on distance
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
