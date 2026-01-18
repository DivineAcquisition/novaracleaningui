import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RETRY-FAILED-PAYOUTS] ${step}${detailsStr}`);
};

const MAX_RETRY_ATTEMPTS = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting failed payout retry job");
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find failed payouts that haven't exceeded retry limit
    // Only retry payouts from the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: failedPayouts, error: fetchError } = await supabase
      .from("payouts")
      .select("*, cleaners(*)")
      .eq("status", "failed")
      .lt("retry_count", MAX_RETRY_ATTEMPTS)
      .gte("created_at", sevenDaysAgo.toISOString())
      .order("created_at", { ascending: true })
      .limit(10);

    if (fetchError) {
      throw new Error(`Failed to fetch payouts: ${fetchError.message}`);
    }

    if (!failedPayouts || failedPayouts.length === 0) {
      logStep("No failed payouts to retry");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No payouts to retry", 
          processed: 0,
          successful: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logStep("Found failed payouts to retry", { count: failedPayouts.length });

    const results: Array<{ 
      payoutId: string; 
      cleanerId: string;
      success: boolean; 
      data?: any; 
      error?: string;
      skipped?: boolean;
      skipReason?: string;
    }> = [];

    for (const payout of failedPayouts) {
      const cleaner = payout.cleaners;

      // Verify cleaner still has valid Stripe account
      if (!cleaner?.payouts_enabled) {
        logStep("Skipping - cleaner payouts not enabled", { 
          payoutId: payout.id, 
          cleanerId: payout.cleaner_id 
        });
        
        // Mark payout as permanently failed
        await supabase
          .from("payouts")
          .update({
            status: "failed",
            failed_reason: "Cleaner payouts not enabled - Stripe onboarding incomplete",
            retry_count: MAX_RETRY_ATTEMPTS, // Stop retrying
          })
          .eq("id", payout.id);
        
        results.push({
          payoutId: payout.id,
          cleanerId: payout.cleaner_id,
          success: false,
          skipped: true,
          skipReason: "Cleaner payouts not enabled"
        });
        
        continue;
      }

      if (!cleaner?.stripe_account_id) {
        logStep("Skipping - cleaner has no Stripe account", { 
          payoutId: payout.id, 
          cleanerId: payout.cleaner_id 
        });
        
        await supabase
          .from("payouts")
          .update({
            status: "failed",
            failed_reason: "Cleaner has no Stripe account configured",
            retry_count: MAX_RETRY_ATTEMPTS,
          })
          .eq("id", payout.id);
        
        results.push({
          payoutId: payout.id,
          cleanerId: payout.cleaner_id,
          success: false,
          skipped: true,
          skipReason: "No Stripe account"
        });
        
        continue;
      }

      // Delete the existing failed payout record so process-payout-for-cleaner can create a new one
      logStep("Deleting failed payout record for retry", { payoutId: payout.id });
      
      await supabase
        .from("payouts")
        .delete()
        .eq("id", payout.id);

      try {
        const response = await supabase.functions.invoke('process-payout-for-cleaner', {
          body: { 
            bookingId: payout.booking_id, 
            cleanerId: payout.cleaner_id 
          }
        });

        if (response.error) {
          throw new Error(response.error.message || 'Unknown error from process-payout-for-cleaner');
        }

        results.push({
          payoutId: payout.id,
          cleanerId: payout.cleaner_id,
          success: true,
          data: response.data
        });

        logStep("Retry successful", { 
          payoutId: payout.id, 
          cleanerId: payout.cleaner_id,
          newPayoutId: response.data?.payout_id
        });
      } catch (retryError) {
        const errorMessage = retryError instanceof Error ? retryError.message : String(retryError);
        
        results.push({
          payoutId: payout.id,
          cleanerId: payout.cleaner_id,
          success: false,
          error: errorMessage
        });
        
        logStep("Retry failed", { 
          payoutId: payout.id, 
          cleanerId: payout.cleaner_id,
          error: errorMessage 
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const skippedCount = results.filter(r => r.skipped).length;
    
    logStep("Retry job completed", { 
      total: results.length, 
      successful: successCount,
      skipped: skippedCount,
      failed: results.length - successCount - skippedCount
    });

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        successful: successCount,
        skipped: skippedCount,
        failed: results.length - successCount - skippedCount,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
