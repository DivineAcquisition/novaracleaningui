import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[COMPLETE-BOOKING] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bookingId } = await req.json();
    logStep("Marking booking complete", { bookingId });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify requester is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");
    
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await supabase.auth.getUser(token);
    const userId = userData?.user?.id;
    
    if (!userId) throw new Error("Not authenticated");
    
    // Check if user is admin
    const { data: roleCheck } = await supabase
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    
    if (!roleCheck) {
      throw new Error("Unauthorized - Admin only");
    }

    // Get booking details
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error("Booking not found");
    }

    if (!booking.cleaner_id) {
      throw new Error("No cleaner assigned to this booking");
    }

    logStep("Booking validated");

    // Mark booking as completed
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) throw updateError;

    logStep("Booking marked complete, triggering payout");

    // Trigger payout
    const payoutResponse = await supabase.functions.invoke('process-payout', {
      body: { bookingId },
    });

    if (payoutResponse.error) {
      logStep("Payout trigger failed", { error: payoutResponse.error });
    } else {
      logStep("Payout triggered successfully");
      
      // Notify cleaner about payout via SMS
      if (booking.cleaner_id) {
        try {
          const { data: paidCleaner } = await supabase
            .from("cleaners")
            .select("phone, first_name, pay_rate_hr")
            .eq("id", booking.cleaner_id)
            .single();

          if (paidCleaner?.phone) {
            const payoutData = typeof payoutResponse.data === 'string' ? JSON.parse(payoutResponse.data) : payoutResponse.data;
            const payAmount = payoutData?.amount_dollars || ((paidCleaner.pay_rate_hr || 18) * (booking.estimated_duration_hours || 3)).toFixed(2);
            
            await supabase.functions.invoke('send-sms-notification', {
              body: {
                toPhone: paidCleaner.phone,
                message: `💰 Payday ${paidCleaner.first_name}! $${payAmount} has been sent to your bank account for the ${booking.service_date} cleaning. Funds typically arrive in 1-2 business days. Great work!`,
                type: 'confirmation',
              }
            });
            logStep("Payout SMS sent to cleaner");
          }
        } catch (payoutSmsErr) {
          logStep("Payout SMS failed (non-critical)", { error: payoutSmsErr });
        }
      }
    }

    // Send completion email to cleaner
    if (booking.cleaner_id) {
      try {
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("first_name, email")
          .eq("id", booking.cleaner_id)
          .single();

        if (cleaner?.email) {
          const estimatedEarnings = booking.total_estimate_cents
            ? Math.round(booking.total_estimate_cents * 0.45)
            : 0;

          await supabase.functions.invoke('send-cleaner-email', {
            body: {
              type: 'completion',
              email: cleaner.email,
              data: {
                cleanerFirstName: cleaner.first_name,
                bookingId,
                serviceDate: booking.service_date,
                customerName: `${booking.first_name || ''} ${booking.last_name || ''}`.trim(),
                earnings: estimatedEarnings,
                payoutStatus: payoutResponse.error ? 'processing' : 'initiated',
              },
            },
          });
          logStep("Cleaner completion email sent");
        }
      } catch (emailError) {
        logStep("Cleaner email failed (non-critical)", { error: emailError });
      }
    }

    // Send thank-you email to customer
    try {
      await supabase.functions.invoke('send-booking-email', {
        body: {
          type: 'completion',
          email: booking.email,
          data: {
            firstName: booking.first_name,
            bookingId,
            serviceDate: booking.service_date,
            timeSlot: booking.time_slot,
            serviceType: booking.service_type,
            address: booking.address,
            city: booking.city,
            state: booking.state,
            zipCode: booking.zip_code,
            totalAmount: booking.total_estimate_cents,
          },
        },
      });
      logStep("Customer thank-you email sent");
    } catch (emailError) {
      logStep("Customer email failed (non-critical)", { error: emailError });
    }

    // Sync to GHL CRM - booking completed
    try {
      await supabase.functions.invoke('sync-contact-to-ghl', {
        body: {
          event: 'booking_completed',
          contactData: { firstName: booking.first_name, lastName: booking.last_name, email: booking.email, phone: booking.phone, zipCode: booking.zip_code },
          bookingData: { ...booking, final_charge_cents: booking.total_estimate_cents },
        }
      });
      logStep("GHL sync: booking_completed");
    } catch (ghlErr) { logStep("GHL sync failed (non-critical)", { error: ghlErr }); }

    // Send completion/thank-you SMS to customer
    if (booking.phone) {
      try {
        const smsMsg = `Novara Cleaning: Thank you ${booking.first_name || ''}! Your cleaning is complete. We'd love your feedback - rate your experience: https://try.novaracleaning.com/account`;

        await supabase.functions.invoke('send-sms-notification', {
          body: {
            toPhone: booking.phone,
            message: smsMsg,
            type: 'confirmation',
          }
        });
        logStep("Customer thank-you SMS sent", { phone: booking.phone });
      } catch (smsError) {
        logStep("SMS thank-you failed (non-critical)", { error: smsError });
      }
    }

    // Trigger Zapier webhook for completed booking
    try {
      await supabase.functions.invoke('send-zapier-webhook', {
        body: { bookingId }
      });
      logStep("Zapier webhook triggered");
    } catch (webhookError) {
      logStep("Zapier webhook failed (non-critical)", { error: webhookError });
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: "Booking completed and payout initiated"
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
