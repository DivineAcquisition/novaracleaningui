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
  console.log(`[TWILIO-SMS] ${step}${detailsStr}`);
};

interface SMSRequest {
  type: 'booking_confirmation' | 'booking_reminder' | 'cancellation' | 'reschedule' | 'custom';
  bookingId?: string;
  toPhone?: string;
  message?: string;
  includeActions?: boolean;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric' 
  });
}

function formatTimeSlot(timeSlot: string): string {
  const slots: Record<string, string> = {
    '8-12': '8AM-12PM',
    '12-16': '12PM-4PM',
    '16-20': '4PM-8PM',
  };
  return slots[timeSlot] || timeSlot;
}

async function sendTwilioSMS(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return { success: false, error: 'Twilio credentials not configured' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const formData = new URLSearchParams();
  formData.append('To', normalizePhone(to));
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

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || 'Twilio API error' };
    }

    return { success: true, sid: data.sid };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, bookingId, toPhone, message, includeActions = true }: SMSRequest = await req.json();
    logStep("Request received", { type, bookingId, hasPhone: !!toPhone });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let phone = toPhone;
    let smsMessage = message;
    let booking: any = null;

    // Fetch booking details if bookingId provided
    if (bookingId) {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (error || !data) {
        throw new Error(`Booking not found: ${bookingId}`);
      }

      booking = data;
      phone = phone || booking.phone;
      logStep("Booking found", { id: booking.id, phone, serviceDate: booking.service_date });
    }

    if (!phone) {
      throw new Error('Phone number is required');
    }

    // Generate message based on type
    if (!smsMessage && booking) {
      const customerName = booking.first_name;
      const date = formatDate(booking.service_date);
      const time = formatTimeSlot(booking.time_slot);
      const shortId = booking.id.substring(0, 8).toUpperCase();

      switch (type) {
        case 'booking_confirmation':
          smsMessage = `Hi ${customerName}! Your Novara cleaning is confirmed for ${date}, ${time}.\n\nBooking #${shortId}\n\nReply:\nC - Cancel\nR - Reschedule\nH - Help\n\nQuestions? Call (301) 800-5252`;
          break;

        case 'booking_reminder':
          smsMessage = `Reminder: Your Novara cleaning is tomorrow, ${date}, ${time}.\n\nBooking #${shortId}\n\nReply:\nC - Cancel\nR - Reschedule\n\nSee you soon!`;
          break;

        case 'cancellation':
          smsMessage = `Your Novara cleaning for ${date} has been cancelled.\n\nBooking #${shortId}\n\nTo rebook, visit novaracleaning.com or call (301) 800-5252`;
          break;

        case 'reschedule':
          smsMessage = `Your Novara cleaning has been rescheduled to ${date}, ${time}.\n\nBooking #${shortId}\n\nReply:\nC - Cancel\nR - Change again\n\nQuestions? Call (301) 800-5252`;
          break;

        default:
          throw new Error(`Unknown SMS type: ${type}`);
      }
    }

    if (!smsMessage) {
      throw new Error('Message is required');
    }

    // Send SMS via Twilio
    logStep("Sending SMS", { to: phone, length: smsMessage.length });
    const result = await sendTwilioSMS(phone, smsMessage);

    if (!result.success) {
      throw new Error(result.error || 'Failed to send SMS');
    }

    logStep("SMS sent successfully", { sid: result.sid });

    // Log SMS in database
    const { data: smsLog, error: logError } = await supabase
      .from('sms_logs')
      .insert({
        to_phone: normalizePhone(phone),
        message: smsMessage,
        type: type,
        booking_id: bookingId,
        status: 'sent',
        provider: 'twilio',
        provider_message_id: result.sid,
      })
      .select()
      .single();

    if (logError) {
      logStep("Failed to log SMS (non-blocking)", { error: logError });
    }

    // Update booking with SMS sent timestamp
    if (bookingId && type === 'booking_confirmation') {
      await supabase
        .from('bookings')
        .update({ 
          confirmation_sms_sent: true,
          confirmation_sms_sent_at: new Date().toISOString()
        })
        .eq('id', bookingId);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        sid: result.sid,
        logId: smsLog?.id 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
