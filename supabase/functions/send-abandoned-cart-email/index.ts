import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import * as React from "https://esm.sh/react@18.3.1";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import { AbandonedCartReminder } from "../_shared/email-templates/AbandonedCartReminder.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIGMA_CONVERSATION_ID = "698acaea41154eb80fab602e";

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-ABANDONED-CART-EMAIL] ${step}${detailsStr}`);
};

async function fetchMigmaTemplate(conversationId: string): Promise<string | null> {
  const apiKey = Deno.env.get("MIGMA_API_KEY");
  if (!apiKey) {
    logStep("MIGMA_API_KEY not configured, falling back to React Email");
    return null;
  }

  try {
    const response = await fetch(`https://api.migma.ai/v1/export/html/${conversationId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      logStep("Migma API error", { status: response.status, statusText: response.statusText });
      return null;
    }

    const result = await response.json();
    const html = typeof result === 'string' ? result : (result.html || result.data?.html || null);

    if (html) {
      logStep("Migma template fetched successfully", { length: html.length });
    }
    return html;
  } catch (err: any) {
    logStep("Error fetching Migma template", { error: err.message });
    return null;
  }
}

function populateAbandonedCartTemplate(html: string, data: Record<string, string>): string {
  let result = html;
  for (const [placeholder, value] of Object.entries(data)) {
    result = result.replaceAll(`{{${placeholder}}}`, value);
    const encoded = encodeURIComponent(`{{${placeholder}}}`);
    result = result.replaceAll(encoded, value);
  }
  return result;
}

interface AbandonedCartEmailRequest {
  cartId: string;
  isSecondReminder?: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = new Resend(resendApiKey);

    const body = await req.json();
    const { cartId, isSecondReminder = false, testMode, testEmail, testFirstName, testHomeSize, testServiceType } = body;

    let cart: any;

    if (testMode && testEmail) {
      logStep(`Test mode: sending abandoned cart email to ${testEmail}`);
      cart = {
        id: 'test',
        email: testEmail,
        first_name: testFirstName || 'there',
        home_size: testHomeSize || null,
        service_type: testServiceType || null,
        reminder_count: isSecondReminder ? 1 : 0,
        zip_code: null,
      };
    } else {
      const { data: cartData, error: cartError } = await supabase
        .from("abandoned_carts")
        .select("*")
        .eq("id", cartId)
        .single();

      if (cartError || !cartData) {
        console.error("Cart not found:", cartError);
        return new Response(
          JSON.stringify({ error: "Cart not found" }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      if (cartData.converted_at) {
        logStep("Cart already converted, skipping email");
        return new Response(
          JSON.stringify({ success: true, message: "Cart already converted" }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      cart = cartData;
    }

    const baseUrl = "https://try.novaracleaning.com";
    const resumeUrl = cart.session_id
      ? `${baseUrl}/book/zip?session=${cart.session_id}`
      : `${baseUrl}/book/sqft?resume=${cartId}`;

    logStep(`Sending ${isSecondReminder ? 'second' : 'first'} reminder to ${cart.email}`);

    // Try Migma template first, fall back to React Email
    let html: string;

    const migmaHtml = await fetchMigmaTemplate(MIGMA_CONVERSATION_ID);

    if (migmaHtml) {
      const serviceTypeLabels: Record<string, string> = {
        standard: 'Standard Cleaning',
        deep: 'Deep Cleaning',
        moveInOut: 'Move In/Out Cleaning',
      };

      html = populateAbandonedCartTemplate(migmaHtml, {
        first_name: cart.first_name || 'there',
        service_type: serviceTypeLabels[cart.service_type] || cart.service_type || 'Cleaning',
        home_size: cart.home_size || '',
        resume_url: resumeUrl,
        zip_code: cart.zip_code || '',
      });
      logStep("Using Migma template for abandoned cart email");
    } else {
      html = await renderAsync(
        React.createElement(AbandonedCartReminder, {
          firstName: cart.first_name || undefined,
          homeSize: cart.home_size || undefined,
          serviceType: cart.service_type || undefined,
          resumeUrl,
          isSecondReminder,
        })
      );
      logStep("Using React Email fallback for abandoned cart email");
    }

    const subject = isSecondReminder
      ? "Last chance! Complete your Novara Cleaning booking"
      : "You're almost there! Complete your booking";

    const emailResult = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [cart.email],
      subject,
      html,
    });

    logStep("Abandoned cart email sent:", emailResult);

    if (!testMode) {
      await supabase
        .from("abandoned_carts")
        .update({
          reminder_sent_at: new Date().toISOString(),
          reminder_count: cart.reminder_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cartId);
    }

    return new Response(
      JSON.stringify({ success: true, emailId: emailResult.data?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in send-abandoned-cart-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
