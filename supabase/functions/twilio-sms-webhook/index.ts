import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_PHONE_NUMBER = Deno.env.get("TWILIO_PHONE_NUMBER");

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[TWILIO-WEBHOOK] ${step}${detailsStr}`);
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

async function sendTwilioSMS(to: string, body: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    logStep("Twilio credentials not configured");
    return false;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const formData = new URLSearchParams();
  formData.append('To', to);
  formData.append('From', TWILIO_PHONE_NUMBER);
  formData.append('Body', body);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    return response.ok;
  } catch {
    return false;
  }
}

// Parse the action from the message
function parseAction(message: string): { action: string; bookingRef?: string } {
  const text = message.trim().toUpperCase();
  
  // Check for single letter commands
  if (text === 'C' || text.startsWith('C ') || text === 'CANCEL') {
    return { action: 'cancel' };
  }
  if (text === 'R' || text.startsWith('R ') || text === 'RESCHEDULE') {
    return { action: 'reschedule' };
  }
  if (text === 'H' || text === 'HELP' || text === '?') {
    return { action: 'help' };
  }
  if (text === 'STOP' || text === 'UNSUBSCRIBE') {
    return { action: 'optout' };
  }
  if (text === 'YES' || text === 'Y' || text === 'CONFIRM') {
    return { action: 'confirm' };
  }
  if (text === 'NO' || text === 'N') {
    return { action: 'decline' };
  }

  // Check for booking reference in message (e.g., "C ABC12345" or "CANCEL ABC12345")
  const parts = text.split(/\s+/);
  if (parts.length >= 2) {
    const cmd = parts[0];
    const ref = parts[1];
    if (cmd === 'C' || cmd === 'CANCEL') {
      return { action: 'cancel', bookingRef: ref };
    }
    if (cmd === 'R' || cmd === 'RESCHEDULE') {
      return { action: 'reschedule', bookingRef: ref };
    }
  }

  return { action: 'unknown' };
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Twilio sends data as form-urlencoded
    const formData = await req.formData();
    
    const from = formData.get('From')?.toString() || '';
    const to = formData.get('To')?.toString() || '';
    const body = formData.get('Body')?.toString() || '';
    const messageSid = formData.get('MessageSid')?.toString() || '';
    
    logStep("Incoming SMS", { from, to, body: body.substring(0, 50), messageSid });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const normalizedPhone = normalizePhone(from);

    // Log incoming SMS
    const { data: incomingLog } = await supabase
      .from('sms_responses')
      .insert({
        from_phone: normalizedPhone,
        to_phone: to,
        message: body,
        provider_message_id: messageSid,
        processed: false,
      })
      .select()
      .single();

    logStep("Logged incoming SMS", { logId: incomingLog?.id });

    // Parse the action
    const { action, bookingRef } = parseAction(body);
    logStep("Parsed action", { action, bookingRef });

    // Find the most recent booking for this phone number
    let booking = null;
    const { data: bookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('phone', normalizedPhone.replace('+1', ''))
      .in('status', ['confirmed', 'booked', 'pending_payment'])
      .order('service_date', { ascending: true })
      .limit(1);

    if (bookings && bookings.length > 0) {
      booking = bookings[0];
      logStep("Found booking", { bookingId: booking.id, status: booking.status });
    }

    let responseMessage = '';
    let actionTaken = action;

    switch (action) {
      case 'cancel': {
        if (!booking) {
          responseMessage = "We couldn't find an upcoming booking for this number. Please call (301) 800-5252 for help.";
          actionTaken = 'cancel_failed';
        } else {
          // Update booking status to cancelled
          const { error: cancelError } = await supabase
            .from('bookings')
            .update({ 
              status: 'cancelled',
              cancellation_reason: 'Customer SMS cancellation',
              cancelled_at: new Date().toISOString()
            })
            .eq('id', booking.id);

          if (cancelError) {
            logStep("Cancel failed", { error: cancelError });
            responseMessage = "Sorry, we couldn't cancel your booking. Please call (301) 800-5252.";
            actionTaken = 'cancel_failed';
          } else {
            const date = new Date(booking.service_date + 'T12:00:00').toLocaleDateString('en-US', { 
              weekday: 'short', month: 'short', day: 'numeric' 
            });
            responseMessage = `Your cleaning for ${date} has been cancelled. We hope to see you again soon!\n\nTo rebook: novaracleaning.com`;
            actionTaken = 'cancelled';
            logStep("Booking cancelled", { bookingId: booking.id });
          }
        }
        break;
      }

      case 'reschedule': {
        if (!booking) {
          responseMessage = "We couldn't find an upcoming booking for this number. Please call (301) 800-5252 for help.";
          actionTaken = 'reschedule_failed';
        } else {
          // Mark booking for reschedule and send link
          await supabase
            .from('bookings')
            .update({ 
              reschedule_requested: true,
              reschedule_requested_at: new Date().toISOString()
            })
            .eq('id', booking.id);

          const rescheduleLink = `https://try.novaracleaning.com/reschedule/${booking.id.substring(0, 8)}`;
          responseMessage = `To reschedule your cleaning, click here:\n${rescheduleLink}\n\nOr call us at (301) 800-5252 and we'll help you find a new time.`;
          actionTaken = 'reschedule_link_sent';
          logStep("Reschedule link sent", { bookingId: booking.id });
        }
        break;
      }

      case 'confirm': {
        if (!booking) {
          responseMessage = "We couldn't find a booking to confirm. Please call (301) 800-5252 for help.";
        } else {
          await supabase
            .from('bookings')
            .update({ 
              customer_confirmed: true,
              customer_confirmed_at: new Date().toISOString()
            })
            .eq('id', booking.id);

          const date = new Date(booking.service_date + 'T12:00:00').toLocaleDateString('en-US', { 
            weekday: 'short', month: 'short', day: 'numeric' 
          });
          responseMessage = `Thanks for confirming! We'll see you on ${date}. 🧹✨`;
          actionTaken = 'confirmed';
          logStep("Booking confirmed by customer", { bookingId: booking.id });
        }
        break;
      }

      case 'help': {
        responseMessage = `Novara Cleaning Help:\n\nReply with:\nC - Cancel booking\nR - Reschedule booking\nY - Confirm booking\n\nOr call us: (301) 800-5252\nEmail: support@novaracleaning.com`;
        break;
      }

      case 'optout': {
        // Update customer preferences
        await supabase
          .from('customers')
          .update({ sms_opt_out: true })
          .eq('phone', normalizedPhone.replace('+1', ''));

        responseMessage = "You've been unsubscribed from Novara SMS. You can still manage bookings at novaracleaning.com or call (301) 800-5252.";
        actionTaken = 'opted_out';
        logStep("Customer opted out", { phone: normalizedPhone });
        break;
      }

      default: {
        responseMessage = `Hi! Reply with:\nC - Cancel\nR - Reschedule\nH - Help\n\nOr call (301) 800-5252`;
        actionTaken = 'help_sent';
        break;
      }
    }

    // Update the response log with action taken
    if (incomingLog) {
      await supabase
        .from('sms_responses')
        .update({
          action_detected: actionTaken,
          booking_id: booking?.id,
          processed: true,
          processed_at: new Date().toISOString(),
          response_sent: responseMessage,
        })
        .eq('id', incomingLog.id);
    }

    // Send response SMS
    if (responseMessage) {
      await sendTwilioSMS(from, responseMessage);
      logStep("Response sent", { to: from, action: actionTaken });
    }

    // Return TwiML response (empty is fine for Twilio)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/xml" 
        } 
      }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    
    // Return empty TwiML to avoid Twilio retries
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { 
        headers: { 
          ...corsHeaders, 
          "Content-Type": "application/xml" 
        } 
      }
    );
  }
});
