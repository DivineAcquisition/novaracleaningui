import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-REMINDER] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Reminder function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    logStep("Time windows calculated", {
      now: now.toISOString(),
      fortyEightHoursAgo: fortyEightHoursAgo.toISOString(),
    });

    // Find bookings that are pending payment created within last 48 hours
    const { data: pendingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "pending_payment")
      .gt("created_at", fortyEightHoursAgo.toISOString())
      .order("created_at", { ascending: true });

    if (fetchError) {
      logStep("Error fetching pending bookings", fetchError);
      throw fetchError;
    }

    logStep("Found pending bookings", { count: pendingBookings?.length || 0 });

    if (!pendingBookings || pendingBookings.length === 0) {
      logStep("No pending bookings found");
      return new Response(
        JSON.stringify({ success: true, reminders_sent: 0, message: "No pending bookings" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    let remindersSent = 0;
    const errors: any[] = [];

    for (const booking of pendingBookings) {
      const createdAt = new Date(booking.created_at);
      const timeSinceCreated = now.getTime() - createdAt.getTime();
      const minutesSinceCreated = timeSinceCreated / (1000 * 60);
      const hoursSinceCreated = minutesSinceCreated / 60;

      logStep("Checking booking", {
        bookingId: booking.id,
        minutesSinceCreated: minutesSinceCreated.toFixed(2),
      });

      let shouldSendReminder = false;
      let reminderType = "";

      // Check if it's been approximately 10 minutes (between 8 and 12 minutes to account for cron timing)
      if (minutesSinceCreated >= 8 && minutesSinceCreated <= 12) {
        shouldSendReminder = true;
        reminderType = "10_minute";
      }
      // Check if it's been approximately 24 hours (between 23.5 and 24.5 hours)
      else if (hoursSinceCreated >= 23.5 && hoursSinceCreated <= 24.5) {
        shouldSendReminder = true;
        reminderType = "24_hour";
      }

      if (shouldSendReminder) {
        logStep("Sending reminder", { bookingId: booking.id, type: reminderType });

        try {
          const reminderData = {
            firstName: booking.first_name,
            lastName: booking.last_name,
            bookingId: booking.id,
            serviceDate: booking.service_date,
            timeSlot: booking.time_slot,
            serviceType: booking.service_type,
            homeSize: booking.home_size_id,
            totalAmount: booking.total_estimate_cents,
            depositAmount: booking.deposit_cents,
            paymentOption: booking.payment_option,
            reminderType,
            checkoutUrl: `${Deno.env.get('SUPABASE_URL')?.replace('.supabase.co', '.lovable.app') || 'https://book.novaracleaning.com'}/book/checkout`,
          };

          const response = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-reminder-email`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
                email: booking.email,
                data: reminderData,
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Email send failed: ${errorText}`);
          }

          logStep("Email sent successfully", { bookingId: booking.id, email: booking.email });

          // Send SMS reminder
          if (booking.phone) {
            try {
              const resumeUrl = booking.session_id
                ? `https://try.novaracleaning.com/book/zip?session=${booking.session_id}`
                : `https://try.novaracleaning.com/book/checkout`;
              
              const smsMessage = reminderType === "24_hour"
                ? `⚠️ Last chance ${booking.first_name}! Your booking expires soon. Complete now & save $30: ${resumeUrl}`
                : `Hi ${booking.first_name}, you're almost done! Complete your Novara cleaning booking and save $30. Finish here: ${resumeUrl}`;

              const smsResponse = await supabase.functions.invoke('send-sms-notification', {
                body: {
                  toPhone: booking.phone,
                  message: smsMessage,
                  type: 'reminder'
                }
              });

              if (smsResponse.error) {
                logStep("SMS send failed", { bookingId: booking.id, error: smsResponse.error });
              } else {
                logStep("SMS sent successfully", { bookingId: booking.id, phone: booking.phone });
              }
            } catch (smsError: any) {
              logStep("Error sending SMS", { bookingId: booking.id, error: smsError.message });
            }
          }

          remindersSent++;
          logStep("Reminder sent successfully", { bookingId: booking.id, email: booking.email });
        } catch (error: any) {
          logStep("Error sending reminder", { bookingId: booking.id, error: error.message });
          errors.push({
            bookingId: booking.id,
            email: booking.email,
            error: error.message,
          });
        }
      }
    }

    logStep("Reminder processing complete", { remindersSent, errors: errors.length });

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        total_pending: pendingBookings.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    logStep("ERROR in reminder function", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
