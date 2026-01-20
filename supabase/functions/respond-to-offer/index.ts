/**
 * Respond to Job Offer - Enhanced with Secure Tokens
 * 
 * Handles accept/decline actions from SMS/email links.
 * Uses secure tokens from job_assignment_tokens table.
 * Triggers redistribution on decline.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RESPOND-OFFER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    
    // Legacy support: also check for id/action/token format
    const legacyId = url.searchParams.get("id");
    const legacyAction = url.searchParams.get("action");
    const legacyToken = url.searchParams.get("token");

    // Get client info for logging
    const clientIp = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || "unknown";

    let assignmentId: string;
    let action: string;
    let tokenRecord: any = null;

    // Try new token-based approach first
    if (token && !legacyId) {
      logStep("Processing token-based request", { token: token.substring(0, 8) + "..." });

      // Look up token
      const { data: tokenData, error: tokenError } = await supabase
        .from("job_assignment_tokens")
        .select("*, job_assignments(*)")
        .eq("token", token)
        .single();

      if (tokenError || !tokenData) {
        logStep("Invalid token", { error: tokenError });
        return renderErrorPage("Invalid or expired link. Please check your messages for a new link.");
      }

      // Check if token already used
      if (tokenData.used_at) {
        logStep("Token already used", { usedAt: tokenData.used_at });
        return renderAlreadyRespondedPage(tokenData.action);
      }

      // Check if token expired
      if (new Date(tokenData.expires_at) < new Date()) {
        logStep("Token expired", { expiresAt: tokenData.expires_at });
        return renderErrorPage("This link has expired. The job may have been reassigned.");
      }

      tokenRecord = tokenData;
      assignmentId = tokenData.job_assignment_id;
      action = tokenData.action;

    } else if (legacyId && legacyAction && legacyToken) {
      // Legacy format support
      logStep("Processing legacy request", { assignmentId: legacyId, action: legacyAction });

      // Verify legacy token (simple hash check)
      const expectedToken = btoa(legacyId).substring(0, 10);
      if (legacyToken !== expectedToken) {
        return renderErrorPage("Invalid link. Please check your messages.");
      }

      assignmentId = legacyId;
      action = legacyAction;
    } else {
      return renderErrorPage("Missing required parameters. Please use the link from your message.");
    }

    logStep("Processing response", { assignmentId, action });

    // Get assignment details
    const { data: assignment, error: fetchError } = await supabase
      .from("job_assignments")
      .select(`
        *,
        jobs(*),
        cleaners(*)
      `)
      .eq("id", assignmentId)
      .single();

    if (fetchError || !assignment) {
      logStep("Assignment not found", { error: fetchError });
      return renderErrorPage("Job offer not found. It may have been cancelled.");
    }

    // Check if already responded
    if (assignment.status !== "Offered") {
      logStep("Already responded", { currentStatus: assignment.status });
      return renderAlreadyRespondedPage(assignment.status === "Confirmed" ? "accept" : "decline");
    }

    // Check if response deadline passed
    if (assignment.response_deadline && new Date(assignment.response_deadline) < new Date()) {
      logStep("Response deadline passed", { deadline: assignment.response_deadline });
      
      // Mark as expired
      await supabase
        .from("job_assignments")
        .update({ 
          status: "Expired",
          decline_reason: "Response deadline exceeded"
        })
        .eq("id", assignmentId);

      // Trigger redistribution
      await triggerRedistribution(supabase, assignment.job_id, "expired");

      return renderErrorPage("This offer has expired. We'll send you new opportunities soon!");
    }

    // Calculate response time
    const responseTimeSeconds = assignment.offer_sent_at 
      ? Math.round((Date.now() - new Date(assignment.offer_sent_at).getTime()) / 1000)
      : null;

    // Update assignment status
    const newStatus = action === "accept" ? "Confirmed" : "Declined";
    const updateData: any = {
      status: newStatus,
      responded_at: new Date().toISOString()
    };

    if (action === "decline") {
      updateData.decline_reason = url.searchParams.get("reason") || "User declined via link";
    }

    const { error: updateError } = await supabase
      .from("job_assignments")
      .update(updateData)
      .eq("id", assignmentId);

    if (updateError) {
      throw updateError;
    }

    // Mark token as used
    if (tokenRecord) {
      await supabase
        .from("job_assignment_tokens")
        .update({ 
          used_at: new Date().toISOString(),
          ip_address: clientIp,
          user_agent: userAgent
        })
        .eq("id", tokenRecord.id);

      // Also mark the paired token as used
      await supabase
        .from("job_assignment_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("job_assignment_id", assignmentId)
        .neq("id", tokenRecord.id);
    }

    // Update cleaner performance metrics
    await updateCleanerMetrics(supabase, assignment.cleaner_id, action);

    // Update assignment queue
    await supabase
      .from("assignment_queue")
      .update({ 
        status: action === "accept" ? "accepted" : "declined",
        decline_reason: action === "decline" ? "User declined" : null
      })
      .eq("job_id", assignment.job_id)
      .eq("cleaner_id", assignment.cleaner_id);

    // Update assignment analytics
    await updateAnalytics(supabase, assignment.job_id, action, responseTimeSeconds);

    // If declined or more cleaners needed, trigger redistribution
    if (action === "decline") {
      logStep("Triggering redistribution after decline");
      await triggerRedistribution(supabase, assignment.job_id, "declined");
    } else {
      // Check if job is now fully staffed
      await checkJobCompletion(supabase, assignment.job_id);
    }

    // Update cleaner scores in background
    try {
      await supabase.functions.invoke("update-cleaner-scores", {
        body: { cleanerId: assignment.cleaner_id }
      });
    } catch (err) {
      logStep("Score update failed (non-critical)", { error: err });
    }

    logStep("Response processed successfully", { newStatus, action });

    // Return success page
    return renderSuccessPage(action, assignment);

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return renderErrorPage(error.message || "An error occurred. Please try again.");
  }
});

/**
 * Update cleaner performance metrics
 */
async function updateCleanerMetrics(supabase: any, cleanerId: string, action: string) {
  const { data: cleaner } = await supabase
    .from("cleaners")
    .select("total_offers_received, total_offers_accepted")
    .eq("id", cleanerId)
    .single();

  const newOffersReceived = (cleaner?.total_offers_received || 0) + 1;
  const newOffersAccepted = action === "accept"
    ? (cleaner?.total_offers_accepted || 0) + 1
    : (cleaner?.total_offers_accepted || 0);
  const newAcceptanceRate = newOffersReceived > 0 
    ? (newOffersAccepted / newOffersReceived) * 100 
    : 0;

  await supabase
    .from("cleaners")
    .update({
      total_offers_received: newOffersReceived,
      total_offers_accepted: newOffersAccepted,
      acceptance_rate: Math.round(newAcceptanceRate * 10) / 10
    })
    .eq("id", cleanerId);
}

/**
 * Update assignment analytics
 */
async function updateAnalytics(
  supabase: any, 
  jobId: string, 
  action: string, 
  responseTimeSeconds: number | null
) {
  const { data: analytics } = await supabase
    .from("assignment_analytics")
    .select("*")
    .eq("job_id", jobId)
    .single();

  if (!analytics) return;

  const updateData: any = {};
  
  if (action === "accept") {
    updateData.total_accepts = (analytics.total_accepts || 0) + 1;
    if (!analytics.first_response_at) {
      updateData.first_response_at = new Date().toISOString();
    }
  } else {
    updateData.total_declines = (analytics.total_declines || 0) + 1;
  }

  // Update average response time
  if (responseTimeSeconds) {
    const totalResponses = (analytics.total_accepts || 0) + (analytics.total_declines || 0) + 1;
    const currentAvg = analytics.avg_response_time_seconds || 0;
    updateData.avg_response_time_seconds = Math.round(
      ((currentAvg * (totalResponses - 1)) + responseTimeSeconds) / totalResponses
    );
  }

  await supabase
    .from("assignment_analytics")
    .update(updateData)
    .eq("job_id", jobId);
}

/**
 * Trigger job redistribution
 */
async function triggerRedistribution(supabase: any, jobId: string, reason: string) {
  try {
    await supabase.functions.invoke("automated-job-redistribution", {
      body: { jobId, reason }
    });
  } catch (err) {
    logStep("Redistribution trigger failed", { error: err });
    // Don't throw - redistribution failure shouldn't block the response
  }
}

/**
 * Check if job is now fully staffed
 */
async function checkJobCompletion(supabase: any, jobId: string) {
  const { data: job } = await supabase
    .from("jobs")
    .select("min_cleaners_required")
    .eq("id", jobId)
    .single();

  const { data: assignments } = await supabase
    .from("job_assignments")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "Confirmed");

  const confirmedCount = assignments?.length || 0;
  
  if (confirmedCount >= (job?.min_cleaners_required || 1)) {
    // Job is fully staffed
    await supabase
      .from("jobs")
      .update({ status: "Assigned" })
      .eq("id", jobId);

    await supabase
      .from("assignment_analytics")
      .update({
        status: "completed",
        fully_assigned_at: new Date().toISOString(),
        total_cleaners_assigned: confirmedCount
      })
      .eq("job_id", jobId);
  }
}

/**
 * Render success page
 */
function renderSuccessPage(action: string, assignment: any): Response {
  const isAccept = action === "accept";
  const emoji = isAccept ? "✅" : "❌";
  const title = isAccept ? "Job Accepted!" : "Job Declined";
  const message = isAccept
    ? "You're confirmed for this job. Check your dashboard for details."
    : "No problem! We'll send you more opportunities soon.";

  const jobDate = new Date(assignment.jobs.start_datetime).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const jobTime = new Date(assignment.jobs.start_datetime).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title} - Novara Cleaning</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #5500FF10 0%, #8F7BFD10 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: ${isAccept ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)' : 'linear-gradient(135deg, #6B7280 0%, #4B5563 100%)'};
      color: white;
      padding: 32px;
      text-align: center;
    }
    .emoji { font-size: 48px; margin-bottom: 16px; }
    .title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    .subtitle { opacity: 0.9; font-size: 14px; }
    .content { padding: 24px; }
    .job-details {
      background: #F9FAFB;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .job-details h3 { 
      font-size: 14px; 
      color: #6B7280; 
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .detail-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid #E5E7EB;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-icon { font-size: 18px; }
    .detail-text { font-size: 14px; color: #374151; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px 24px;
      background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%);
      color: white;
      text-decoration: none;
      text-align: center;
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
    }
    .btn:hover { opacity: 0.9; }
    ${isAccept ? `
    .next-steps {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .next-steps h4 { color: #065F46; font-size: 14px; margin-bottom: 8px; }
    .next-steps ul { 
      list-style: none;
      font-size: 13px;
      color: #047857;
    }
    .next-steps li { 
      padding: 4px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    ` : ''}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="emoji">${emoji}</div>
      <div class="title">${title}</div>
      <div class="subtitle">${message}</div>
    </div>
    <div class="content">
      <div class="job-details">
        <h3>Job Details</h3>
        <div class="detail-row">
          <span class="detail-icon">📅</span>
          <span class="detail-text">${jobDate}</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">🕐</span>
          <span class="detail-text">${jobTime}</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">📍</span>
          <span class="detail-text">${assignment.jobs.city}, ${assignment.jobs.state} ${assignment.jobs.zip}</span>
        </div>
        <div class="detail-row">
          <span class="detail-icon">💰</span>
          <span class="detail-text">$${((assignment.cleaners?.pay_rate_hr || 18) * assignment.jobs.duration_est_hours).toFixed(2)} estimated</span>
        </div>
      </div>
      ${isAccept ? `
      <div class="next-steps">
        <h4>✨ What's Next</h4>
        <ul>
          <li>📱 Check your dashboard for full details</li>
          <li>⏰ Arrive 5 minutes early</li>
          <li>📸 Take before/after photos</li>
          <li>💳 Get paid automatically after completion</li>
        </ul>
      </div>
      ` : ''}
      <a href="https://contractor.novaracleaning.com/cleaner/dashboard" class="btn">
        Open Dashboard
      </a>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { ...corsHeaders, "Content-Type": "text/html" }
  });
}

/**
 * Render already responded page
 */
function renderAlreadyRespondedPage(previousAction: string): Response {
  const wasAccepted = previousAction === "accept" || previousAction === "Confirmed";
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Already Responded - Novara Cleaning</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #5500FF10 0%, #8F7BFD10 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      max-width: 400px;
      width: 100%;
      padding: 32px;
      text-align: center;
    }
    .emoji { font-size: 48px; margin-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #374151; }
    .message { color: #6B7280; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .status {
      display: inline-block;
      padding: 8px 16px;
      background: ${wasAccepted ? '#ECFDF5' : '#F3F4F6'};
      color: ${wasAccepted ? '#065F46' : '#374151'};
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 24px;
    }
    .btn {
      display: block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="emoji">⚠️</div>
    <div class="title">Already Responded</div>
    <div class="message">You've already responded to this job offer.</div>
    <div class="status">${wasAccepted ? '✅ Accepted' : '❌ Declined'}</div>
    <a href="https://contractor.novaracleaning.com/cleaner/dashboard" class="btn">
      View Dashboard
    </a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { ...corsHeaders, "Content-Type": "text/html" }
  });
}

/**
 * Render error page
 */
function renderErrorPage(message: string): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Error - Novara Cleaning</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      max-width: 400px;
      width: 100%;
      padding: 32px;
      text-align: center;
    }
    .emoji { font-size: 48px; margin-bottom: 16px; }
    .title { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #DC2626; }
    .message { color: #6B7280; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .btn {
      display: block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
    }
    .help {
      margin-top: 16px;
      font-size: 12px;
      color: #9CA3AF;
    }
    .help a { color: #5500FF; }
  </style>
</head>
<body>
  <div class="container">
    <div class="emoji">❌</div>
    <div class="title">Oops!</div>
    <div class="message">${message}</div>
    <a href="https://contractor.novaracleaning.com/cleaner/dashboard" class="btn">
      Go to Dashboard
    </a>
    <div class="help">
      Need help? <a href="mailto:hello@novaracleaning.com">Contact Support</a>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "text/html" }
  });
}
