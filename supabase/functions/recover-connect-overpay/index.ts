// ─── recover-connect-overpay ────────────────────────────────────────────
//
// Watches a Connect bank-payout reversal. When the clawed-back cents become
// *available* on the contractor's Stripe balance, reverses the original
// platform transfer so the money lands on Novara's balance.
//
// Auth: x-cron-secret (pg_cron) or service-role bearer.
// Does not reverse a transfer while available funds are short.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { tickRecoverConnectOverpay } from "../_shared/recover-connect-overpay.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronHeader = req.headers.get("x-cron-secret") || "";
  let ok = false;
  if (token && serviceKey && token === serviceKey) ok = true;
  if (!ok && cronHeader) {
    const expected = (await resolveSecret(admin, "CRON_SECRET")).trim();
    if (expected && cronHeader === expected) ok = true;
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const rowId = body?.rowId ? String(body.rowId) : undefined;
    const result = await tickRecoverConnectOverpay(admin, { rowId });
    return json({ ok: true, source: body?.source || "manual", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[recover-connect-overpay]", message);
    return json({ error: message }, 500);
  }
});
