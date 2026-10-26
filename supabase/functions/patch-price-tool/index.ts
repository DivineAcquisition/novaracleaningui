// Add zip_code to the live Telnyx price tool and point the description
// at human_summary. Does not touch assistant tool lists.
// POST with header x-cron-secret.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const PRICE_TOOL_ID = "tool-a5972a1e-2ada-49e4-9e1f-14e7f0c34d14";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unwrap(payload: any): any {
  if (payload?.data && (payload.data.id || payload.data.tool_definition || payload.data.webhook)) return payload.data;
  return payload;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: secretRow } = await supabase.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
  const cronSecret = String(secretRow?.value || "").trim();
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return json({ error: "unauthorized" }, 401);
  const apiKey = Deno.env.get("TELNYX_API_KEY") || "";
  if (!apiKey) return json({ ok: false, reason: "telnyx_key_missing" }, 500);

  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const currentRes = await fetch(`https://api.telnyx.com/v2/ai/tools/${PRICE_TOOL_ID}`, { headers });
  const currentJson = await currentRes.json();
  const current = unwrap(currentJson);
  const definition = { ...(current.tool_definition || current.webhook || {}) };
  const schema = { ...(definition.body_parameters || {}) };
  const properties = { ...(schema.properties || {}) };
  properties.zip_code = {
    type: "string",
    description: "5-digit ZIP of the home. Pass the ZIP already on the call so the zone matches the payment link.",
  };
  const required = Array.isArray(schema.required) ? [...schema.required] : [];
  if (!required.includes("zip_code")) required.push("zip_code");
  definition.body_parameters = { ...schema, type: "object", properties, required };
  definition.description = "Price a clean for this ZIP from the live price table. Speak human_summary only. Do not add a promo, a courtesy, or the words 50 percent new. Pass zip_code.";

  const webhookPatch = await fetch(`https://api.telnyx.com/v2/ai/tools/${PRICE_TOOL_ID}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ webhook: definition }),
  });
  let patchStatus = webhookPatch.status;
  let patchMode = "webhook";
  if (patchStatus >= 300) {
    const definitionPatch = await fetch(`https://api.telnyx.com/v2/ai/tools/${PRICE_TOOL_ID}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ tool_definition: definition }),
    });
    patchStatus = definitionPatch.status;
    patchMode = "tool_definition";
  }

  const afterRes = await fetch(`https://api.telnyx.com/v2/ai/tools/${PRICE_TOOL_ID}`, { headers });
  const afterJson = await afterRes.json();
  const after = unwrap(afterJson);
  const afterDef = after.tool_definition || after.webhook || {};
  const afterProps = Object.keys(afterDef.body_parameters?.properties || {});
  return json({
    ok: patchStatus < 300 && afterProps.includes("zip_code"),
    patch_status: patchStatus,
    patch_mode: patchMode,
    properties: afterProps,
    required: afterDef.body_parameters?.required || [],
    description: afterDef.description || "",
  }, patchStatus >= 300 ? 502 : 200);
});
