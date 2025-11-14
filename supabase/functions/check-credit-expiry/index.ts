import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-CREDIT-EXPIRY] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find credits expiring in 3 days
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const threeDaysFromNowISO = threeDaysFromNow.toISOString().split('T')[0];

    logStep("Checking for credits expiring on", { date: threeDaysFromNowISO });

    const { data: expiringCredits, error: fetchError } = await supabase
      .from('membership_credits')
      .select('*')
      .gte('credits_remaining', 1) // Only notify if they have unused credits
      .lte('current_period_end', threeDaysFromNowISO + 'T23:59:59')
      .gte('current_period_end', threeDaysFromNowISO + 'T00:00:00');

    if (fetchError) {
      logStep("Error fetching expiring credits", fetchError);
      throw fetchError;
    }

    logStep(`Found ${expiringCredits?.length || 0} expiring credit records`);

    if (!expiringCredits || expiringCredits.length === 0) {
      return new Response(JSON.stringify({ message: "No expiring credits found", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Send notifications for each expiring credit
    let successCount = 0;
    let failureCount = 0;

    for (const credit of expiringCredits) {
      try {
        // Get customer info for phone number
        const { data: customer } = await supabase
          .from('customers')
          .select('phone, first_name, last_name')
          .eq('id', credit.customer_id)
          .single();

        const expiryDate = new Date(credit.current_period_end).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        const planLabel = {
          'monthly': 'Novara Monthly',
          'biweekly': 'Novara Bi-Weekly',
          'weekly': 'Novara Weekly',
        }[credit.membership_plan as 'monthly' | 'biweekly' | 'weekly'] || credit.membership_plan;

        // Send email notification
        try {
          const emailResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-membership-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              type: 'credit_expiry_warning',
              email: credit.email,
              data: {
                name: customer ? `${customer.first_name} ${customer.last_name}` : '',
                plan: planLabel,
                credits: credit.credits_remaining,
                expiryDate,
              },
            }),
          });

          if (!emailResponse.ok) {
            logStep("Email notification failed", { email: credit.email, status: emailResponse.status });
          } else {
            logStep("Email notification sent", { email: credit.email });
          }
        } catch (emailError) {
          logStep("Error sending email", { error: emailError, email: credit.email });
        }

        // Send SMS notification if phone number available
        if (customer?.phone) {
          try {
            const smsMessage = `Novara reminder: You have ${credit.credits_remaining} cleaning credit${credit.credits_remaining > 1 ? 's' : ''} expiring on ${expiryDate}. Book now: ${Deno.env.get("SUPABASE_URL")?.replace('https://sxdraeptzuamsgjcvfeg.supabase.co', 'https://novaracleaning.com')}/book`;

            const smsResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
                toPhone: customer.phone,
                message: smsMessage,
                type: 'reminder',
              }),
            });

            if (!smsResponse.ok) {
              logStep("SMS notification failed", { phone: customer.phone, status: smsResponse.status });
            } else {
              logStep("SMS notification sent", { phone: customer.phone });
            }
          } catch (smsError) {
            logStep("Error sending SMS", { error: smsError, phone: customer.phone });
          }
        }

        successCount++;
      } catch (error) {
        logStep("Error processing credit record", { error, creditId: credit.id });
        failureCount++;
      }
    }

    logStep("Notifications complete", { success: successCount, failures: failureCount });

    return new Response(JSON.stringify({
      message: "Credit expiry notifications processed",
      total: expiringCredits.length,
      success: successCount,
      failures: failureCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    logStep("ERROR in check-credit-expiry", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
