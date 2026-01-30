import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Twilio credentials
const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER"); // Your verified toll-free number

// Fallback to MessageBird if Twilio not configured
const messageBirdAccessKey = Deno.env.get("MESSAGEBIRD_ACCESS_KEY");
const messageBirdOriginator = Deno.env.get("MESSAGEBIRD_ORIGINATOR");

interface SMSRequest {
  toPhone: string;
  message: string;
  type: "job_offer" | "reminder" | "confirmation" | "verification" | "booking_update" | "contractor_verification" | "welcome" | "general";
  jobAssignmentId?: string;
  bookingId?: string;
  cleanerId?: string;
  metadata?: Record<string, any>;
}

function normalizePhone(phone: string): string {
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  
  // If it's 10 digits, add +1 for US
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If it already has country code, ensure it starts with +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // Return as-is with + prefix if not already there
  return phone.startsWith('+') ? phone : `+${digits}`;
}

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SMS] ${step}${detailsStr}`);
};

/**
 * Send SMS via Twilio
 */
async function sendViaTwilio(
  to: string, 
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
    return { success: false, error: "Twilio credentials not configured" };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
  
  const formData = new URLSearchParams();
  formData.append("To", to);
  formData.append("From", twilioPhoneNumber);
  formData.append("Body", message);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        success: false, 
        error: data.message || data.error_message || `Twilio error: ${response.status}` 
      };
    }

    return { success: true, messageId: data.sid };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Send SMS via MessageBird (fallback)
 */
async function sendViaMessageBird(
  to: string, 
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!messageBirdAccessKey || !messageBirdOriginator) {
    return { success: false, error: "MessageBird credentials not configured" };
  }

  const url = "https://rest.messagebird.com/messages";
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `AccessKey ${messageBirdAccessKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        originator: messageBirdOriginator,
        recipients: [to],
        body: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { 
        success: false, 
        error: data.errors?.[0]?.description || "MessageBird error" 
      };
    }

    return { success: true, messageId: data.id };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      toPhone, 
      message, 
      type, 
      jobAssignmentId, 
      bookingId,
      cleanerId,
      metadata 
    }: SMSRequest = await req.json();

    if (!toPhone || !message) {
      throw new Error("Missing required fields: toPhone, message");
    }

    const recipient = normalizePhone(toPhone);
    logStep(`Sending ${type} SMS`, { to: recipient.slice(-4), type });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Create log entry
    const { data: logEntry, error: logError } = await supabase
      .from("sms_logs")
      .insert({
        to_phone: recipient,
        message,
        type,
        job_assignment_id: jobAssignmentId,
        booking_id: bookingId,
        cleaner_id: cleanerId,
        status: "pending",
        metadata
      })
      .select()
      .single();

    if (logError) {
      console.error("Failed to create SMS log:", logError);
    }

    // Try Twilio first (primary), then MessageBird (fallback)
    let result = await sendViaTwilio(recipient, message);
    let provider = "twilio";

    if (!result.success && result.error?.includes("not configured")) {
      logStep("Twilio not configured, trying MessageBird");
      result = await sendViaMessageBird(recipient, message);
      provider = "messagebird";
    }

    if (!result.success) {
      throw new Error(result.error || "Failed to send SMS");
    }

    logStep(`SMS sent via ${provider}`, { messageId: result.messageId });

    // Update log with success
    if (logEntry?.id) {
      await supabase
        .from("sms_logs")
        .update({
          status: "sent",
          provider_message_id: result.messageId,
          provider
        })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        messageId: result.messageId,
        provider
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });

    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
