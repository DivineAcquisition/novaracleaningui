import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";
import { smsActionTail } from "../_shared/booking-policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const assignmentId = url.searchParams.get("id");
    const action = url.searchParams.get("action"); // "accept" or "decline"
    const token = url.searchParams.get("token");

    if (!assignmentId || !action || !token) {
      throw new Error("Missing required parameters");
    }

    console.log(`[RESPOND] Assignment ${assignmentId} - Action: ${action}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get assignment and verify token against stored response_token
    const { data: assignment, error: fetchError } = await supabase
      .from("job_assignments")
      .select("*, jobs(*), cleaners(*), reliability_neutral")
      .eq("id", assignmentId)
      .single();

    if (fetchError || !assignment) {
      throw new Error("Assignment not found");
    }

    // Verify token against stored response_token (fallback to legacy btoa for pre-migration assignments)
    const expectedToken = assignment.response_token ?? btoa(assignmentId).substring(0, 10);
    if (token !== expectedToken) {
      throw new Error("Invalid token");
    }

    // Check if already responded
    if (assignment.status !== "Offered") {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>Job Offer Response</title></head>
          <body style="font-family: sans-serif; padding: 20px; text-align: center;">
            <h1>⚠️ Already Responded</h1>
            <p>You have already responded to this job offer.</p>
            <p><a href="https://sxdraeptzuamsgjcvfeg.supabase.co">View Dashboard</a></p>
          </body>
        </html>
        `,
        { headers: { ...corsHeaders, "Content-Type": "text/html" } }
      );
    }

    // Update assignment status
    const newStatus = action === "accept" ? "Confirmed" : "Declined";
    const { error: updateError } = await supabase
      .from("job_assignments")
      .update({ 
        status: newStatus,
        responded_at: new Date().toISOString()
      })
      .eq("id", assignmentId);

    if (updateError) {
      throw updateError;
    }

    const { data: bookingForJob } = await supabase
      .from("bookings")
      .select("id, is_reclean, phone, first_name, service_date, time_slot")
      .eq("job_id", assignment.job_id)
      .maybeSingle();
    const reliabilityNeutral = assignment.reliability_neutral === true || bookingForJob?.is_reclean === true;

    // Re-clean offers never count toward acceptance/reliability.
    if (!reliabilityNeutral) {
    // Update cleaner performance metrics
    const { data: cleaner } = await supabase
      .from('cleaners')
      .select('total_offers_received, total_offers_accepted')
      .eq('id', assignment.cleaner_id)
      .single();

    const newOffersReceived = (cleaner?.total_offers_received || 0) + 1;
    const newOffersAccepted = action === 'accept' 
      ? (cleaner?.total_offers_accepted || 0) + 1 
      : (cleaner?.total_offers_accepted || 0);
    const newAcceptanceRate = (newOffersAccepted / newOffersReceived) * 100;

    await supabase
      .from('cleaners')
      .update({
        total_offers_received: newOffersReceived,
        total_offers_accepted: newOffersAccepted,
        acceptance_rate: Math.round(newAcceptanceRate * 10) / 10
      })
      .eq('id', assignment.cleaner_id);
    }

    if (reliabilityNeutral && action === "decline" && bookingForJob?.id) {
      try {
        await supabase.functions.invoke("qc-reclean", {
          body: { action: "on_original_declined", bookingId: bookingForJob.id },
        });
      } catch (e) {
        console.error("[RESPOND] reclean fallback dispatch failed", e);
      }
    }
    if (reliabilityNeutral && action === "accept" && bookingForJob?.id) {
      try {
        await supabase.functions.invoke("qc-reclean", {
          body: { action: "on_offer_accepted", bookingId: bookingForJob.id, cleanerId: assignment.cleaner_id },
        });
      } catch (e) {
        console.error("[RESPOND] reclean accept stamp failed", e);
      }
    }

    // If accepted, update cleaner scores (skip re-clean offers — they are
    // reliability-neutral).
    if (action === "accept" && !reliabilityNeutral) {
      await supabase.functions.invoke("update-cleaner-scores", {
        body: { cleanerId: assignment.cleaner_id }
      });
    }

    if (action === "accept") {

      // Notify the customer that their cleaner has been confirmed.
      try {
        const { data: bookingForJob } = await supabase
          .from("bookings")
          .select("phone, first_name, service_date, time_slot")
          .eq("job_id", assignment.job_id)
          .maybeSingle();

        if (bookingForJob?.phone) {
          const cleanerName = `${assignment.cleaners?.first_name ?? ""} ${assignment.cleaners?.last_name ?? ""}`.trim() || "Your cleaner";
          const dateLabel = formatServiceDate(bookingForJob.service_date);
          const timeLabel = formatTimeSlot(bookingForJob.time_slot);
          await sendSms(supabase, {
            toPhone: bookingForJob.phone,
            message:
              `Novara Cleaning: ${cleanerName} has been confirmed for your cleaning` +
              (dateLabel ? ` on ${dateLabel}` : "") +
              (timeLabel ? ` (${timeLabel})` : "") +
              `. You'll get a reminder before service. ${smsActionTail()}`,
            type: "confirmation",
          });
          console.log("[RESPOND] Customer assignment SMS sent");
        }
      } catch (smsErr) {
        console.error("[RESPOND] Customer SMS failed (non-blocking)", smsErr);
      }
    }

    console.log(`[RESPOND] Updated assignment to ${newStatus}`);

    // Return success page
    const emoji = action === "accept" ? "✅" : "❌";
    const title = action === "accept" ? "Offer Accepted!" : "Offer Declined";
    const message = action === "accept" 
      ? "You've accepted this job. Check your dashboard for details."
      : "You've declined this job. We'll send you more offers soon.";

    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: sans-serif; padding: 20px; text-align: center; max-width: 600px; margin: 0 auto;">
          <h1>${emoji} ${title}</h1>
          <p style="font-size: 18px;">${message}</p>
          <div style="margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 8px; text-align: left;">
            <h3>Job Details:</h3>
            <p><strong>Date:</strong> ${new Date(assignment.jobs.start_datetime).toLocaleDateString()}</p>
            <p><strong>Location:</strong> ${assignment.jobs.city}, ${assignment.jobs.state}</p>
            <p><strong>Distance:</strong> ${assignment.distance_miles} miles</p>
          </div>
          <a href="https://sxdraeptzuamsgjcvfeg.supabase.co" style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px;">
            View Dashboard
          </a>
        </body>
      </html>
      `,
      { headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );

  } catch (error: any) {
    console.error("[RESPOND] Error:", error);
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>Error</title></head>
        <body style="font-family: sans-serif; padding: 20px; text-align: center;">
          <h1>❌ Error</h1>
          <p>${error.message}</p>
          <p><a href="https://sxdraeptzuamsgjcvfeg.supabase.co">Go to Dashboard</a></p>
        </body>
      </html>
      `,
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/html" } 
      }
    );
  }
});
