import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[GENERATE-REFERRAL-CODE] ${step}`, details ? JSON.stringify(details) : '');
};

// Generate a random 8-character alphanumeric code
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude similar-looking characters
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const { customerId, email } = await req.json();
    logStep("Generating referral code", { customerId, email });

    // Try up to 10 times to generate a unique code
    let code = '';
    let attempts = 0;
    let isUnique = false;

    while (!isUnique && attempts < 10) {
      code = generateCode();
      attempts++;

      // Check if code already exists
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('referral_code', code)
        .maybeSingle();

      if (!existing) {
        isUnique = true;
      }
    }

    if (!isUnique) {
      throw new Error('Failed to generate unique referral code after 10 attempts');
    }

    // Update customer with referral code
    const { error: updateError } = await supabase
      .from('customers')
      .update({ referral_code: code })
      .eq('id', customerId);

    if (updateError) throw updateError;

    logStep("Referral code generated successfully", { code, customerId });

    return new Response(JSON.stringify({ code }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
