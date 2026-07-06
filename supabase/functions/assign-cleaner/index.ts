// assign-cleaner — LEGACY SHIM (auto-assignment retired 2026-07-06)
//
// The original version round-robined a cleaner onto the booking by ZIP and
// immediately texted the contractor AND the customer — the exact automatic
// contractor SMS the operator has since banned. No in-repo code calls this
// anymore (stripe-webhook dropped it long ago), but the function is public
// (verify_jwt = false) and may still be wired into old GHL/Zapier flows.
//
// Instead of assigning + texting, this shim now routes the booking through
// the approval-first pipeline: it ensures a dispatch job exists (via
// auto-dispatch-booking WITHOUT sendOffers), which parks the job as
// "Pending Approval" and pings the dispatch Discord channel. Offers only
// go out when an admin approves in the Dispatch console.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { bookingId } = await req.json().catch(() => ({} as { bookingId?: string }));
    console.log("[ASSIGN-CLEANER] legacy shim invoked — routing to approval-first dispatch", { bookingId });

    if (!bookingId) {
      return new Response(
        JSON.stringify({ error: "bookingId required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // No sendOffers flag → job is created (if missing) and parked for
    // admin approval. No contractor is texted from this path, ever.
    const { data, error } = await supabase.functions.invoke("auto-dispatch-booking", {
      body: { bookingId },
    });
    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        legacyShim: true,
        message: "Auto-assignment is retired — job queued for admin dispatch approval instead.",
        jobId: (data as { jobId?: string })?.jobId ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ASSIGN-CLEANER] shim error", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
