// Record the Apploye clock for a cleaner arrival or checkout.
//
// Fired by database triggers when a cleaner checks in (job assignment moves
// to in progress, or a booking-only check-in stamps bookings.check_in_time)
// and when the job or booking checks out. Requires x-cron-secret. A failure
// here never blocks the check-in itself — the trigger swallows HTTP errors.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { recordArrival, recordCheckout } from "../_shared/apploye-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const provided = req.headers.get("x-cron-secret") || "";
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
    const expected = String(data?.value || Deno.env.get("CRON_SECRET") || "").trim();
    if (!expected || provided !== expected) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as {
      checkout?: boolean;
      jobId?: string;
      bookingId?: string;
      cleanerId?: string;
      assignmentId?: string;
    };

    if (body.checkout) {
      return json(await recordCheckout(supabase, { jobId: body.jobId, bookingId: body.bookingId }));
    }
    return json(await recordArrival(supabase, {
      jobId: body.jobId,
      bookingId: body.bookingId,
      cleanerId: String(body.cleanerId || ""),
      assignmentId: body.assignmentId,
    }));
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
