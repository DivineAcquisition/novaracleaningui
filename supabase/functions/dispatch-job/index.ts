import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DISPATCH] ${step}${detailsStr}`);
};

/**
 * Haversine formula to calculate distance between two lat/lng points in miles
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Auto-dispatch algorithm:
 * 1. Find available cleaners within distance
 * 2. Calculate workload and weighted scores
 * 3. Select best candidates
 * 4. Create job assignments
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { jobId } = await req.json();
    logStep("Starting dispatch", { jobId });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    if (!job.lat || !job.lng) {
      throw new Error("Job location not geocoded");
    }

    logStep("Job details", { 
      minCleaners: job.min_cleaners_required,
      location: `${job.city}, ${job.state}`,
      sqft: job.sq_ft 
    });

    // Get current day of week (0 = Sunday, 6 = Saturday)
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const dayAbbrev = today.substring(0, 3); // Mon, Tue, etc.

    // Find available cleaners
    const { data: cleaners, error: cleanersError } = await supabase
      .from("cleaners")
      .select("*")
      .eq("status_today", "Available")
      .eq("approved", true)
      .eq("available_for_bookings", true);

    if (cleanersError) {
      throw new Error(`Error fetching cleaners: ${cleanersError.message}`);
    }

    if (!cleaners || cleaners.length === 0) {
      logStep("No available cleaners found");
      
      // Create dispatch alert
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: "No available cleaners found",
        severity: "critical"
      });

      await supabase
        .from("jobs")
        .update({ 
          status: "Dispatching",
          manual_intervention_required: true,
          dispatch_alert_reason: "No available cleaners"
        })
        .eq("id", jobId);

      throw new Error("No available cleaners");
    }

    logStep(`Found ${cleaners.length} available cleaners`);

    // Filter by distance and preferred work days
    const candidates = cleaners
      .filter(cleaner => {
        if (!cleaner.home_lat || !cleaner.home_lng) return false;
        
        const distance = haversineDistance(
          cleaner.home_lat,
          cleaner.home_lng,
          job.lat,
          job.lng
        );

        // Check if within max travel distance
        const withinDistance = distance <= (cleaner.max_travel_miles || 20);
        
        // Check preferred work days
        const worksToday = cleaner.preferred_work_days?.includes(dayAbbrev) ?? false;

        return withinDistance && worksToday;
      })
      .map(cleaner => {
        const distance = haversineDistance(
          cleaner.home_lat!,
          cleaner.home_lng!,
          job.lat!,
          job.lng!
        );

        return {
          ...cleaner,
          distance_miles: Math.round(distance * 10) / 10
        };
      });

    if (candidates.length === 0) {
      logStep("No candidates within distance and work preferences");
      
      await supabase.from("dispatch_alerts").insert({
        job_id: jobId,
        reason: "No cleaners within travel distance or working today",
        severity: "warning"
      });

      await supabase
        .from("jobs")
        .update({ 
          status: "Dispatching",
          dispatch_alert_reason: "No nearby cleaners available"
        })
        .eq("id", jobId);

      throw new Error("No candidates found");
    }

    logStep(`${candidates.length} candidates within range`);

    // Calculate weighted scores and sort
    const maxWorkload = Math.max(...candidates.map(c => c.workload_score || 0), 1);
    
    const scoredCandidates = candidates.map(cleaner => {
      const normalizedWorkload = (cleaner.workload_score || 0) / maxWorkload;
      const qualityPenalty = cleaner.average_rating 
        ? (5 - cleaner.average_rating) / 5
        : 0.25;
      const weightedScore = (0.7 * normalizedWorkload) + (0.3 * qualityPenalty);
      
      return {
        ...cleaner,
        weighted_score: weightedScore
      };
    });

    // Sort by weighted score (lower is better), then distance
    scoredCandidates.sort((a, b) => {
      if (Math.abs(a.weighted_score - b.weighted_score) < 0.01) {
        return a.distance_miles - b.distance_miles;
      }
      return a.weighted_score - b.weighted_score;
    });

    // Select top N candidates
    const selectedCleaners = scoredCandidates.slice(0, job.min_cleaners_required);

    logStep(`Selected ${selectedCleaners.length} cleaners`, {
      cleaners: selectedCleaners.map(c => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`,
        distance: c.distance_miles,
        score: c.weighted_score
      }))
    });

    // Create job assignments
    const assignments = selectedCleaners.map((cleaner, index) => ({
      job_id: jobId,
      cleaner_id: cleaner.id,
      distance_miles: cleaner.distance_miles,
      role: index === 0 ? "Lead" : "Support",
      status: "Offered"
    }));

    const { error: assignError } = await supabase
      .from("job_assignments")
      .insert(assignments);

    if (assignError) {
      throw new Error(`Error creating assignments: ${assignError.message}`);
    }

    // Update job status
    await supabase
      .from("jobs")
      .update({ status: "Assigned" })
      .eq("id", jobId);

    logStep("Dispatch complete", { assignmentCount: assignments.length });

    return new Response(
      JSON.stringify({
        success: true,
        assignedCleaners: selectedCleaners.length,
        required: job.min_cleaners_required,
        cleaners: selectedCleaners.map(c => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name}`,
          distance: c.distance_miles,
          role: c === selectedCleaners[0] ? "Lead" : "Support"
        }))
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
