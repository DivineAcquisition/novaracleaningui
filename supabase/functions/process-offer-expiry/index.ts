import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { createHmac } from "https://deno.land/std@0.190.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OFFER_EXPIRY_MINUTES = 15;
const REMINDER_AT_MINUTES = 10;
const ADMIN_PHONE = "4436486798";

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[OFFER-EXPIRY] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting offer expiry check");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    const expiryThreshold = new Date(now.getTime() - OFFER_EXPIRY_MINUTES * 60 * 1000);
    const reminderThreshold = new Date(now.getTime() - REMINDER_AT_MINUTES * 60 * 1000);

    // --- 1. Send reminders for offers approaching expiry (10+ min old, no reminder sent) ---
    const { data: needsReminder } = await supabase
      .from("job_assignments")
      .select("*, cleaners(first_name, phone, sms_notifications_enabled), jobs(city, zip, start_datetime, duration_est_hours)")
      .eq("status", "Offered")
      .is("reminder_sent_at", null)
      .lte("assigned_at", reminderThreshold.toISOString());

    let remindersSent = 0;
    for (const assignment of needsReminder || []) {
      if (!assignment.cleaners?.sms_notifications_enabled || !assignment.cleaners?.phone) continue;

      try {
        const minutesLeft = Math.max(1, OFFER_EXPIRY_MINUTES - Math.floor((now.getTime() - new Date(assignment.assigned_at).getTime()) / 60000));

        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: assignment.cleaners.phone,
            message: `⏰ Reminder: You have a pending job offer expiring in ~${minutesLeft} min! ${assignment.jobs?.city || ''}, ${assignment.jobs?.zip || ''}. Pay: $${((assignment.pay_rate_hr || 18) * (assignment.jobs?.duration_est_hours || 3)).toFixed(2)}. Open your link to accept/decline now.`,
            type: "job_offer",
            jobAssignmentId: assignment.id,
          },
        });

        await supabase
          .from("job_assignments")
          .update({
            reminder_sent_at: now.toISOString(),
            reminder_count: (assignment.reminder_count || 0) + 1,
          })
          .eq("id", assignment.id);

        remindersSent++;
      } catch (err) {
        logStep("Reminder send failed", { assignmentId: assignment.id, error: err });
      }
    }

    logStep(`Sent ${remindersSent} reminders`);

    // --- 2. Expire offers that are past the threshold ---
    const { data: expiredOffers } = await supabase
      .from("job_assignments")
      .select("*, cleaners(first_name, last_name, phone, id), jobs(id, city, zip, start_datetime, duration_est_hours, min_cleaners_required, status)")
      .eq("status", "Offered")
      .lte("assigned_at", expiryThreshold.toISOString());

    let expiredCount = 0;
    const jobsNeedingRedispatch = new Set<string>();

    for (const assignment of expiredOffers || []) {
      await supabase
        .from("job_assignments")
        .update({
          status: "Expired",
          responded_at: now.toISOString(),
        })
        .eq("id", assignment.id);

      // Update cleaner metrics (count as non-acceptance)
      if (assignment.cleaners?.id) {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("total_offers_received")
          .eq("id", assignment.cleaners.id)
          .single();

        await supabase
          .from("cleaners")
          .update({
            total_offers_received: (cleaner?.total_offers_received || 0) + 1,
          })
          .eq("id", assignment.cleaners.id);
      }

      // Notify cleaner that their offer expired
      if (assignment.cleaners?.phone) {
        await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone: assignment.cleaners.phone,
            message: `Your job offer for ${assignment.jobs?.city || 'a cleaning'} has expired (no response within ${OFFER_EXPIRY_MINUTES} min). Future offers depend on response rate - please respond promptly!`,
            type: "job_offer",
            jobAssignmentId: assignment.id,
          },
        }).catch(() => {});
      }

      if (assignment.jobs?.id) {
        jobsNeedingRedispatch.add(assignment.jobs.id);
      }

      expiredCount++;
    }

    logStep(`Expired ${expiredCount} offers`);

    // --- 3. Re-dispatch jobs that lost cleaners ---
    let redispatchCount = 0;
    for (const jobId of jobsNeedingRedispatch) {
      const { data: remainingAssignments } = await supabase
        .from("job_assignments")
        .select("id, status")
        .eq("job_id", jobId)
        .in("status", ["Offered", "Confirmed"]);

      const { data: job } = await supabase
        .from("jobs")
        .select("min_cleaners_required")
        .eq("id", jobId)
        .single();

      const confirmedCount = (remainingAssignments || []).filter(a => a.status === "Confirmed").length;
      const offeredCount = (remainingAssignments || []).filter(a => a.status === "Offered").length;
      const needed = (job?.min_cleaners_required || 2) - confirmedCount - offeredCount;

      if (needed > 0) {
        logStep("Re-dispatching job", { jobId, needed, confirmedCount, offeredCount });

        try {
          await supabase.functions.invoke("dispatch-job", {
            body: { jobId },
          });
          redispatchCount++;
        } catch (dispatchErr) {
          logStep("Re-dispatch failed", { jobId, error: dispatchErr });

          await supabase.from("dispatch_alerts").insert({
            job_id: jobId,
            reason: `Auto re-dispatch failed after offer expiry. ${needed} more cleaners needed.`,
            severity: "critical",
          });

          // Notify admin
          await supabase.functions.invoke("send-sms-notification", {
            body: {
              toPhone: ADMIN_PHONE,
              message: `🚨 DISPATCH ALERT: Job ${jobId.slice(0, 8)} needs ${needed} more cleaner(s). Offers expired with no response. Manual assignment may be required.`,
              type: "reminder",
            },
          }).catch(() => {});
        }
      }
    }

    logStep(`Re-dispatched ${redispatchCount} jobs`);

    return new Response(
      JSON.stringify({
        success: true,
        reminders: remindersSent,
        expired: expiredCount,
        redispatched: redispatchCount,
        timestamp: now.toISOString(),
      }),
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
