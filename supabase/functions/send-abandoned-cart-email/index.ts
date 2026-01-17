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

    const body: AbandonedCartEmailRequest = await req.json();
    const { cartId, isSecondReminder = false } = body;

    // Fetch cart details
    const { data: cart, error: cartError } = await supabase
      .from("abandoned_carts")
      .select("*")
      .eq("id", cartId)
      .single();

    if (cartError || !cart) {
      console.error("Cart not found:", cartError);
      return new Response(
        JSON.stringify({ error: "Cart not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Don't send if already converted
    if (cart.converted_at) {
      console.log("Cart already converted, skipping email");
      return new Response(
        JSON.stringify({ success: true, message: "Cart already converted" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Build resume URL
    const baseUrl = "https://try.novaracleaning.com";
    const resumeUrl = `${baseUrl}/book/sqft?resume=${cartId}`;

    console.log(`Sending ${isSecondReminder ? 'second' : 'first'} reminder to ${cart.email}`);

    // Render email
    const html = await renderAsync(
      React.createElement(AbandonedCartReminder, {
        firstName: cart.first_name || undefined,
        homeSize: cart.home_size || undefined,
        serviceType: cart.service_type || undefined,
        resumeUrl,
        isSecondReminder,
      })
    );

    // Send email
    const subject = isSecondReminder
      ? "Last chance! Complete your Novara Cleaning booking"
      : "You're almost there! Complete your booking";

    const emailResult = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [cart.email],
      subject,
      html,
    });

    console.log("Abandoned cart email sent:", emailResult);

    // Update cart record
    await supabase
      .from("abandoned_carts")
      .update({
        reminder_sent_at: new Date().toISOString(),
        reminder_count: cart.reminder_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cartId);

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
