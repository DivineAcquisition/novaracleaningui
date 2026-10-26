// Read-only check of the live assistants' tool lists.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const ASSISTANTS = [
  "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d",
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f",
  "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: secretRow } = await supabase.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
  if (!secretRow?.value || req.headers.get("x-cron-secret") !== String(secretRow.value).trim()) return json({ error: "unauthorized" }, 401);
  const apiKey = Deno.env.get("TELNYX_API_KEY") || "";
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const restore: Record<string, string[]> = {
    "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d": [
      "tool-cfba008b-0ca1-4891-bb50-2ff2b298643e",
      "tool-b667831f-fad2-48b4-9223-2b718f5c62c3",
      "tool-a5972a1e-2ada-49e4-9e1f-14e7f0c34d14",
      "tool-da313af6-c059-4db3-a646-4e9b27d6eacd",
      "tool-264d2494-0c0a-4d97-ab81-b5d514e8e397",
      "tool-cbf1b88b-24d7-4424-84e8-fc0098e88ccc",
      "tool-e16c8e3a-ce01-4590-913b-33c8729b87b8",
      "tool-115de5e8-a1a5-481d-b032-32b22d91daad",
      "tool-c197145f-507c-4aae-81af-e27119417232",
      "tool-13153730-07a5-4d7b-9651-b175d79eda21",
      "tool-7c44bd0f-18b0-450f-bc52-c7f945cd204e",
    ],
    "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f": [
      "tool-a9bf876a-f8e6-4422-8b66-d7aa637727cb",
      "tool-2f3ad7bf-d7cc-4ba3-b14a-e17425918a28",
      "tool-f54a2e42-49d9-4092-9341-20b6d8e4bd7b",
      "tool-5bf9de71-be58-428a-9ef8-f4fce684d666",
      "tool-3486f80d-f39f-457e-8d9d-befc10cbf3e1",
      "tool-da313af6-c059-4db3-a646-4e9b27d6eacd",
      "tool-c197145f-507c-4aae-81af-e27119417232",
      "tool-13153730-07a5-4d7b-9651-b175d79eda21",
      "tool-7c44bd0f-18b0-450f-bc52-c7f945cd204e",
    ],
    "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e": [
      "tool-cfba008b-0ca1-4891-bb50-2ff2b298643e",
      "tool-b667831f-fad2-48b4-9223-2b718f5c62c3",
      "tool-a5972a1e-2ada-49e4-9e1f-14e7f0c34d14",
      "tool-da313af6-c059-4db3-a646-4e9b27d6eacd",
      "tool-264d2494-0c0a-4d97-ab81-b5d514e8e397",
      "tool-cbf1b88b-24d7-4424-84e8-fc0098e88ccc",
      "tool-e16c8e3a-ce01-4590-913b-33c8729b87b8",
      "tool-115de5e8-a1a5-481d-b032-32b22d91daad",
      "tool-c197145f-507c-4aae-81af-e27119417232",
      "tool-e75a28e5-d995-4960-8f05-8da8b7aee7c4",
      "tool-13153730-07a5-4d7b-9651-b175d79eda21",
      "tool-7c44bd0f-18b0-450f-bc52-c7f945cd204e",
    ],
  };
  let incoming: any = {};
  try { incoming = await req.json(); } catch { incoming = {}; }
  if (incoming.restore === true) {
    const restored = [];
    for (const [id, toolIds] of Object.entries(restore)) {
      if (!toolIds.length) continue;
      const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ tool_ids: toolIds }),
      });
      const patchText = await res.text();
      restored.push({ id, status: res.status, body: patchText.slice(0, 400) });
    }
    return json({ restored });
  }
  const toolRes = await fetch("https://api.telnyx.com/v2/ai/tools", { headers });
  const toolPayload = await toolRes.json();
  const toolRows = Array.isArray(toolPayload?.data) ? toolPayload.data : [];
  const tools = toolRows.map((row: any) => ({
    id: row.id,
    name: row?.tool_definition?.name || row?.webhook?.name || row?.name || "",
  }));
  const assistants = [];
  for (const id of ASSISTANTS) {
    const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${id}`, { headers });
    const raw = await res.text();
    let payload: any = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    const obj = payload?.data?.id ? payload.data : payload;
    const kept = restore[id] || [];
    assistants.push({
      id,
      status: res.status,
      tool_ids: Array.isArray(obj?.tool_ids) ? obj.tool_ids.length : 0,
      kept_in_body: kept.filter((toolId) => raw.includes(toolId)).length,
      expected: kept.length,
      tools: Array.isArray(obj?.tools) ? obj.tools.map((tool: any) => tool.name || tool.id || tool.type) : [],
    });
  }
  return json({ tool_count: tools.length, tools, assistants });
});
