import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CapacityAlertData {
  service_date: string;
  time_slot: string;
  current_bookings: number;
  max_capacity: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { service_date, time_slot, current_bookings, max_capacity }: CapacityAlertData = await req.json();
    
    const capacityPercentage = Math.round((current_bookings / max_capacity) * 100);
    const urgencyLevel = current_bookings === max_capacity ? "FULL" : "FILLING UP";
    
    console.log("Sending capacity alert:", { service_date, time_slot, current_bookings, max_capacity });

    // Format date for display
    const formattedDate = new Date(service_date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const emailHtml = `
      <h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">${urgencyLevel === "FULL" ? "Slot fully booked" : "Slot filling up"}</h1>
      <p style="margin:0 0 16px;font-size:18px;color:#ffffff;">${current_bookings} of ${max_capacity} spots taken (${capacityPercentage}%)</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Date</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;text-align:right;">${formattedDate}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Time slot</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;text-align:right;">${time_slot}</td></tr>
        <tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Status</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;text-align:right;">${urgencyLevel}</td></tr>
      </table>
      <p>
        ${urgencyLevel === "FULL"
          ? "This time slot is now fully booked. Consider adding additional capacity or notifying customers of alternative times."
          : "This time slot is filling up quickly. You may want to review cleaner availability and prepare for potential capacity issues."}
      </p>
      <p style="margin:22px 0 0;"><a class="novara-btn" href="https://admin.novaracleaning.com/admin/csr" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">View Admin Dashboard</a></p>
    `;

    const sent = await sendThroughCompliance(Deno.env.get("RESEND_API_KEY") || "", {
      to: "admin@novaracleaning.com",
      subject: `${urgencyLevel === "FULL" ? "FULL" : "FILLING UP"} - ${formattedDate} at ${time_slot}`,
      html: emailHtml,
      templateKey: "admin_internal_notice",
      declaredType: "internal_admin",
      staffRecipient: true,
    });
    const data = sent.data;
    const error = sent.error;

    if (error) {
      console.error("Error sending capacity alert:", error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    console.log("Capacity alert sent successfully:", data);
    
    return new Response(
      JSON.stringify({ success: true, messageId: data?.id }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error: any) {
    console.error("Error in send-capacity-alert:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
