import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zipCode: string;
  city: string;
  state: string;
  landingPage?: string;
  referrer?: string;
  timestamp: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
}

async function sendToWebhook(url: string, payload: LeadPayload, name: string): Promise<boolean> {
  try {
    console.log(`[emit-lead-webhook] Sending to ${name}...`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`[emit-lead-webhook] ${name} webhook succeeded`);
      return true;
    } else {
      const text = await response.text();
      console.error(`[emit-lead-webhook] ${name} webhook failed: ${response.status} - ${text}`);
      return false;
    }
  } catch (error) {
    console.error(`[emit-lead-webhook] ${name} webhook error:`, error);
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: LeadPayload = await req.json();
    
    console.log(`[emit-lead-webhook] Received lead:`, {
      name: `${payload.firstName} ${payload.lastName}`,
      email: payload.email,
      phone: payload.phone,
      zipCode: payload.zipCode,
      city: payload.city,
      state: payload.state,
    });

    // Get webhook URLs from secrets
    const ghlWebhookUrl = Deno.env.get('GHL_LEAD_CAPTURE_WEBHOOK_URL');
    const zapierWebhookUrl = Deno.env.get('ZAPIER_LEAD_CAPTURE_WEBHOOK_URL');

    const results: { ghl: boolean; zapier: boolean } = {
      ghl: false,
      zapier: false,
    };

    // Send to GoHighLevel (primary CRM)
    if (ghlWebhookUrl) {
      results.ghl = await sendToWebhook(ghlWebhookUrl, payload, 'GoHighLevel');
    } else {
      console.warn(`[emit-lead-webhook] GHL_LEAD_CAPTURE_WEBHOOK_URL not configured`);
    }

    // Send to Zapier (backup/logging)
    if (zapierWebhookUrl) {
      results.zapier = await sendToWebhook(zapierWebhookUrl, payload, 'Zapier');
    } else {
      console.warn(`[emit-lead-webhook] ZAPIER_LEAD_CAPTURE_WEBHOOK_URL not configured`);
    }

    console.log(`[emit-lead-webhook] Results:`, results);

    // Return success even if webhooks fail (non-blocking)
    return new Response(
      JSON.stringify({ 
        success: true,
        webhookResults: results,
        message: "Lead captured successfully" 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[emit-lead-webhook] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ 
        success: false,
        message: "Failed to process lead" 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
