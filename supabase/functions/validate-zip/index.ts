import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { zipCode } = await req.json();
    
    console.log(`[validate-zip] Validating ZIP code: ${zipCode}`);

    // Validate input
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      console.log(`[validate-zip] Invalid ZIP format: ${zipCode}`);
      return new Response(
        JSON.stringify({ 
          valid: false, 
          message: "Please enter a valid 5-digit ZIP code" 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Query service coverage zones
    const { data: zone, error } = await supabase
      .from('service_coverage_zones')
      .select('city, state, tier, tier_label, is_active')
      .eq('zip_code', zipCode)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error(`[validate-zip] Database error:`, error);
      return new Response(
        JSON.stringify({ 
          valid: false, 
          message: "Error checking service area. Please try again." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!zone) {
      console.log(`[validate-zip] ZIP ${zipCode} not in service area`);
      return new Response(
        JSON.stringify({ 
          valid: false, 
          message: "We don't currently service this area. Call us at (415) 555-0123 for assistance." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[validate-zip] ZIP ${zipCode} validated successfully: ${zone.city}, ${zone.state}`);
    return new Response(
      JSON.stringify({ 
        valid: true, 
        city: zone.city,
        state: zone.state,
        tier: zone.tier,
        tierLabel: zone.tier_label
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[validate-zip] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ 
        valid: false, 
        message: "An unexpected error occurred. Please try again." 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
