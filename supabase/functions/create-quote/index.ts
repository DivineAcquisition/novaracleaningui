import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

    // TODO: Send notification email to ops team using Resend
    // await sendQuoteRequestEmail({ fullName, email, phone, sqft, address });

    return new Response(
      JSON.stringify({ success: true, message: "Quote request received", quoteId: data.id }),
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