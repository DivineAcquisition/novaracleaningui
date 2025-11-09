import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-EMAIL] ${step}${detailsStr}`);
};

interface BookingEmailRequest {
  type: 'confirmation' | 'payment_receipt';
  email: string;
  data: {
    firstName?: string;
    lastName?: string;
    bookingId?: string;
    serviceDate?: string;
    timeSlot?: string;
    serviceType?: string;
    homeSize?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    totalAmount?: number;
    depositAmount?: number;
    balanceAmount?: number;
    paymentOption?: string;
    useCredit?: boolean;
    addOns?: string[];
  };
}

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

const formatAddOns = (addOns: string[]) => {
  if (!addOns || addOns.length === 0) return '';
  
  const addOnLabels: Record<string, string> = {
    fridge: 'Refrigerator Cleaning',
    oven: 'Oven Cleaning',
    windows: 'Interior Windows',
  };
  
  return addOns.map(addon => addOnLabels[addon] || addon).join(', ');
};

const generateEmailContent = (type: string, data: any) => {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
      .button { display: inline-block; background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
      .highlight { background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .detail-row { display: flex; padding: 12px 0; border-bottom: 1px solid #E5E7EB; }
      .detail-label { font-weight: 600; width: 140px; color: #6B7280; }
      .detail-value { flex: 1; color: #111827; }
      .footer { text-align: center; padding: 20px; color: #6B7280; font-size: 14px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb; border-top: none; }
      .success-badge { background: #10B981; color: white; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; display: inline-block; }
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

  switch (type) {
    case 'confirmation':
      return {
        subject: `Booking Confirmed! Your Novara Cleaning on ${formattedDate} ✨`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>🎉 Booking Confirmed!</h1>
              <p style="margin: 10px 0 0 0; font-size: 18px;">Thank you for choosing Novara Cleaning</p>
            </div>
            <div class="content">
              <p>Hi ${data.firstName || 'there'},</p>
              <p>Your cleaning service has been successfully booked! We're excited to make your home sparkle.</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0; color: #8B5CF6;">📅 Booking Details</h3>
                
                <div class="detail-row">
                  <div class="detail-label">Date:</div>
                  <div class="detail-value"><strong>${formattedDate}</strong></div>
                </div>
                
                <div class="detail-row">
                  <div class="detail-label">Time Window:</div>
                  <div class="detail-value"><strong>${formatTimeSlot(data.timeSlot || '')}</strong></div>
                </div>
                
                <div class="detail-row">
                  <div class="detail-label">Service:</div>
                  <div class="detail-value">${formatServiceType(data.serviceType || '')}</div>
                </div>
                
                ${data.addOns && data.addOns.length > 0 ? `
                <div class="detail-row">
                  <div class="detail-label">Add-ons:</div>
                  <div class="detail-value">${formatAddOns(data.addOns)}</div>
                </div>
                ` : ''}
                
                <div class="detail-row">
                  <div class="detail-label">Home Size:</div>
                  <div class="detail-value">${data.homeSize || ''}</div>
                </div>
                
                <div class="detail-row" style="border-bottom: none;">
                  <div class="detail-label">Location:</div>
                  <div class="detail-value">${data.address}<br>${data.city}, ${data.state} ${data.zipCode}</div>
                </div>
              </div>

              ${data.useCredit ? `
              <div style="background: #10B981; color: white; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0; font-weight: 600;">✨ Membership Credit Used</p>
                <p style="margin: 8px 0 0 0; font-size: 14px;">This cleaning is covered by your membership credit!</p>
              </div>
              ` : data.paymentOption === 'deposit' ? `
              <div class="highlight">
                <h4 style="margin-top: 0;">💳 Payment Summary</h4>
                <div class="detail-row">
                  <div class="detail-label">Deposit Paid:</div>
                  <div class="detail-value"><strong>$${((data.depositAmount || 0) / 100).toFixed(2)}</strong></div>
                </div>
                <div class="detail-row" style="border-bottom: none;">
                  <div class="detail-label">Balance Due:</div>
                  <div class="detail-value">$${((data.balanceAmount || 0) / 100).toFixed(2)} (after service)</div>
                </div>
              </div>
              ` : `
              <div class="highlight">
                <h4 style="margin-top: 0;">💳 Payment Summary</h4>
                <div class="detail-row" style="border-bottom: none;">
                  <div class="detail-label">Amount Paid:</div>
                  <div class="detail-value"><strong>$${((data.totalAmount || 0) / 100).toFixed(2)}</strong> <span class="success-badge">PAID IN FULL</span></div>
                </div>
                <p style="margin: 12px 0 0 0; font-size: 14px; color: #10B981;">✓ You saved 10% by paying in full!</p>
              </div>
              `}

              <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <h4 style="margin: 0 0 8px 0; color: #92400E;">📋 What to Expect:</h4>
                <ul style="margin: 0; padding-left: 20px; color: #78350F;">
                  <li>You'll receive a reminder 24 hours before your cleaning</li>
                  <li>Our team will arrive during your selected time window</li>
                  <li>Please ensure access to your home (key, code, etc.)</li>
                  <li>Secure any valuables or fragile items</li>
                </ul>
              </div>

              <p style="text-align: center;">
                <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/account" class="button">View Booking Details</a>
              </p>
              
              <p>Questions or need to reschedule? Contact us at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a> or call (555) 123-4567</p>
              
              <p>Best regards,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p>Booking Reference: <strong>${data.bookingId}</strong></p>
              <p style="margin-top: 8px;">© ${new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
            </div>
          </div>
        `,
      };

    case 'payment_receipt':
      return {
        subject: `Payment Received - Novara Cleaning Receipt`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>💳 Payment Receipt</h1>
              <p style="margin: 10px 0 0 0; font-size: 18px;">Thank you for your payment</p>
            </div>
            <div class="content">
              <p>Hi ${data.firstName || 'there'},</p>
              <p>We've received your payment for your upcoming Novara cleaning service.</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0; color: #8B5CF6;">💰 Payment Details</h3>
                
                <div class="detail-row">
                  <div class="detail-label">Amount Paid:</div>
                  <div class="detail-value"><strong>$${((data.totalAmount || 0) / 100).toFixed(2)}</strong></div>
                </div>
                
                <div class="detail-row">
                  <div class="detail-label">Payment Type:</div>
                  <div class="detail-value">${data.paymentOption === 'full' ? 'Paid in Full' : 'Deposit'}</div>
                </div>
                
                <div class="detail-row">
                  <div class="detail-label">Date:</div>
                  <div class="detail-value">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                </div>
                
                <div class="detail-row" style="border-bottom: none;">
                  <div class="detail-label">Reference:</div>
                  <div class="detail-value">${data.bookingId}</div>
                </div>
              </div>

              <div class="highlight">
                <h3 style="margin-top: 0;">🏠 Service Details</h3>
                
                <div class="detail-row">
                  <div class="detail-label">Service Date:</div>
                  <div class="detail-value">${formattedDate}</div>
                </div>
                
                <div class="detail-row">
                  <div class="detail-label">Time:</div>
                  <div class="detail-value">${formatTimeSlot(data.timeSlot || '')}</div>
                </div>
                
                <div class="detail-row" style="border-bottom: none;">
                  <div class="detail-label">Service Type:</div>
                  <div class="detail-value">${formatServiceType(data.serviceType || '')}</div>
                </div>
              </div>

              ${data.paymentOption === 'deposit' && data.balanceAmount ? `
              <div style="background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 16px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #92400E;"><strong>Remaining Balance:</strong> $${((data.balanceAmount || 0) / 100).toFixed(2)}</p>
                <p style="margin: 8px 0 0 0; font-size: 14px; color: #78350F;">This will be charged after your cleaning is complete.</p>
              </div>
              ` : ''}

              <p style="text-align: center;">
                <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/account" class="button">View Full Receipt</a>
              </p>
              
              <p>Need a copy of this receipt? It's always available in your account dashboard.</p>
              
              <p>Questions? Contact us at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a></p>
              
              <p>Best regards,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p>This is an automated receipt for your records.</p>
              <p style="margin-top: 8px;">© ${new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
            </div>
          </div>
        `,
      };

    default:
      throw new Error(`Unknown email type: ${type}`);
  }
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { type, email, data }: BookingEmailRequest = await req.json();
    logStep("Email request received", { type, email });

    if (!email) {
      throw new Error("Email address is required");
    }

    const emailContent = generateEmailContent(type, data);

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
