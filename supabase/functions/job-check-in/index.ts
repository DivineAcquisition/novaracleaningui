import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[JOB-CHECK-IN] ${step}`, details ? JSON.stringify(details) : '');
};

// On-time window: ±15 minutes
const ON_TIME_WINDOW_MINUTES = 15;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobAssignmentId, action, cleanerId, lat, lng } = await req.json();
    logStep("Processing check-in/out", { jobAssignmentId, action, cleanerId });

    if (!jobAssignmentId || !action || !cleanerId) {
      throw new Error("Missing required fields: jobAssignmentId, action, cleanerId");
    }

    if (!["check_in", "check_out"].includes(action)) {
      throw new Error("Invalid action. Must be 'check_in' or 'check_out'");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch job assignment with job details
    const { data: assignment, error: assignmentError } = await supabase
      .from("job_assignments")
      .select("*, jobs(*)")
      .eq("id", jobAssignmentId)
      .eq("cleaner_id", cleanerId)
      .single();

    if (assignmentError || !assignment) {
      throw new Error("Job assignment not found or unauthorized");
    }

    const now = new Date();
    const job = assignment.jobs;

    if (action === "check_in") {
      logStep("Processing check-in", { jobId: job.id });

      // Verify job hasn't already been checked in
      if (job.check_in_time) {
        logStep("Job already checked in", { checkInTime: job.check_in_time });
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Job already checked in",
            alreadyCheckedIn: true,
            checkInTime: job.check_in_time
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate if on-time (within ±15 minutes of scheduled start)
      const scheduledStart = new Date(job.start_datetime);
      const diffMinutes = (now.getTime() - scheduledStart.getTime()) / (1000 * 60);
      const isOnTime = Math.abs(diffMinutes) <= ON_TIME_WINDOW_MINUTES;

      logStep("Checking on-time status", { 
        scheduledStart: job.start_datetime,
        actualArrival: now.toISOString(),
        diffMinutes,
        isOnTime 
      });

      // Update job with check-in time (first cleaner to arrive)
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ 
          check_in_time: now.toISOString(),
          status: "In Progress"
        })
        .eq("id", job.id);

      if (jobUpdateError) {
        throw new Error(`Failed to update job: ${jobUpdateError.message}`);
      }

      // Update assignment status
      const { error: assignmentUpdateError } = await supabase
        .from("job_assignments")
        .update({ 
          status: "In Progress",
          responded_at: now.toISOString()
        })
        .eq("id", jobAssignmentId);

      if (assignmentUpdateError) {
        throw new Error(`Failed to update assignment: ${assignmentUpdateError.message}`);
      }

      // Update cleaner's on-time tracking
      if (isOnTime) {
        logStep("Updating cleaner on-time stats", { cleanerId });
        
        const { data: cleaner, error: cleanerFetchError } = await supabase
          .from("cleaners")
          .select("total_on_time_arrivals, completed_bookings")
          .eq("id", cleanerId)
          .single();

        if (cleanerFetchError) {
          logStep("Warning: Could not fetch cleaner stats", { error: cleanerFetchError });
        } else {
          const newOnTimeArrivals = (cleaner.total_on_time_arrivals || 0) + 1;
          const completedBookings = cleaner.completed_bookings || 1;
          const newOnTimeRate = (newOnTimeArrivals / completedBookings) * 100;

          const { error: cleanerUpdateError } = await supabase
            .from("cleaners")
            .update({
              total_on_time_arrivals: newOnTimeArrivals,
              on_time_rate: Math.round(newOnTimeRate * 10) / 10
            })
            .eq("id", cleanerId);

          if (cleanerUpdateError) {
            logStep("Warning: Could not update cleaner stats", { error: cleanerUpdateError });
          } else {
            logStep("Updated cleaner on-time rate", { 
              cleanerId,
              onTimeRate: newOnTimeRate,
              totalOnTime: newOnTimeArrivals 
            });
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Checked in successfully",
          checkInTime: now.toISOString(),
          isOnTime,
          scheduledStart: job.start_datetime
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else if (action === "check_out") {
      logStep("Processing check-out", { jobId: job.id });

      if (!job.check_in_time) {
        throw new Error("Cannot check out before checking in");
      }

      if (job.check_out_time) {
        logStep("Job already checked out", { checkOutTime: job.check_out_time });
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: "Job already checked out",
            alreadyCheckedOut: true,
            checkOutTime: job.check_out_time
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate actual duration
      const checkInTime = new Date(job.check_in_time);
      const durationMs = now.getTime() - checkInTime.getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      logStep("Calculating duration", {
        checkInTime: job.check_in_time,
        checkOutTime: now.toISOString(),
        durationHours
      });

      // Update job with check-out time and duration
      const { error: jobUpdateError } = await supabase
        .from("jobs")
        .update({ 
          check_out_time: now.toISOString(),
          actual_duration_hours: Math.round(durationHours * 100) / 100,
          status: "Completed"
        })
        .eq("id", job.id);

      if (jobUpdateError) {
        throw new Error(`Failed to update job: ${jobUpdateError.message}`);
      }

      // Update assignment status to completed
      const { error: assignmentUpdateError } = await supabase
        .from("job_assignments")
        .update({ status: "Completed" })
        .eq("id", jobAssignmentId);

      if (assignmentUpdateError) {
        throw new Error(`Failed to update assignment: ${assignmentUpdateError.message}`);
      }

      logStep("Check-out recorded, checking if all cleaners completed");

      // Check if ALL assigned cleaners have checked out
      const { data: allAssignments } = await supabase
        .from("job_assignments")
        .select("id, status")
        .eq("job_id", job.id);

      const allCompleted = allAssignments?.every(a => a.status === "Completed") ?? false;
      let payoutTriggered = false;

      if (allCompleted) {
        logStep("All cleaners checked out, triggering auto-completion", { jobId: job.id });
        
        // Get booking from job
        const { data: jobWithBooking } = await supabase
          .from("jobs")
          .select("booking_id")
          .eq("id", job.id)
          .single();
        
        if (jobWithBooking?.booking_id) {
          // Trigger auto-completion (internal call, no auth needed)
          try {
            const autoCompleteResponse = await supabase.functions.invoke('auto-complete-booking', {
              body: { 
                bookingId: jobWithBooking.booking_id,
                triggeredBy: "cleaner_checkout",
                cleanerId: cleanerId
              }
            });
            
            if (autoCompleteResponse.error) {
              logStep("Auto-completion failed", { error: autoCompleteResponse.error });
            } else {
              logStep("Auto-completion triggered successfully", autoCompleteResponse.data);
              payoutTriggered = true;
            }
          } catch (autoCompleteError) {
            logStep("Auto-completion error (non-critical)", { error: autoCompleteError });
          }
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Checked out successfully",
          checkOutTime: now.toISOString(),
          actualDurationHours: Math.round(durationHours * 100) / 100,
          allCleanersCompleted: allCompleted,
          payoutTriggered: payoutTriggered
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Should never reach here due to validation above
    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("Error", { error: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
