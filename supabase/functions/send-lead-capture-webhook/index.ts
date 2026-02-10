import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_LEAD_CAPTURE_WEBHOOK_URL = Deno.env.get("GHL_LEAD_CAPTURE_WEBHOOK_URL") || "";
const ZAPIER_LEAD_CAPTURE_WEBHOOK_URL = Deno.env.get("ZAPIER_LEAD_CAPTURE_WEBHOOK_URL") || "";

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-LEAD-CAPTURE-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

interface LeadCapturePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zipCode: string;
  city?: string;
  state?: string;
  source?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const leadData: LeadCapturePayload = await req.json();
    
    logStep("Processing lead capture", { 
      email: leadData.email, 
      zipCode: leadData.zipCode 
    });

    // --- Duplicate detection: check customers table ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id")
      .eq("email", leadData.email.toLowerCase())
      .maybeSingle();

    if (existingCustomer) {
      logStep("Duplicate detected - customer already exists", { email: leadData.email });
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "duplicate" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Build standardized payload for external webhooks
    const payload = {
      // Contact Information
      "First Name": leadData.firstName,
      "Last Name": leadData.lastName,
      "Full Name": `${leadData.firstName} ${leadData.lastName}`,
      "Email": leadData.email,
      "Phone": leadData.phone,
      
      // Location
      "Zip Code": leadData.zipCode,
      "City": leadData.city || "",
      "State": leadData.state || "",
      
      // Source Tracking
      "Lead Source": leadData.source || "Website",
      "Landing Page": leadData.landingPage || "/",
      "UTM Source": leadData.utmSource || "",
      "UTM Medium": leadData.utmMedium || "",
      "UTM Campaign": leadData.utmCampaign || "",
      
      // Metadata
      "Captured At": new Date().toISOString(),
      "Lead Type": "Landing Page Contact Form",
      "Status": "New Lead"
    };

    // Send to all configured webhooks in parallel
    const webhookUrls = [
      { url: GHL_LEAD_CAPTURE_WEBHOOK_URL, name: 'GoHighLevel Lead Capture' },
      { url: ZAPIER_LEAD_CAPTURE_WEBHOOK_URL, name: 'Zapier Lead Capture' }
    ].filter(w => w.url);

    logStep("Sending to webhooks", { 
      count: webhookUrls.length, 
      targets: webhookUrls.map(w => w.name) 
    });

    if (webhookUrls.length === 0) {
      logStep("No webhooks configured, skipping external sends");
      return new Response(
        JSON.stringify({ success: true, message: "No webhooks configured", payload }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const results = await Promise.allSettled(
      webhookUrls.map(async (webhook) => {
        logStep(`Sending to ${webhook.name}`);
        
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const respText = await response.text().catch(() => "");
        logStep(`${webhook.name} response`, {
          status: response.status,
          bodyPreview: respText ? respText.slice(0, 200) : ""
        });

        if (!response.ok) {
          throw new Error(`${webhook.name} failed with status ${response.status}`);
        }

        return { success: true, webhookName: webhook.name, status: response.status };
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logStep("Webhook results", { successful, failed, total: webhookUrls.length });

    return new Response(
      JSON.stringify({ 
        success: successful > 0, 
        webhooksAttempted: webhookUrls.length,
        webhooksSuccessful: successful,
        webhooksFailed: failed,
        payload 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: successful > 0 ? 200 : 500 }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
