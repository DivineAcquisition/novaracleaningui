import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SCORES] ${step}${detailsStr}`);
};

/**
 * Calculate and update cleaner workload and weighted scores
 * Should run periodically or after job assignments change
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cleanerId } = await req.json();
    logStep("Updating scores", { cleanerId: cleanerId || "all" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get cleaners to update
    let cleanersQuery = supabase.from("cleaners").select("*");
    
    if (cleanerId) {
      cleanersQuery = cleanersQuery.eq("id", cleanerId);
    }

    const { data: cleaners, error: cleanersError } = await cleanersQuery;

    if (cleanersError) {
      throw new Error(`Error fetching cleaners: ${cleanersError.message}`);
    }

    if (!cleaners || cleaners.length === 0) {
      throw new Error("No cleaners found");
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (const cleaner of cleaners) {
      // Calculate jobs_assigned_last_7d
      const { count: pastJobsCount } = await supabase
        .from("job_assignments")
        .select("*", { count: "exact", head: true })
        .eq("cleaner_id", cleaner.id)
        .in("status", ["Confirmed", "Accepted"])
        .gte("created_at", sevenDaysAgo.toISOString());

      // Calculate upcoming jobs and hours for next 7 days
      const { data: upcomingJobs } = await supabase
        .from("job_assignments")
        .select("jobs(duration_est_hours, start_datetime)")
        .eq("cleaner_id", cleaner.id)
        .eq("status", "Confirmed")
        .gte("jobs.start_datetime", now.toISOString())
        .lte("jobs.start_datetime", sevenDaysAhead.toISOString());

      const upcomingCount = upcomingJobs?.length || 0;
      const upcomingHours = upcomingJobs?.reduce((sum, assignment: any) => {
        return sum + (assignment.jobs?.duration_est_hours || 0);
      }, 0) || 0;

      // Calculate workload_score
      const workloadScore = upcomingCount + (upcomingHours / 4);

      // Calculate weighted_score
      const maxWorkload = Math.max(...cleaners.map(c => workloadScore), 1);
      const normalizedWorkload = workloadScore / maxWorkload;
      const qualityPenalty = cleaner.average_rating 
        ? (5 - cleaner.average_rating) / 5
        : 0.25;
      const weightedScore = (0.7 * normalizedWorkload) + (0.3 * qualityPenalty);

      // Update cleaner
      const { error: updateError } = await supabase
        .from("cleaners")
        .update({
          jobs_assigned_last_7d: pastJobsCount || 0,
          workload_score: Math.round(workloadScore * 100) / 100,
          weighted_score: Math.round(weightedScore * 100) / 100
        })
        .eq("id", cleaner.id);

      if (updateError) {
        logStep(`Error updating cleaner ${cleaner.id}`, { error: updateError.message });
      } else {
        logStep(`Updated scores for ${cleaner.first_name} ${cleaner.last_name}`, {
          pastJobs: pastJobsCount,
          workload: workloadScore,
          weighted: weightedScore
        });
      }
    }

    logStep("Scores updated", { count: cleaners.length });

    return new Response(
      JSON.stringify({
        success: true,
        updated: cleaners.length
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
