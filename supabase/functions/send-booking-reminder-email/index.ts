import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-REMINDER-EMAIL] ${step}${detailsStr}`);
};

const formatTimeSlot = (slot: string) => {
  const parts = slot.split('-');
  if (parts.length === 2) {
    const startHour = parseInt(parts[0]);
    const endHour = parseInt(parts[1]);
    const formatHour = (h: number) => {
      const period = h >= 12 ? 'PM' : 'AM';
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hour}:00 ${period}`;
    };
    return `${formatHour(startHour)} - ${formatHour(endHour)}`;
  }
  return slot;
};

const formatServiceType = (type: string) => {
  const types: Record<string, string> = {
    standard: 'Standard Cleaning',
    deep: 'Deep Cleaning',
    moveInOut: 'Move In/Out Cleaning',
  };
  return types[type] || type;
};

const generateReminderEmail = (data: any) => {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
      .button { display: inline-block; background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; font-size: 16px; }
      .highlight { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px; margin: 20px 0; border-radius: 4px; }
      .detail-box { background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .detail-row { display: flex; padding: 8px 0; }
      .detail-label { font-weight: 600; width: 120px; color: #6B7280; }
      .detail-value { flex: 1; color: #111827; }
      .footer { text-align: center; padding: 20px; color: #6B7280; font-size: 14px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }
      .urgent { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 16px; margin: 20px 0; border-radius: 4px; color: #991B1B; }
    </style>
  `;

  const formattedDate = data.serviceDate 
    ? new Date(data.serviceDate).toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : '';

  const is24Hour = data.reminderType === '24_hour';

  return {
    subject: is24Hour 
      ? '⚠️ Last Chance: Complete Your Novara Booking'
      : '🧹 Complete Your Novara Cleaning Booking',
    html: `
      ${baseStyles}
      <div class="container">
        <div class="header">
          <h1>${is24Hour ? '⏰ Your Booking is Waiting!' : '🧹 Complete Your Booking'}</h1>
          <p style="margin: 10px 0 0 0; font-size: 18px;">Don't miss out on your cleaning service!</p>
        </div>
        <div class="content">
          <p>Hi ${data.firstName || 'there'},</p>
          
          ${is24Hour ? `
          <div class="urgent">
            <p style="margin: 0; font-weight: 600;">⚠️ Your booking will expire soon!</p>
            <p style="margin: 8px 0 0 0; font-size: 14px;">Complete your payment in the next few hours to secure your cleaning appointment.</p>
          </div>
          ` : `
          <p>We noticed you started booking a cleaning service with Novara but didn't complete your payment. Your spot is still available!</p>
          `}

          <div class="detail-box">
            <h3 style="margin-top: 0; color: #8B5CF6;">📅 Your Service Details</h3>
            
            <div class="detail-row">
              <div class="detail-label">Date:</div>
              <div class="detail-value"><strong>${formattedDate}</strong></div>
            </div>
            
            <div class="detail-row">
              <div class="detail-label">Time:</div>
              <div class="detail-value"><strong>${formatTimeSlot(data.timeSlot || '')}</strong></div>
            </div>
            
            <div class="detail-row">
              <div class="detail-label">Service:</div>
              <div class="detail-value">${formatServiceType(data.serviceType || '')}</div>
            </div>
            
            <div class="detail-row" style="border-bottom: none;">
              <div class="detail-label">Amount:</div>
              <div class="detail-value">
                <strong>$${((data.paymentOption === 'deposit' ? data.depositAmount : data.totalAmount) / 100).toFixed(2)}</strong>
                ${data.paymentOption === 'deposit' ? ' deposit' : ' (full payment - save 10%!)'}
              </div>
            </div>
          </div>

          ${!is24Hour ? `
          <div class="highlight">
            <p style="margin: 0; font-weight: 600;">💡 Why Choose Novara?</p>
            <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 14px;">
              <li>Professional, vetted cleaning teams</li>
              <li>Flexible scheduling and easy rescheduling</li>
              <li>Satisfaction guarantee on every service</li>
              <li>Secure payment processing</li>
            </ul>
          </div>
          ` : ''}

          <p style="text-align: center;">
            <a href="${data.checkoutUrl}" class="button">
              ${is24Hour ? '🚀 Complete Payment Now' : '✨ Complete Your Booking'}
            </a>
          </p>

          <p style="font-size: 14px; color: #6B7280; text-align: center;">
            Booking Reference: <strong>${data.bookingId}</strong>
          </p>

          ${is24Hour ? `
          <p style="text-align: center; color: #6B7280; font-size: 14px; margin-top: 20px;">
            Need help or have questions? Reply to this email or call us at (555) 123-4567
          </p>
          ` : `
          <p>Have questions or need to adjust your booking? Just reply to this email and we'll help you out!</p>
          `}
          
          <p>Best regards,<br><strong>The Novara Team</strong></p>
        </div>
        <div class="footer">
          <p>You're receiving this because you started a booking at Novara Cleaning.</p>
          <p style="margin-top: 8px; font-size: 12px;">
            Not interested? You can safely ignore this email. Your booking will automatically expire after 48 hours.
          </p>
          <p style="margin-top: 8px;">© ${new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
        </div>
      </div>
    `,
  };
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { email, data } = await req.json();
    logStep("Email request received", { email, reminderType: data.reminderType });

    if (!email) {
      throw new Error("Email address is required");
    }

    const emailContent = generateReminderEmail(data);

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <onboarding@resend.dev>",
      to: [email],
      subject: emailContent.subject,
      html: emailContent.html,
    });

    logStep("Email sent successfully", { messageId: emailResponse });

    return new Response(JSON.stringify({ success: true, messageId: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    logStep("ERROR sending email", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
