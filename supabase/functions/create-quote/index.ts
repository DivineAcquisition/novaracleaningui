import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  ghlIsConfigured,
  splitFullAddress,
  syncContactAndOpportunity,
} from "../_shared/ghl-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-QUOTE] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");
    
    const { fullName, email, phone, address, sqft, notes } = await req.json();
    logStep("Quote data received", { email, sqft });
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Store custom quote request
    const { data, error } = await supabase
      .from('custom_quotes')
      .insert({
        full_name: fullName,
        email,
        phone,
        address,
        sqft,
        notes: notes || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      logStep("Database error", error);
      throw error;
    }

    logStep("Quote request stored", { quoteId: data.id });

    // ── Map the quote lead into GoHighLevel (contact + open opportunity) so
    //    large-home / commercial quote requests land in the sales pipeline
    //    and trigger CRM follow-up automation. Best-effort + never blocks the
    //    quote submission.
    let ghlContactId: string | null = null;
    let ghlOpportunityId: string | null = null;
    if (ghlIsConfigured()) {
      try {
        const [first, ...rest] = String(fullName || "").trim().split(/\s+/);
        const lastName = rest.join(" ") || undefined;
        const addr = splitFullAddress(String(address || ""));
        const sqftLabel = sqft ? `${sqft} sq-ft` : "";
        const result = await syncContactAndOpportunity({
          contact: {
            email: email || undefined,
            phone: phone || undefined,
            firstName: first || undefined,
            lastName,
            address1: addr.street || address || undefined,
            city: addr.city || undefined,
            state: addr.state || undefined,
            postalCode: addr.zipCode || undefined,
            source: "Novara Custom Quote",
            tags: ["lead - new", "source - custom quote", "service - custom quote"],
            customFieldsByKey: {
              estimated_sqft: sqft ?? "",
              job_notes_internal: notes || "",
              lead_source: "Website",
              cleaning_type: "Deep Cleaning",
            },
          },
          opportunity: {
            name: `Custom Quote — ${(fullName || email || "Lead")}${sqftLabel ? ` (${sqftLabel})` : ""}`,
            status: "open",
            source: "Novara Custom Quote",
          },
        });
        ghlContactId = result.contactId;
        ghlOpportunityId = result.opportunityId;
        logStep("GHL sync complete", { ghlContactId, ghlOpportunityId });

        if (ghlContactId || ghlOpportunityId) {
          try {
            await supabase
              .from("custom_quotes")
              .update({ ghl_contact_id: ghlContactId, ghl_opportunity_id: ghlOpportunityId })
              .eq("id", data.id);
          } catch (persistErr) {
            logStep("Failed to persist GHL ids (non-critical)", {
              error: persistErr instanceof Error ? persistErr.message : String(persistErr),
            });
          }
        }
      } catch (ghlErr) {
        logStep("GHL sync failed (non-critical)", {
          error: ghlErr instanceof Error ? ghlErr.message : String(ghlErr),
        });
      }
    }

    // Send notification email to ops team
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      try {
        const notificationHtml = `
          <h2>New Custom Quote Request</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Name</td><td style="padding:8px;border:1px solid #ddd">${fullName}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #ddd">${email}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Phone</td><td style="padding:8px;border:1px solid #ddd">${phone}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Address</td><td style="padding:8px;border:1px solid #ddd">${address}</td></tr>
            <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Sq Ft</td><td style="padding:8px;border:1px solid #ddd">${sqft}</td></tr>
            ${notes ? `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Notes</td><td style="padding:8px;border:1px solid #ddd">${notes}</td></tr>` : ''}
          </table>
        `;

        const { Resend } = await import("https://esm.sh/resend@4.0.0");
        const resend = new Resend(resendApiKey);
        await resend.emails.send({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: ["admin@novaracleaning.com"],
          subject: `New Custom Quote Request - ${fullName} (${sqft} sqft)`,
          html: notificationHtml,
        });
        logStep("Notification email sent to ops team");
      } catch (emailErr: any) {
        logStep("Failed to send notification email (non-critical)", { error: emailErr.message });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Quote request received",
        quoteId: data.id,
        ghlContactId,
        ghlOpportunityId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in create-quote", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});