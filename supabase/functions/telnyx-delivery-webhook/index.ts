import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Telnyx sends delivery receipts (DLRs) and inbound messages via webhooks.
 * Configure this URL in your Telnyx Messaging Profile:
 *   https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-delivery-webhook
 *
 * Events handled:
 *   - message.sent
 *   - message.delivered
 *   - message.failed
 *   - message.finalized
 *   - message.received (inbound - forwards STOP to handle-sms-optout)
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Telnyx wraps the event payload in a `data` object
    const event = body?.data;
    if (!event) {
      console.log("[TELNYX-WH] No event data received");
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventType = event.event_type || body?.meta?.event_type;
    const payload = event.payload;

    console.log(`[TELNYX-WH] Event: ${eventType}`, {
      id: payload?.id,
      to: payload?.to?.[0]?.phone_number,
      from: payload?.from?.phone_number,
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    switch (eventType) {
      case "message.sent": {
        if (payload?.id) {
          await supabase
            .from("sms_logs")
            .update({
              status: "sent",
              delivery_status: "sent",
              updated_at: new Date().toISOString(),
            })
            .eq("provider_message_id", payload.id);
        }
        break;
      }

      case "message.delivered": {
        if (payload?.id) {
          await supabase
            .from("sms_logs")
            .update({
              status: "delivered",
              delivery_status: "delivered",
              delivered_at: new Date().toISOString(),
              carrier: payload?.to?.[0]?.carrier || null,
              updated_at: new Date().toISOString(),
            })
            .eq("provider_message_id", payload.id);
        }
        break;
      }

      case "message.failed":
      case "message.finalized": {
        if (payload?.id) {
          const errorDetail = payload?.errors?.[0]?.detail ||
            payload?.to?.[0]?.status || "delivery_failed";

          await supabase
            .from("sms_logs")
            .update({
              status: "failed",
              delivery_status: errorDetail,
              error_message: errorDetail,
              updated_at: new Date().toISOString(),
            })
            .eq("provider_message_id", payload.id);
        }
        break;
      }

      case "message.received": {
        // Inbound SMS - check for opt-out keywords
        const inboundText = (payload?.text || "").trim().toUpperCase();
        const fromPhone = payload?.from?.phone_number;

        if (fromPhone && ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT"].includes(inboundText)) {
          console.log(`[TELNYX-WH] Opt-out received from ${fromPhone}`);

          try {
            await supabase.functions.invoke("handle-sms-optout", {
              body: { phone: fromPhone, message: inboundText },
            });
          } catch (optOutError) {
            console.error("[TELNYX-WH] Failed to process opt-out:", optOutError);
          }
        }
        break;
      }

      default:
        console.log(`[TELNYX-WH] Unhandled event type: ${eventType}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[TELNYX-WH] Error:", error.message);
    // Always return 200 to Telnyx to prevent retries for parsing errors
    return new Response(JSON.stringify({ received: true, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
