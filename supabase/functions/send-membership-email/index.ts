import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-MEMBERSHIP-EMAIL] ${step}${detailsStr}`);
};

interface MembershipEmailRequest {
  type: 'welcome' | 'renewal' | 'credit_allocated' | 'subscription_cancelled';
  email: string;
  data: {
    name?: string;
    plan?: string;
    credits?: number;
    renewalDate?: string;
    amount?: number;
  };
}

const generateEmailContent = (type: string, data: any) => {
  const baseStyles = `
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
      .container { max-width: 600px; margin: 0 auto; padding: 20px; }
      .header { background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
      .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
      .button { display: inline-block; background: linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%); color: white; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
      .highlight { background: #F3F4F6; padding: 20px; border-radius: 8px; margin: 20px 0; }
      .footer { text-align: center; padding: 20px; color: #6B7280; font-size: 14px; }
    </style>
  `;

  switch (type) {
    case 'welcome':
      return {
        subject: `Welcome to Novara ${data.plan} Membership! 🎉`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>Welcome to Novara!</h1>
            </div>
            <div class="content">
              <p>Hi ${data.name || 'there'},</p>
              <p>Thank you for becoming a <strong>${data.plan}</strong> member! We're thrilled to have you join the Novara family.</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0;">Your Membership Benefits:</h3>
                <ul>
                  <li><strong>${data.credits} cleaning credit(s)</strong> added to your account</li>
                  <li>Exclusive discounts on all add-ons</li>
                  <li>Priority scheduling and support</li>
                  <li>Flexible rescheduling options</li>
                </ul>
              </div>

              <p>Your credits are ready to use! Book your first cleaning and experience the Novara difference.</p>
              
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/book/home" class="button">Book Your Cleaning</a>
              
              <p>Need help? Our team is here for you at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a></p>
              
              <p>Best regards,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p>You're receiving this because you subscribed to Novara ${data.plan} membership.</p>
            </div>
          </div>
        `,
      };

    case 'renewal':
      return {
        subject: `Your Novara Membership Has Been Renewed 🔄`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>Membership Renewed</h1>
            </div>
            <div class="content">
              <p>Hi ${data.name || 'there'},</p>
              <p>Your <strong>${data.plan}</strong> membership has been successfully renewed!</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0;">Renewal Summary:</h3>
                <ul>
                  <li><strong>Amount charged:</strong> $${(data.amount! / 100).toFixed(2)}</li>
                  <li><strong>Next renewal:</strong> ${new Date(data.renewalDate!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                </ul>
              </div>

              <p>Your credits have been refreshed and are ready to use. Continue enjoying your spotless home with Novara!</p>
              
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/book/home" class="button">Book Your Next Cleaning</a>
              
              <p>Questions? Reach out at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a></p>
              
              <p>Best regards,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p><a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/account">Manage your subscription</a></p>
            </div>
          </div>
        `,
      };

    case 'credit_allocated':
      return {
        subject: `${data.credits} New Cleaning Credit(s) Added! ✨`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>Credits Added!</h1>
            </div>
            <div class="content">
              <p>Hi ${data.name || 'there'},</p>
              <p>Great news! <strong>${data.credits} new cleaning credit(s)</strong> have been added to your ${data.plan} membership account.</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0;">Ready to Use:</h3>
                <p style="font-size: 32px; font-weight: bold; color: #8B5CF6; margin: 10px 0;">${data.credits} Credit${data.credits > 1 ? 's' : ''}</p>
                <p style="margin: 0;">Valid until ${new Date(data.renewalDate!).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              </div>

              <p>Book your cleaning today and enjoy the convenience of a professionally cleaned home!</p>
              
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/book/home" class="button">Use Your Credits</a>
              
              <p>Need assistance? Contact us at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a></p>
              
              <p>Best regards,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p>Your credits never expire within your billing period.</p>
            </div>
          </div>
        `,
      };

    case 'subscription_cancelled':
      return {
        subject: `Your Novara Membership Has Been Cancelled`,
        html: `
          ${baseStyles}
          <div class="container">
            <div class="header">
              <h1>Subscription Cancelled</h1>
            </div>
            <div class="content">
              <p>Hi ${data.name || 'there'},</p>
              <p>We're sorry to see you go. Your <strong>${data.plan}</strong> membership has been successfully cancelled.</p>
              
              <div class="highlight">
                <p><strong>What happens next:</strong></p>
                <ul>
                  <li>You'll retain access until your current billing period ends</li>
                  <li>Any unused credits will expire at the end of the period</li>
                  <li>You can still book one-time cleanings anytime</li>
                </ul>
              </div>

              <p>Changed your mind? You can resubscribe anytime to get back to convenient, regular cleaning!</p>
              
              <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/membership" class="button">View Membership Plans</a>
              
              <p>We'd love to hear your feedback at <a href="mailto:support@novaracleaning.com">support@novaracleaning.com</a></p>
              
              <p>Thank you for being a valued customer,<br><strong>The Novara Team</strong></p>
            </div>
            <div class="footer">
              <p>You can still book one-time cleanings anytime at <a href="${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}">novaracleaning.com</a></p>
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

    const { type, email, data }: MembershipEmailRequest = await req.json();
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
