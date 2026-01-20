/**
 * Check Expired Offers - Cron Job
 * 
 * Runs periodically to:
 * 1. Find offers that have passed their response deadline
 * 2. Mark them as expired
 * 3. Trigger redistribution
 * 
 * Should be scheduled to run every 5 minutes via pg_cron or external scheduler
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-EXPIRED] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting expired offers check");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date().toISOString();

    // Find expired offers
    const { data: expiredOffers, error: fetchError } = await supabase
      .from("job_assignments")
      .select(`
        id,
        job_id,
        cleaner_id,
        response_deadline,
        cleaners(first_name, last_name)
      `)
      .eq("status", "Offered")
      .not("response_deadline", "is", null)
      .lt("response_deadline", now);

    if (fetchError) {
      throw new Error(`Error fetching expired offers: ${fetchError.message}`);
    }

    if (!expiredOffers || expiredOffers.length === 0) {
      logStep("No expired offers found");
      return new Response(
        JSON.stringify({ success: true, processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep(`Found ${expiredOffers.length} expired offers`);

    let processed = 0;
    let errors = 0;
    const jobsToRedistribute = new Set<string>();

    // Process each expired offer
    for (const offer of expiredOffers) {
      try {
        // Update assignment status
        await supabase
          .from("job_assignments")
          .update({
            status: "Expired",
            decline_reason: "Response deadline exceeded"
          })
          .eq("id", offer.id);

        // Update queue entry
        await supabase
          .from("assignment_queue")
          .update({ status: "expired" })
          .eq("job_id", offer.job_id)
          .eq("cleaner_id", offer.cleaner_id);

        // Update analytics
        await supabase
          .from("assignment_analytics")
          .update({
            total_expirations: supabase.rpc ? 
              supabase.raw('total_expirations + 1') : 1
          })
          .eq("job_id", offer.job_id);

        // Mark tokens as used
        await supabase
          .from("job_assignment_tokens")
          .update({ used_at: now })
          .eq("job_assignment_id", offer.id);

        // Update cleaner metrics (count as a non-response)
        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("total_offers_received")
          .eq("id", offer.cleaner_id)
          .single();

        await supabase
          .from("cleaners")
          .update({
            total_offers_received: (cleaner?.total_offers_received || 0) + 1
            // Note: Don't increment accepted, which effectively lowers acceptance rate
          })
          .eq("id", offer.cleaner_id);

        jobsToRedistribute.add(offer.job_id);
        processed++;

        logStep(`Processed expired offer`, {
          assignmentId: offer.id,
          cleaner: offer.cleaners?.first_name
        });
      } catch (err) {
        logStep(`Error processing offer ${offer.id}`, { error: err });
        errors++;
      }
    }

    // Trigger redistribution for affected jobs
    for (const jobId of jobsToRedistribute) {
      try {
        await supabase.functions.invoke("automated-job-redistribution", {
          body: { jobId, reason: "expired" }
        });
        logStep(`Triggered redistribution for job ${jobId}`);
      } catch (err) {
        logStep(`Redistribution failed for job ${jobId}`, { error: err });
      }
    }

    logStep("Completed", { processed, errors, jobsRedistributed: jobsToRedistribute.size });

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        errors,
        jobsRedistributed: jobsToRedistribute.size
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
