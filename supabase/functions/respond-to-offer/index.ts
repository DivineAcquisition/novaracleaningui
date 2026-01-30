import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

    // Verify token (simple hash of assignment ID for this implementation)
    const expectedToken = btoa(assignmentId).substring(0, 10);
    if (token !== expectedToken) {
      throw new Error("Invalid token");
    }

    // Get assignment details
    const { data: assignment, error: fetchError } = await supabase
      .from("job_assignments")
      .select("*, jobs(*), cleaners(*)")
      .eq("id", assignmentId)
      .single();

    if (fetchError || !assignment) {
      throw new Error("Assignment not found");
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

    // If accepted, update cleaner scores and send confirmation SMS
    if (action === "accept") {
      await supabase.functions.invoke("update-cleaner-scores", {
        body: { cleanerId: assignment.cleaner_id }
      });

      // Send confirmation SMS
      if (assignment.cleaners.phone_verified && assignment.cleaners.sms_notifications_enabled) {
        const jobDate = new Date(assignment.jobs.start_datetime).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });
        const jobTime = new Date(assignment.jobs.start_datetime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });

        try {
          await supabase.functions.invoke("send-sms-notification", {
            body: {
              toPhone: assignment.cleaners.phone,
              message: `✅ JOB CONFIRMED!

📅 ${jobDate} at ${jobTime}
📍 ${assignment.jobs.address || assignment.jobs.city}, ${assignment.jobs.zip}

Check the app for customer details and notes. Arrive 5 min early!

Questions? Reply HELP`,
              type: "confirmation",
              jobAssignmentId: assignment.id,
              cleanerId: assignment.cleaner_id
            }
          });
        } catch (smsError) {
          console.error("[SMS] Failed to send confirmation:", smsError);
        }
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
