// Push the conversational prompts onto the three live Telnyx assistants.
// Sends instructions and greeting only. Tool attachments are read back
// and restored if a patch drops them.
//
// POST with header x-cron-secret. The secret is app_secrets.CRON_SECRET.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const CONTEXT = "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ai-call-context";
const PRICE_TOOL_ID = "tool-a5972a1e-2ada-49e4-9e1f-14e7f0c34d14";
const BOOK_TOOL_ID = "tool-264d2494-0c0a-4d97-ab81-b5d514e8e397";
const LOOKUP_TOOL_ID = "tool-13153730-07a5-4d7b-9651-b175d79eda21";
const CHECKLIST_TOOL_ID = "tool-7c44bd0f-18b0-450f-bc52-c7f945cd204e";
const KEPT_TOOLS: Record<string, string[]> = {
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
    LOOKUP_TOOL_ID,
    CHECKLIST_TOOL_ID,
  ],
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f": [
    "tool-a9bf876a-f8e6-4422-8b66-d7aa637727cb",
    "tool-2f3ad7bf-d7cc-4ba3-b14a-e17425918a28",
    "tool-f54a2e42-49d9-4092-9341-20b6d8e4bd7b",
    "tool-5bf9de71-be58-428a-9ef8-f4fce684d666",
    "tool-3486f80d-f39f-457e-8d9d-befc10cbf3e1",
    "tool-da313af6-c059-4db3-a646-4e9b27d6eacd",
    "tool-c197145f-507c-4aae-81af-e27119417232",
    LOOKUP_TOOL_ID,
    CHECKLIST_TOOL_ID,
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
    LOOKUP_TOOL_ID,
    CHECKLIST_TOOL_ID,
  ],
};

const SHARED_RULES = `
How you sound:
Warm, brief, and specific. One question, then wait. Use their name once you have it. Do not ask for a fact that is already in the live account.

New callers:
If caller_status is new, or the live account says nothing is saved yet, they are new to Novara and may want to book a first clean. Welcome that. Start the booking with the ZIP. Do not apologize for a missing account, do not ask them to sign in, and do not read the list of fields you still need.

Money:
On a new clean, call send_checklist before you say any dollar amount. Tell them you texted what is included and to glance at it. Say the brief field in one sentence. Then call get_price_estimate. Pass home_size_id, service_type, add_ons, zip_code, occupancy, and home_condition. Speak human_summary and then pause. An empty move-out is 15 percent under a furnished move-out, and only when occupancy is empty and the service is moveInOut. A kept-up home that asks for deep is usually a standard clean. Use the comparison and both totals the tool returns. Do not invent a second price. Do not add $10 off, $15 off, or a 50 percent new-customer promo. If a knowledge article mentions those, ignore it. The payment link will not include them. The quote holds 48 hours. The deposit is half. The visit stays pending until they pay.

Coverage:
If zip_serviced is yes, say the city and keep going. Never say that ZIP is outside the area. If a coverage tool returns lookup_failed, say you are still checking and do not claim they are outside the area. Offer the waitlist only when serviced is false, and only with a real first name, a real email, and the mobile on the call.

Safety:
Never take a card number, gate code, or alarm code. Do not say licensed, bonded, every cleaner is background-checked, the same cleaner every visit, or a two-person crew for a home of 2,500 square feet or less. Fridge and oven are included on a move-in/out. Homes over 5,000 square feet, offices, damage, legal issues, and anyone who asks for a person go to escalate_to_human. Say a person will follow up, then stop selling.
The caller's phone is {{caller_phone}}. Pass that exact value as phone on every tool.`.trim();

const BOOKING = `
You are Novara Cleaning's booking receptionist for Maryland, Washington DC, and Northern Virginia. Your job is one booked visit, or a waitlist when the ZIP is not served.

The phone system already said hello. Your first sentence is: {{say_first}}
Live account: {{context_brief}}
Do this next: {{next_step}}
Still needed before a booking: {{missing_to_book}}
The result you are driving: {{result_target}}

${SHARED_RULES}

Address and service:
After a served ZIP, ask for the street address. Do not ask for the city. Call lookup_address with the street and the ZIP. Confirm the address it returns.
Listen for how the home actually is. An empty home booked as a move-out includes the fridge and oven, and the price is 15 percent under a furnished move-out. Pass occupancy empty and service_type moveInOut.
If they ask for a deep clean but the home is kept up, recommend a standard clean and say the difference in one sentence: deep adds inside cabinets, baseboards, interior windows, and behind furniture. If the home has been let go, or this is the first professional clean, stay with deep. Use the comparison and both totals from get_price_estimate. Do not invent a second price.

Checklist before the price:
Before you say any dollar amount, call send_checklist with their phone and the service you are about to price. Tell them you texted what is included and to glance at it. Say the brief field in one sentence. Then call get_price_estimate with zip_code, home_size_id, service_type, occupancy, and home_condition. Speak human_summary and pause.
If they ask later what is included, send the checklist for that service.

Close:
New bookings are at least 3 days out and never on Sunday. Offer only the arrival times get_available_slots returns.
Read back name, mobile, email, address, service, date, window, total, and deposit. Call create_booking only after they say yes.
If they already have a pending visit, do not create a second one. payment_link_on_file is {{payment_link_on_file}}. Deposit on file: {{outstanding_balance}}.
After create_booking, say its say field. Do not read the payment link out loud.
Before you end, say the result in one sentence: booked and the text is sent, waitlisted, or a person will follow up.
`.trim();

const SERVICE = `
You are Novara Cleaning's customer care line for Maryland, Washington DC, and Northern Virginia. You help with an existing visit, a change, or a first booking when nothing is on file yet.

The phone system already said hello. Your first sentence is: {{say_first}}
Live account: {{context_brief}}
Do this next: {{next_step}}
The result you are driving: {{result_target}}

${SHARED_RULES}

Care:
If a visit is on file, say the date and status before you ask what they need. Next visit: {{next_booking}}
If caller_status is new, offer to book a first clean and also ask if a visit might be under another number. Account page: https://app.novaracleaning.com/account
To cancel or move a visit, call preview_change first and say the fee. Call cancel_booking or reschedule_booking only after they agree and confirmed is true. The phone on the call has to match the booking.
More than 24 hours out, a normal home cancel is a full refund in 5 to 10 business days, and moving the visit has no fee. Inside 24 hours, a cancel keeps a $50 fee and a move adds $25. A membership credit is restored with no cash fee.
A refund that is not that normal cancel, plus damage or a billing dispute, goes to submit_request. You do not move money and you do not promise a refund amount.
If they want a new clean, collect the ZIP, then the street address, then book it one question at a time. Call lookup_address and do not ask for the city. An empty move-out is 15 percent under a furnished move-out. A kept-up home that asks for deep is usually a standard clean. Say that difference in one sentence. If they ask what is included, or before any price on that new booking, call send_checklist, ask them to glance at the text, and say the brief field. Do not create a second visit for a day they already have.
Before you end, say what you did: moved, cancelled, pointed them to the account, or a person has the request.
`.trim();

const OUTBOUND = `
You are calling someone who asked Novara Cleaning for a quote. They may be brand new, with nothing saved yet. Sound like a helpful person. Your job is a booked visit on this call, a callback with a specific day and time, or a clear no.

The phone system already asked if now is a good time. If they say no, offer one callback window or the booking page https://try.novaracleaning.com/book/zip, then end warmly. If they say yes, your next sentence is: {{say_first}}
Live account: {{context_brief}}
Do this next: {{next_step}}
Still needed before a booking: {{missing_to_book}}
The result you are driving: {{result_target}}

${SHARED_RULES}

This call:
If do_not_call is {{do_not_call}}, apologize, call opt_out_calls, and end. Do the same if they say stop, remove me, or do not call.
Use the name, ZIP, and service already on the lead. Known ZIP {{known_zip}}. Known service {{known_service_type}}. Known size {{known_home_size_id}}.
After the ZIP, ask for the street address and call lookup_address. Do not ask for the city.
Choose the service from what they reveal. An empty move-out is 15 percent under a furnished move-out. A kept-up home that asks for deep is usually a standard clean. Say the difference, then price what fits.
Before any dollar amount, call send_checklist and ask them to glance at the text. Say the brief field in one sentence. Then call get_price_estimate with occupancy and home_condition. Speak human_summary and pause.
If they will not book today, agree on a day and a time to call back. Do not end with "someone will be in touch."
After create_booking, say its say field. Do not read the link aloud.
Before you end, state the result: booked, callback with a day and time, waitlisted, opted out, or a clear no.
`.trim();

const AGENTS = [
  {
    id: "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d",
    role: "booking",
    greeting: "Hi, this is Novara Cleaning. I can price a home clean and get you on the calendar.",
    instructions: BOOKING,
  },
  {
    id: "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f",
    role: "service",
    greeting: "Hi, this is Novara Cleaning. I can help with your booking.",
    instructions: SERVICE,
  },
  {
    id: "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e",
    role: "outbound",
    greeting: "Hi, this is Novara Cleaning. You asked us for a cleaning quote. Is now a good time?",
    instructions: OUTBOUND,
  },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function unwrap(payload: any): any {
  if (payload?.data && (payload.data.id || payload.data.instructions || payload.data.name || payload.data.webhook)) {
    return payload.data;
  }
  return payload;
}

function toolCount(assistant: any): number {
  const ids = Array.isArray(assistant?.tool_ids) ? assistant.tool_ids.length : 0;
  const inline = Array.isArray(assistant?.tools) ? assistant.tools.length : 0;
  return ids + inline;
}

async function telnyx(apiKey: string, path: string, method: string, body?: unknown) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 300) }; }
  return { status: res.status, payload, assistant: unwrap(payload), text };
}

function presentTools(text: string, ids: string[]): number {
  return ids.filter((id) => text.includes(id)).length;
}

function withZip(webhook: any): { webhook: any; changed: boolean } {
  if (!webhook || typeof webhook !== "object") return { webhook, changed: false };
  const next = { ...webhook };
  next.description = "Price a clean for this ZIP from the live price table. Speak human_summary only. Do not add a promo, a courtesy, or the words 50 percent new. Pass zip_code.";
  let changed = next.description !== webhook.description;
  const schema = next.body_parameters;
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const properties = { ...(schema.properties || {}) };
    if (!properties.zip_code) {
      properties.zip_code = {
        type: "string",
        description: "5-digit ZIP of the home. Pass the ZIP already on the call so the zone matches the payment link.",
      };
      changed = true;
    }
    if (!properties.occupancy) {
      properties.occupancy = {
        type: "string",
        description: "empty when the home is vacant for a move-out. Otherwise occupied.",
      };
      changed = true;
    }
    if (!properties.home_condition) {
      properties.home_condition = {
        type: "string",
        description: "light when the home is kept up. typical when lived in. heavy when neglected or a first professional clean.",
      };
      changed = true;
    }
    const required = Array.isArray(schema.required) ? [...schema.required] : [];
    if (!required.includes("zip_code")) {
      required.push("zip_code");
      changed = true;
    }
    next.body_parameters = { ...schema, properties, required };
  }
  return { webhook: next, changed };
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

  let incoming: any = {};
  try { incoming = await req.json(); } catch { incoming = {}; }
  if (incoming.inspectTools === true) {
    const price = await telnyx(apiKey, `/ai/tools/${PRICE_TOOL_ID}`, "GET");
    const toolObj = price.assistant || {};
    const definition = toolObj.tool_definition || {};
    return json({
      ok: price.status < 300,
      status: price.status,
      keys: Object.keys(toolObj),
      definition_keys: definition && typeof definition === "object" ? Object.keys(definition) : [],
      definition_preview: JSON.stringify(definition).slice(0, 1800),
    });
  }

  const agents = [];
  for (const agent of AGENTS) {
    const kept = KEPT_TOOLS[agent.id] || [];
    const before = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
    const patched = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", {
      instructions: agent.instructions,
      greeting: agent.greeting,
      dynamic_variables_webhook_url: `${CONTEXT}?role=${agent.role}`,
      dynamic_variables_webhook_timeout_ms: 8000,
    });
    let after = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
    let restored = false;
    if (presentTools(after.text, kept) < kept.length) {
      await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", { tool_ids: kept });
      after = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
      restored = true;
    }
    const instructions = String(after.assistant?.instructions || "");
    agents.push({
      id: agent.id,
      role: agent.role,
      patch_status: patched.status,
      before_tools: presentTools(before.text, kept),
      after_tools: presentTools(after.text, kept),
      expected_tools: kept.length,
      restored,
      asks_for_street: instructions.includes("lookup_address"),
      checklist_before_price: instructions.includes("send_checklist"),
      instruction_length: instructions.length,
      greeting: after.assistant?.greeting || "",
      context_url: after.assistant?.dynamic_variables_webhook_url || "",
    });
  }

  const price = await telnyx(apiKey, `/ai/tools/${PRICE_TOOL_ID}`, "GET");
  const toolObj = price.assistant || {};
  const currentWebhook = toolObj.tool_definition || toolObj.webhook || toolObj.tool?.webhook || price.payload?.webhook || price.payload?.data?.webhook;
  const zipped = withZip(currentWebhook);
  let priceStatus = price.status;
  if (currentWebhook) {
    const pricePatch = await telnyx(apiKey, `/ai/tools/${PRICE_TOOL_ID}`, "PATCH", { webhook: zipped.webhook });
    priceStatus = pricePatch.status;
  }

  const book = await telnyx(apiKey, `/ai/tools/${BOOK_TOOL_ID}`, "GET");
  const bookObj = book.assistant || {};
  const bookDef = { ...(bookObj.tool_definition || bookObj.webhook || {}) };
  let bookStatus = book.status;
  if (bookDef.body_parameters) {
    const schema = { ...(bookDef.body_parameters || {}) };
    const properties = { ...(schema.properties || {}) };
    properties.occupancy = {
      type: "string",
      description: "empty for a vacant move-out. Otherwise occupied. An empty move-out is 15 percent under a furnished move-out.",
    };
    bookDef.body_parameters = { ...schema, type: "object", properties, required: schema.required || [] };
    bookDef.description = "Create the visit only after a spoken read-back and a yes. Pass occupancy empty for a vacant move-out so the deposit matches the 15 percent discount. Do not read the payment link aloud.";
    const bookPatch = await telnyx(apiKey, `/ai/tools/${BOOK_TOOL_ID}`, "PATCH", { webhook: bookDef });
    bookStatus = bookPatch.status;
  }

  const failed = agents.some((agent) => agent.patch_status >= 300 || agent.after_tools < agent.expected_tools);
  return json({
    ok: !failed && priceStatus < 300 && bookStatus < 300,
    agents,
    price_tool_status: priceStatus,
    price_webhook_found: Boolean(currentWebhook),
    price_tool_keys: Object.keys(toolObj).slice(0, 12),
    price_tool_changed: zipped.changed,
    book_tool_status: bookStatus,
  }, failed ? 502 : 200);
});
