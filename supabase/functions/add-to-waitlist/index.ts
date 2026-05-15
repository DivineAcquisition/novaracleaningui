import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import * as React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import { WaitlistConfirmation } from "../_shared/email-templates/WaitlistConfirmation.tsx";
import { upsertContact as ghlUpsertContact } from "../_shared/ghl-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WaitlistRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  zipCode: string;
  city?: string;
  state?: string;
  source?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const ghlWebhookUrl = Deno.env.get("GHL_LEAD_CAPTURE_WEBHOOK_URL");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: WaitlistRequest = await req.json();
    const { email, firstName, lastName, phone, zipCode, city, state, source = "website" } = body;

    if (!email || !zipCode) {
      return new Response(
        JSON.stringify({ error: "Email and ZIP code are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Adding to waitlist: ${email} for ZIP ${zipCode}`);

    // Check if already on waitlist
    const { data: existing } = await supabase
      .from("waitlist")
      .select("id")
      .eq("email", email.toLowerCase())
      .eq("zip_code", zipCode)
      .single();

    if (existing) {
      console.log("User already on waitlist for this ZIP");
      return new Response(
        JSON.stringify({ success: true, message: "Already on waitlist", alreadyExists: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Add to waitlist
    const { data: waitlistEntry, error: insertError } = await supabase
      .from("waitlist")
      .insert({
        email: email.toLowerCase(),
        first_name: firstName,
        last_name: lastName,
        phone,
        zip_code: zipCode,
        city,
        state,
        source,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting to waitlist:", insertError);
      throw new Error("Failed to add to waitlist");
    }

    console.log("Added to waitlist:", waitlistEntry.id);

    // Send confirmation email
    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        
        const html = await renderAsync(
          React.createElement(WaitlistConfirmation, {
            firstName: firstName || undefined,
            zipCode,
            city: city || undefined,
          })
        );

        const emailResult = await resend.emails.send({
          from: "Novara Cleaning <hello@novaracleaning.com>",
          to: [email],
          subject: "You're on the Novara Cleaning Waitlist! 🎉",
          html,
        });

        console.log("Waitlist confirmation email sent:", emailResult);

        // Update notified_at
        await supabase
          .from("waitlist")
          .update({ notified_at: new Date().toISOString() })
          .eq("id", waitlistEntry.id);

      } catch (emailError) {
        console.error("Error sending waitlist email:", emailError);
        // Don't fail the request if email fails
      }
    }

    // Send to GHL webhook for CRM tracking (legacy inbound webhook — kept for compatibility)
    if (ghlWebhookUrl) {
      try {
        await fetch(ghlWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            firstName,
            lastName,
            phone,
            zipCode,
            city,
            state,
            source: "waitlist",
            tags: ["waitlist", `zip-${zipCode}`],
            customFields: {
              waitlist_zip: zipCode,
              waitlist_date: new Date().toISOString(),
            },
          }),
        });
        console.log("Sent to GHL webhook");
      } catch (webhookError) {
        console.error("Error sending to GHL:", webhookError);
      }
    }

    // Push to GHL via Private Integration (PIT) — runs in parallel with the webhook.
    try {
      await ghlUpsertContact({
        email,
        phone,
        firstName,
        lastName,
        city,
        state,
        postalCode: zipCode,
        source: "Waitlist",
        tags: ["waitlist", zipCode ? `zip-${zipCode}` : ""].filter(Boolean) as string[],
        customFieldsByKey: {
          customer_source: "Waitlist",
        },
      });
    } catch (ghlErr) {
      console.error("[add-to-waitlist] GHL PIT sync failed (non-blocking)", ghlErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Added to waitlist",
        id: waitlistEntry.id,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in add-to-waitlist:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
