import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[AVAILABILITY] ${step}${detailsStr}`);
};

/**
 * Daily cron job to update cleaner availability based on preferred work days
 * Should run at 00:05 local time daily
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting daily availability update");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get current day abbreviation (Mon, Tue, Wed, etc.)
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const dayAbbrev = today.substring(0, 3);
    
    logStep(`Today is ${today} (${dayAbbrev})`);

    // Get all cleaners
    const { data: cleaners, error: cleanersError } = await supabase
      .from("cleaners")
      .select("id, first_name, last_name, preferred_work_days, status_today");

    if (cleanersError) {
      throw new Error(`Error fetching cleaners: ${cleanersError.message}`);
    }

    if (!cleaners || cleaners.length === 0) {
      logStep("No cleaners found");
      return new Response(
        JSON.stringify({ message: "No cleaners to update" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    logStep(`Processing ${cleaners.length} cleaners`);

    let availableCount = 0;
    let unavailableCount = 0;

    // Update each cleaner's availability
    for (const cleaner of cleaners) {
      const worksToday = cleaner.preferred_work_days?.includes(dayAbbrev) ?? false;
      const newStatus = worksToday ? "Available" : "Unavailable";

      // Only update if status changed
      if (cleaner.status_today !== newStatus) {
        const { error: updateError } = await supabase
          .from("cleaners")
          .update({ status_today: newStatus })
          .eq("id", cleaner.id);

        if (updateError) {
          logStep(`Error updating cleaner ${cleaner.id}`, { error: updateError.message });
        } else {
          logStep(`Updated ${cleaner.first_name} ${cleaner.last_name}`, {
            from: cleaner.status_today,
            to: newStatus
          });
        }
      }

      if (newStatus === "Available") availableCount++;
      else unavailableCount++;
    }

    logStep("Update complete", {
      total: cleaners.length,
      available: availableCount,
      unavailable: unavailableCount
    });

    return new Response(
      JSON.stringify({
        success: true,
        updated: cleaners.length,
        available: availableCount,
        unavailable: unavailableCount
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
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
