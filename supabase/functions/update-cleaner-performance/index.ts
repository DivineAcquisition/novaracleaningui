import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[UPDATE-PERFORMANCE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cleanerId } = await req.json();
    logStep("Starting performance update", { cleanerId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get cleaners to update (specific or all)
    const query = supabase
      .from("cleaners")
      .select("id, total_offers_received, total_offers_accepted, total_on_time_arrivals, completed_bookings");
    
    if (cleanerId) {
      query.eq("id", cleanerId);
    }

    const { data: cleaners, error: cleanersError } = await query;

    if (cleanersError) {
      throw cleanersError;
    }

    if (!cleaners || cleaners.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No cleaners to update" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep(`Updating ${cleaners.length} cleaner(s)`);

    // Update each cleaner
    for (const cleaner of cleaners) {
      // Rates are stored as a 0-1 fraction (NOT 0-100). Every consumer
      // — dispatch-job scoring (× 10), _shared/dispatch-scoring (× 10),
      // the admin Cleaners table (× 100 for display), and the Zapier
      // webhook (× 100) — treats them as fractions. Storing 0-100 here
      // was inflating the dispatch performance score by 100×.
      const acceptanceRate = cleaner.total_offers_received > 0
        ? cleaner.total_offers_accepted / cleaner.total_offers_received
        : 0;

      const onTimeRate = cleaner.completed_bookings > 0
        ? cleaner.total_on_time_arrivals / cleaner.completed_bookings
        : 0;

      // Update cleaner record (round to 3 decimals so the fraction
      // keeps ~1% display resolution after × 100).
      const { error: updateError } = await supabase
        .from("cleaners")
        .update({
          acceptance_rate: Math.round(acceptanceRate * 1000) / 1000,
          on_time_rate: Math.round(onTimeRate * 1000) / 1000
        })
        .eq("id", cleaner.id);

      if (updateError) {
        console.error(`[UPDATE-PERFORMANCE] Error updating cleaner ${cleaner.id}:`, updateError);
      } else {
        logStep(`Updated cleaner ${cleaner.id}`, { acceptanceRate, onTimeRate });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        updated: cleaners.length,
        message: `Updated performance metrics for ${cleaners.length} cleaner(s)`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[UPDATE-PERFORMANCE] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
