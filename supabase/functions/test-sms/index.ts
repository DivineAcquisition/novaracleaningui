import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * SMS infrastructure health check and test endpoint.
 *
 * Actions:
 *   - health:   Check Telnyx API connectivity + env vars
 *   - send:     Send a test SMS to a specific number
 *   - stats:    Get SMS sending statistics
 *   - queue:    Get retry queue status
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "health", toPhone, message } = await req.json().catch(() => ({ action: "health" }));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (action) {
      case "health": {
        const checks: Record<string, any> = {};

        // Check env vars
        checks.telnyx_api_key = !!Deno.env.get("TELNYX_API_KEY") ? "configured" : "MISSING";
        checks.telnyx_phone = Deno.env.get("TELNYX_PHONE_NUMBER") || "+18337002611 (default)";
        checks.supabase_url = !!Deno.env.get("SUPABASE_URL") ? "configured" : "MISSING";
        checks.service_role_key = !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "configured" : "MISSING";

        // Test Telnyx API connectivity
        const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");
        if (telnyxApiKey) {
          try {
            const resp = await fetch("https://api.telnyx.com/v2/messaging_profiles", {
              headers: { "Authorization": `Bearer ${telnyxApiKey}` },
            });
            checks.telnyx_api = resp.ok ? "connected" : `error (${resp.status})`;
          } catch (e: any) {
            checks.telnyx_api = `unreachable: ${e.message}`;
          }
        } else {
          checks.telnyx_api = "skipped (no API key)";
        }

        // Check DB connectivity
        const { count: logCount } = await supabase
          .from("sms_logs")
          .select("id", { count: "exact", head: true });
        checks.sms_logs_count = logCount;

        const { count: retryCount } = await supabase
          .from("sms_retry_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "retrying"]);
        checks.pending_retries = retryCount;

        const allPassing = checks.telnyx_api_key === "configured" &&
                           checks.supabase_url === "configured" &&
                           checks.service_role_key === "configured";

        return new Response(
          JSON.stringify({
            status: allPassing ? "healthy" : "degraded",
            checks,
            timestamp: new Date().toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "send": {
        if (!toPhone) {
          throw new Error("toPhone is required for send action");
        }

        const testMessage = message || `[TEST] SMS infrastructure test at ${new Date().toISOString()}`;

        const { data, error } = await supabase.functions.invoke("send-sms-notification", {
          body: {
            toPhone,
            message: testMessage,
            type: "verification",
            skipConsentCheck: true,
            skipQuietHours: true,
          },
        });

        return new Response(
          JSON.stringify({ action: "send", result: data, error: error?.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "stats": {
        const { data: statusCounts } = await supabase
          .rpc("exec_sql", { sql: "" })
          .select("*");

        // Get stats from sms_logs
        const { data: stats } = await supabase
          .from("sms_logs")
          .select("status, type")
          .order("created_at", { ascending: false })
          .limit(1000);

        const summary: Record<string, Record<string, number>> = {};
        (stats || []).forEach((row: any) => {
          if (!summary[row.status]) summary[row.status] = {};
          summary[row.status][row.type] = (summary[row.status][row.type] || 0) + 1;
        });

        // Recent failures
        const { data: recentFailures } = await supabase
          .from("sms_logs")
          .select("created_at, to_phone, type, error_message")
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(10);

        return new Response(
          JSON.stringify({ action: "stats", summary, recentFailures }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "queue": {
        const { data: queueItems } = await supabase
          .from("sms_retry_queue")
          .select("*")
          .in("status", ["pending", "retrying"])
          .order("next_retry_at", { ascending: true })
          .limit(20);

        const { count: totalPending } = await supabase
          .from("sms_retry_queue")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending", "retrying"]);

        const { count: totalFailed } = await supabase
          .from("sms_retry_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed");

        const { count: totalSent } = await supabase
          .from("sms_retry_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "sent");

        return new Response(
          JSON.stringify({
            action: "queue",
            pending: totalPending,
            failed: totalFailed,
            sent: totalSent,
            items: queueItems,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Unknown action: ${action}. Valid: health, send, stats, queue`);
    }
  } catch (error: any) {
    console.error("[TEST-SMS] Error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
