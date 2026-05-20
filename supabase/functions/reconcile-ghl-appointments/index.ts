// reconcile-ghl-appointments
//
// Cron-triggered: finds confirmed bookings in the next 30 days that
// either never got a GHL appointment or have a sync error, then
// re-invokes book-ghl-appointment for each. Safe to run every 5
// minutes — the underlying function is idempotent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const todayIso = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const { data: rows } = await supabase
      .from("bookings")
      .select(
        "id, status, ghl_appointment_id, ghl_appointment_sync_error, service_date",
      )
      .in("status", ["confirmed", "booked"])
      .gte("service_date", todayIso)
      .lte("service_date", horizon)
      .or("ghl_appointment_id.is.null,ghl_appointment_sync_error.not.is.null")
      .limit(50);

    const results: Array<
      { id: string; ok: boolean; appointmentId?: string | null; error?: string }
    > = [];
    for (const row of (rows || [])) {
      try {
        const r = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/book-ghl-appointment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({ bookingId: row.id }),
          },
        );
        const j = await r.json();
        results.push({
          id: row.id,
          ok: !!j?.success,
          appointmentId: j?.appointmentId || null,
          error: j?.error,
        });
      } catch (err) {
        results.push({
          id: row.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, scanned: rows?.length ?? 0, results }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
