import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { upsertContact as ghlUpsertContact } from "../_shared/ghl-client.ts";
import { mirrorToLeadConnector } from "../_shared/leadconnector-mirror.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Legacy GHL_LEAD_CAPTURE_WEBHOOK_URL + ZAPIER_LEAD_CAPTURE_WEBHOOK_URL
// outbound destinations were retired 2026-05-17. The GHL PIT
// upsertContact call (ghlUpsertContact below) + the LeadConnector
// inbound mirror (mirrorToLeadConnector below) are the only sync
// paths now.

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
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  firstVisitTimestamp?: string;
  tracking?: Record<string, string>;
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

    // --- Send real-time alert email (fire-and-forget) ---
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const lastInitial = leadData.lastName ? leadData.lastName.charAt(0) + "." : "";
        const subject = `New Lead: ${leadData.firstName} ${lastInitial} — ${leadData.zipCode}`;
        
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #8B5CF6; margin-bottom: 4px;">🔔 New Lead Captured</h2>
            <p style="color: #6B7280; margin-top: 0;">A new lead just filled out the contact form.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600; width: 140px;">First Name</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.firstName}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">Last Name</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.lastName}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">Email</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><a href="mailto:${leadData.email}">${leadData.email}</a></td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">Phone</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;"><a href="tel:${leadData.phone}">${leadData.phone}</a></td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">ZIP Code</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.zipCode}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">City</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.city || "—"}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">State</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.state || "—"}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">Source</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.source || "Website"}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #E5E7EB; font-weight: 600;">Landing Page</td><td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${leadData.landingPage || "/"}</td></tr>
              <tr><td style="padding: 8px; font-weight: 600;">Captured At</td><td style="padding: 8px;">${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</td></tr>
            </table>
          </div>`;

        resend.emails.send({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: ["contact@novaracleaning.com"],
          subject,
          html,
        }).then(() => logStep("Alert email sent"))
          .catch((e: any) => logStep("Alert email failed (non-blocking)", { error: String(e) }));
        
      } catch (emailErr) {
        logStep("Alert email setup error (non-blocking)", { error: String(emailErr) });
      }
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
      
      // Meta Ads Attribution
      "Facebook Click ID": leadData.fbclid || "",
      
      // Metadata
      "Captured At": new Date().toISOString(),
      "Lead Type": "Landing Page Contact Form",
      "Status": "New Lead"
    };

    // Push to GHL via Private Integration (PIT) — single authoritative
    // path. The full UTM + landing-page + referrer bag from the client
    // is mapped to every supported GHL custom field so the contact
    // record reflects the source the moment the lead opts in.
    ghlUpsertContact({
      email: leadData.email,
      phone: leadData.phone,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      city: leadData.city,
      state: leadData.state,
      postalCode: leadData.zipCode,
      source: leadData.utmSource || leadData.source || "Novara Website",
      tags: [
        "lead",
        leadData.zipCode ? `zip-${leadData.zipCode}` : "",
        leadData.utmSource ? `src-${leadData.utmSource}` : "",
        leadData.utmCampaign ? `cmp-${leadData.utmCampaign}` : "",
      ].filter(Boolean) as string[],
      customFieldsByKey: {
        // AGP Tracking Attribution
        utm_content: leadData.utmContent,
        utm_medium: leadData.utmMedium,
        utm_campaign: leadData.utmCampaign,
        utm_source: leadData.utmSource,
        utm_term: leadData.utmTerm,
        landing_page: leadData.landingPage,
        referrer: leadData.referrer,
        tracking_attribution: leadData.referrer || leadData.landingPage,
        fb_lead_id: leadData.fbclid,
        fbclid: leadData.fbclid,
        gclid: leadData.gclid,
        // General Info / Lead Source
        customer_source: leadData.utmSource || leadData.source,
        market: leadData.city || leadData.zipCode,
      },
    }).catch((err) => logStep("GHL PIT sync failed (non-blocking)", { error: String(err) }));

    // Mirror to the user's LeadConnector inbound webhook as a backup.
    // Same payload as the Zapier targets PLUS the contact-shaped fields
    // GHL's inbound automation expects (snake_case) so the workflow on
    // the GHL side can map straight from the body.
    await mirrorToLeadConnector({
      event: "lead.captured",
      payload: {
        first_name: leadData.firstName,
        last_name: leadData.lastName,
        full_name: `${leadData.firstName} ${leadData.lastName}`.trim(),
        email: leadData.email,
        phone: leadData.phone,
        city: leadData.city || "",
        state: leadData.state || "",
        postal_code: leadData.zipCode || "",
        country: "US",
        source: leadData.source || "Website",
        landing_page: leadData.landingPage || "/",
        referrer: leadData.referrer || "",
        utm_source: leadData.utmSource || "",
        utm_medium: leadData.utmMedium || "",
        utm_campaign: leadData.utmCampaign || "",
        utm_content: leadData.utmContent || "",
        utm_term: leadData.utmTerm || "",
        fbclid: leadData.fbclid || "",
        gclid: leadData.gclid || "",
        first_visit_timestamp: leadData.firstVisitTimestamp || "",
        tracking: leadData.tracking || null,
        lead_payload: payload,
      },
    });

    // GHL PIT upsertContact + LeadConnector inbound mirror (both
    // above) are the only outbound destinations now.
    return new Response(
      JSON.stringify({ success: true, ghl_sync: "ok", payload }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
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
