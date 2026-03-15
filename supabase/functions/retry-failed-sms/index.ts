import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const BACKOFF_MULTIPLIER = 2;
const BASE_DELAY_MS = 5 * 60 * 1000; // 5 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[SMS-RETRY] Starting retry processor");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date().toISOString();

    const { data: pendingItems, error: fetchError } = await supabase
      .from("sms_retry_queue")
      .select("*")
      .in("status", ["pending", "retrying"])
      .lte("next_retry_at", now)
      .order("next_retry_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      throw new Error(`Failed to fetch retry queue: ${fetchError.message}`);
    }

    if (!pendingItems || pendingItems.length === 0) {
      console.log("[SMS-RETRY] No pending items");
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No pending retries" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[SMS-RETRY] Processing ${pendingItems.length} items`);

    let successCount = 0;
    let failCount = 0;
    const results: any[] = [];

    for (const item of pendingItems) {
      // Mark as retrying
      await supabase
        .from("sms_retry_queue")
        .update({
          status: "retrying",
          last_attempt_at: new Date().toISOString(),
          retry_count: item.retry_count + 1,
        })
        .eq("id", item.id);

      try {
        const { data: smsResult, error: smsError } = await supabase.functions.invoke(
          "send-sms-notification",
          {
            body: {
              toPhone: item.to_phone,
              message: item.message,
              type: item.type,
              jobAssignmentId: item.job_assignment_id,
              skipConsentCheck: false,
              skipQuietHours: false,
            },
          }
        );

        if (smsError) {
          throw new Error(smsError.message || "SMS function invocation failed");
        }

        const responseData = typeof smsResult === 'string' ? JSON.parse(smsResult) : smsResult;

        if (responseData?.success) {
          await supabase
            .from("sms_retry_queue")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
            })
            .eq("id", item.id);

          successCount++;
          results.push({ id: item.id, status: "sent" });
        } else if (responseData?.reason === "opted_out" || responseData?.reason === "sms_disabled") {
          await supabase
            .from("sms_retry_queue")
            .update({
              status: "cancelled",
              last_error: `Cancelled: ${responseData.reason}`,
            })
            .eq("id", item.id);

          results.push({ id: item.id, status: "cancelled", reason: responseData.reason });
        } else {
          throw new Error(responseData?.error || "Unknown SMS error");
        }
      } catch (retryError: any) {
        console.error(`[SMS-RETRY] Failed item ${item.id}:`, retryError.message);

        const newRetryCount = item.retry_count + 1;

        if (newRetryCount >= item.max_retries) {
          await supabase
            .from("sms_retry_queue")
            .update({
              status: "failed",
              last_error: retryError.message,
            })
            .eq("id", item.id);

          results.push({ id: item.id, status: "failed", error: retryError.message });
        } else {
          const nextDelay = BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, newRetryCount);
          const nextRetryAt = new Date(Date.now() + nextDelay).toISOString();

          await supabase
            .from("sms_retry_queue")
            .update({
              status: "pending",
              last_error: retryError.message,
              next_retry_at: nextRetryAt,
            })
            .eq("id", item.id);

          results.push({ id: item.id, status: "requeued", nextRetry: nextRetryAt });
        }

        failCount++;
      }
    }

    console.log(`[SMS-RETRY] Complete: ${successCount} sent, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingItems.length,
        sent: successCount,
        failed: failCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[SMS-RETRY] Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
