// Add street lookup and checklist texting to the live assistants.
// Also lets the price and booking tools receive occupancy and home condition.
// Sends tool_ids only as a full existing list plus the new ids.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const BASE = "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1";
const ASSISTANTS = [
  "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d",
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f",
  "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e",
];
const PRICE_TOOL_ID = "tool-a5972a1e-2ada-49e4-9e1f-14e7f0c34d14";
const BOOK_TOOL_ID = "tool-264d2494-0c0a-4d97-ab81-b5d514e8e397";

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
  if (payload?.data && !Array.isArray(payload.data) && (payload.data.id || payload.data.tool_ids || payload.data.tool_definition)) return payload.data;
  return payload;
}

const TOOLS = [
  {
    name: "lookup_address",
    description: "After the ZIP, look up the street address. Returns the city and state. Do not ask the caller for the city.",
    url: `${BASE}/voice-address`,
    timeout_ms: 15000,
    required: ["street", "zip_code"],
    properties: {
      street: { type: "string", description: "Street number and street name the caller said." },
      zip_code: { type: "string", description: "5-digit ZIP already confirmed as served." },
    },
  },
  {
    name: "send_checklist",
    description: "Text the checklist of what is included. Call this before saying any price on a booking call, and whenever the caller asks what is included.",
    url: `${BASE}/voice-checklist`,
    timeout_ms: 20000,
    required: ["phone", "service_type"],
    properties: {
      phone: { type: "string", description: "Caller mobile. Use the phone on the call." },
      service_type: { type: "string", description: "standard, deep, moveInOut, or combo.", enum: ["standard", "deep", "moveInOut", "combo"] },
      first_name: { type: "string", description: "First name if you have it." },
    },
  },
];

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

  async function telnyx(path: string, method: string, body?: unknown) {
    const res = await fetch(`https://api.telnyx.com/v2${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 300) }; }
    return { status: res.status, payload };
  }

  const listed = await telnyx("/ai/tools", "GET");
  const rows = Array.isArray(listed.payload?.data) ? listed.payload.data : [];
  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = row?.webhook?.name || row?.tool_definition?.name || row?.name;
    if (name && row?.id) byName.set(String(name), String(row.id));
  }

  const created: Array<{ name: string; id: string; status: number }> = [];
  for (const tool of TOOLS) {
    const existing = byName.get(tool.name);
    if (existing) {
      created.push({ name: tool.name, id: existing, status: 200 });
      continue;
    }
    const made = await telnyx("/ai/tools", "POST", {
      type: "webhook",
      webhook: {
        name: tool.name,
        description: tool.description,
        url: tool.url,
        method: "POST",
        headers: [{ name: "Content-Type", value: "application/json" }],
        timeout_ms: tool.timeout_ms,
        body_parameters: {
          type: "object",
          properties: tool.properties,
          required: tool.required,
        },
      },
    });
    const id = String(unwrap(made.payload)?.id || made.payload?.data?.id || "");
    if (id) byName.set(tool.name, id);
    created.push({ name: tool.name, id, status: made.status });
  }

  const newIds = created.map((row) => row.id).filter(Boolean);
  const assistants = [];
  for (const id of ASSISTANTS) {
    const before = unwrap((await telnyx(`/ai/assistants/${id}`, "GET")).payload);
    const beforeIds: string[] = Array.isArray(before?.tool_ids) ? before.tool_ids : [];
    const merged = [...beforeIds];
    for (const toolId of newIds) if (!merged.includes(toolId)) merged.push(toolId);
    const patched = await telnyx(`/ai/assistants/${id}`, "PATCH", { tool_ids: merged });
    const after = unwrap((await telnyx(`/ai/assistants/${id}`, "GET")).payload);
    assistants.push({
      id,
      patch_status: patched.status,
      before_tools: beforeIds.length,
      after_tools: Array.isArray(after?.tool_ids) ? after.tool_ids.length : 0,
    });
  }

  async function addFields(toolId: string, fields: Record<string, unknown>) {
    const current = unwrap((await telnyx(`/ai/tools/${toolId}`, "GET")).payload);
    const definition = { ...(current?.tool_definition || current?.webhook || {}) };
    const schema = { ...(definition.body_parameters || {}) };
    const properties = { ...(schema.properties || {}), ...fields };
    definition.body_parameters = { ...schema, type: "object", properties, required: schema.required || [] };
    const patched = await telnyx(`/ai/tools/${toolId}`, "PATCH", { webhook: definition });
    return { status: patched.status, url: definition.url || "", properties: Object.keys(properties) };
  }

  const price = await addFields(PRICE_TOOL_ID, {
    occupancy: { type: "string", description: "empty when the home is vacant. Otherwise occupied." },
    home_condition: { type: "string", description: "light when kept up, typical when lived in, heavy when neglected or a first professional clean." },
  });
  const book = await addFields(BOOK_TOOL_ID, {
    occupancy: { type: "string", description: "empty for a vacant move-out. Otherwise occupied." },
  });

  const failed = created.some((row) => !row.id || row.status >= 300) || assistants.some((row) => row.patch_status >= 300 || row.after_tools < row.before_tools);
  return json({ ok: !failed, created, assistants, price, book }, failed ? 502 : 200);
});
