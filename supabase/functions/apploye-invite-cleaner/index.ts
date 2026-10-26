// Link a cleaner or VA to Apploye by email.
//
// The MCP has no invite endpoint. A matching member is stored on the person.
// Anyone else is marked invite_needed, with a dashboard link the admin opens
// to send the Apploye invite. Called from Admin → Cleaners, and from the
// onboarding trigger once a cleaner finishes setup or a VA submits.
//
// Body:
//   { cleanerId } | { vaId } | { backfill: true }
// backfill requires the x-cron-secret header.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { backfillLinks, linkCleaner, linkVa } from "../_shared/apploye-link.ts";

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
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if ((body as { backfill?: boolean }).backfill) {
      const provided = req.headers.get("x-cron-secret") || "";
      const { data } = await supabase.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
      const expected = String(data?.value || Deno.env.get("CRON_SECRET") || "").trim();
      if (!expected || provided !== expected) return json({ ok: false, error: "unauthorized" }, 401);
      const totals = await backfillLinks(supabase);
      return json({ ok: true, ...totals });
    }

    const cleanerId = String((body as { cleanerId?: string }).cleanerId || "");
    const vaId = String((body as { vaId?: string }).vaId || "");
    if (cleanerId) return json(await linkCleaner(supabase, cleanerId));
    if (vaId) return json(await linkVa(supabase, vaId));
    return json({ ok: false, error: "cleanerId, vaId, or backfill required" }, 400);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
