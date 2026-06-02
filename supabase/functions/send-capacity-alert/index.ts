import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px; }
            .alert-box { background: ${urgencyLevel === 'FULL' ? '#dc2626' : '#f59e0b'}; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .alert-box h2 { margin: 0 0 10px 0; font-size: 28px; }
            .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
            .detail-label { font-weight: 600; color: #6b7280; }
            .detail-value { font-weight: 500; color: #111827; }
            .capacity-bar { background: #e5e7eb; height: 30px; border-radius: 15px; overflow: hidden; margin: 15px 0; }
            .capacity-fill { background: ${urgencyLevel === 'FULL' ? '#dc2626' : '#f59e0b'}; height: 100%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; transition: width 0.3s ease; }
            .action-button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }
            .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>⚠️ Capacity Alert - NovaRaCleaning</h1>
            </div>
            <div class="content">
              <div class="alert-box">
                <h2>${urgencyLevel === 'FULL' ? '🚨 SLOT FULLY BOOKED' : '⚡ SLOT FILLING UP'}</h2>
                <p style="margin: 0; font-size: 18px;">${current_bookings} of ${max_capacity} spots taken (${capacityPercentage}%)</p>
              </div>

              <div style="margin: 20px 0;">
                <div class="detail-row">
                  <span class="detail-label">Date:</span>
                  <span class="detail-value">${formattedDate}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Time Slot:</span>
                  <span class="detail-value">${time_slot}</span>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                  <span class="detail-label">Status:</span>
                  <span class="detail-value" style="color: ${urgencyLevel === 'FULL' ? '#dc2626' : '#f59e0b'}; font-weight: 700;">${urgencyLevel}</span>
                </div>
              </div>

              <div class="capacity-bar">
                <div class="capacity-fill" style="width: ${capacityPercentage}%;">${capacityPercentage}%</div>
              </div>

              <p style="margin: 20px 0; color: #6b7280;">
                ${urgencyLevel === 'FULL' 
                  ? 'This time slot is now fully booked. Consider adding additional capacity or notifying customers of alternative times.' 
                  : 'This time slot is filling up quickly. You may want to review cleaner availability and prepare for potential capacity issues.'}
              </p>

              <div style="text-align: center;">
                <a href="https://admin.novaracleaning.com/admin/csr" class="action-button">View Admin Dashboard</a>
              </div>

              <div class="footer">
                <p>© 2025 NovaRaCleaning. All Rights Reserved.</p>
                <p>This is an automated capacity alert. Please do not reply to this email.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const { data, error } = await resend.emails.send({
      from: "NovaRaCleaning Alerts <hello@novaracleaning.com>",
      to: ["admin@novaracleaning.com"], // Update with actual admin email(s)
      subject: `${urgencyLevel === 'FULL' ? '🚨 FULL' : '⚡ FILLING UP'} - ${formattedDate} at ${time_slot}`,
      html: emailHtml,
    });

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
