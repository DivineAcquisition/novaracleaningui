import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[JOB-REMINDER-SMS] ${step}${detailsStr}`);
};

/**
 * Send SMS reminders to cleaners about upcoming jobs
 * - Day before reminder (24 hours)
 * - Hour before reminder (1 hour)
 * 
 * Should be called by a cron job every 15 minutes
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting job reminder check");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    
    // Time windows for reminders
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    
    // Buffer of 15 minutes for cron timing
    const dayReminderStart = new Date(oneDayFromNow.getTime() - 7.5 * 60 * 1000);
    const dayReminderEnd = new Date(oneDayFromNow.getTime() + 7.5 * 60 * 1000);
    const hourReminderStart = new Date(oneHourFromNow.getTime() - 7.5 * 60 * 1000);
    const hourReminderEnd = new Date(oneHourFromNow.getTime() + 7.5 * 60 * 1000);

    logStep("Time windows", {
      dayReminderWindow: `${dayReminderStart.toISOString()} - ${dayReminderEnd.toISOString()}`,
      hourReminderWindow: `${hourReminderStart.toISOString()} - ${hourReminderEnd.toISOString()}`
    });

    // Find confirmed job assignments for day-before reminder
    const { data: dayBeforeJobs, error: dayError } = await supabase
      .from("job_assignments")
      .select(`
        id,
        cleaner_id,
        day_before_reminder_sent,
        cleaners (
          id,
          first_name,
          phone,
          phone_verified,
          sms_notifications_enabled
        ),
        jobs (
          id,
          start_datetime,
          city,
          state,
          zip,
          address,
          duration_est_hours
        )
      `)
      .eq("status", "Confirmed")
      .eq("day_before_reminder_sent", false)
      .gte("jobs.start_datetime", dayReminderStart.toISOString())
      .lte("jobs.start_datetime", dayReminderEnd.toISOString());

    if (dayError) {
      logStep("Error fetching day-before jobs", { error: dayError.message });
    }

    // Find confirmed job assignments for hour-before reminder
    const { data: hourBeforeJobs, error: hourError } = await supabase
      .from("job_assignments")
      .select(`
        id,
        cleaner_id,
        hour_before_reminder_sent,
        cleaners (
          id,
          first_name,
          phone,
          phone_verified,
          sms_notifications_enabled
        ),
        jobs (
          id,
          start_datetime,
          city,
          state,
          zip,
          address,
          duration_est_hours
        )
      `)
      .eq("status", "Confirmed")
      .eq("hour_before_reminder_sent", false)
      .gte("jobs.start_datetime", hourReminderStart.toISOString())
      .lte("jobs.start_datetime", hourReminderEnd.toISOString());

    if (hourError) {
      logStep("Error fetching hour-before jobs", { error: hourError.message });
    }

    let remindersSent = 0;
    const errors: any[] = [];

    // Send day-before reminders
    for (const assignment of (dayBeforeJobs || [])) {
      const cleaner = assignment.cleaners as any;
      const job = assignment.jobs as any;

      if (!cleaner?.phone_verified || !cleaner?.sms_notifications_enabled) {
        logStep("Skipping day reminder - SMS not enabled", { cleanerId: cleaner?.id });
        continue;
      }

      if (!job?.start_datetime) {
        continue;
      }

      const jobDate = new Date(job.start_datetime).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      const jobTime = new Date(job.start_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const message = `📢 REMINDER: Job tomorrow!

📅 ${jobDate} at ${jobTime}
📍 ${job.address || job.city}, ${job.zip}

Check app for customer notes. Be on time!`;

      try {
        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: cleaner.phone,
            message,
            type: "reminder",
            jobAssignmentId: assignment.id,
            cleanerId: cleaner.id
          }
        });

        // Mark as sent
        await supabase
          .from("job_assignments")
          .update({ day_before_reminder_sent: true })
          .eq("id", assignment.id);

        remindersSent++;
        logStep("Day-before reminder sent", { assignmentId: assignment.id, cleaner: cleaner.first_name });
      } catch (error: any) {
        errors.push({ assignmentId: assignment.id, type: 'day_before', error: error.message });
        logStep("Error sending day-before reminder", { error: error.message });
      }
    }

    // Send hour-before reminders
    for (const assignment of (hourBeforeJobs || [])) {
      const cleaner = assignment.cleaners as any;
      const job = assignment.jobs as any;

      if (!cleaner?.phone_verified || !cleaner?.sms_notifications_enabled) {
        logStep("Skipping hour reminder - SMS not enabled", { cleanerId: cleaner?.id });
        continue;
      }

      if (!job?.start_datetime) {
        continue;
      }

      const jobTime = new Date(job.start_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const message = `⏰ Job starts in 1 hour!

📍 ${job.address || job.city}, ${job.zip}
🕐 ${jobTime}

Open app for directions. Don't forget to CHECK IN when you arrive!`;

      try {
        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: cleaner.phone,
            message,
            type: "reminder",
            jobAssignmentId: assignment.id,
            cleanerId: cleaner.id
          }
        });

        // Mark as sent
        await supabase
          .from("job_assignments")
          .update({ hour_before_reminder_sent: true })
          .eq("id", assignment.id);

        remindersSent++;
        logStep("Hour-before reminder sent", { assignmentId: assignment.id, cleaner: cleaner.first_name });
      } catch (error: any) {
        errors.push({ assignmentId: assignment.id, type: 'hour_before', error: error.message });
        logStep("Error sending hour-before reminder", { error: error.message });
      }
    }

    logStep("Job reminder processing complete", { 
      remindersSent, 
      dayBeforeCount: dayBeforeJobs?.length || 0,
      hourBeforeCount: hourBeforeJobs?.length || 0,
      errors: errors.length 
    });

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        day_before_jobs: dayBeforeJobs?.length || 0,
        hour_before_jobs: hourBeforeJobs?.length || 0,
        errors: errors.length > 0 ? errors : undefined
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
