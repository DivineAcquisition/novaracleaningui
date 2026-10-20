// Public read for /welcome/<token>. The token is the only credential.
// Claiming happens when the first membership payment succeeds, not here.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { WELCOME_PERCENT } from "../_shared/membership-welcome-copy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const token = String((body as { token?: string }).token || new URL(req.url).searchParams.get("token") || "").trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return json({ ok: false, reason: "not_found" }, 404);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data } = await supabase
      .from("membership_welcome_offers")
      .select("first_name, promo_code, percent_off, status, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (!data) return json({ ok: false, reason: "not_found" }, 404);

    const expired = Boolean(data.expires_at) && new Date(data.expires_at).getTime() < Date.now();
    const status = data.status === "claimed" ? "claimed" : expired ? "expired" : "ready";
    return json({
      ok: true,
      firstName: data.first_name || null,
      code: status === "ready" ? data.promo_code : null,
      percentOff: Number(data.percent_off) || WELCOME_PERCENT,
      expiresAt: data.expires_at,
      status,
    });
  } catch (error) {
    return json({ ok: false, reason: "server_error", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});
