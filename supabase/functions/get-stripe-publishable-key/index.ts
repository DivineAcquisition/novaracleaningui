import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-expiry",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Check for publishable key in environment
    const key = Deno.env.get("STRIPE_PUBLISHABLE_KEY");
    
    console.log("[GET-STRIPE-KEY] Checking for STRIPE_PUBLISHABLE_KEY:", key ? "Found" : "Not found");
    
    if (!key) {
      console.error("[GET-STRIPE-KEY] STRIPE_PUBLISHABLE_KEY not configured in Supabase secrets");
      return new Response(JSON.stringify({ 
        success: false,
        error: "Stripe is not configured. Please contact support.",
        key: null 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200, // Keep 200 for CORS compatibility but indicate error in response
      });
    }

    // Validate it looks like a Stripe publishable key
    if (!key.startsWith('pk_')) {
      console.error("[GET-STRIPE-KEY] Invalid key format - must start with pk_");
      return new Response(JSON.stringify({ 
        success: false,
        error: "Invalid Stripe configuration. Please contact support.",
        key: null 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log("[GET-STRIPE-KEY] Returning valid key (prefix):", key.substring(0, 12) + "...");

    return new Response(JSON.stringify({ 
      success: true,
      key,
      error: null 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GET-STRIPE-KEY] Unexpected error:", msg);
    return new Response(JSON.stringify({ 
      success: false,
      error: msg,
      key: null 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
