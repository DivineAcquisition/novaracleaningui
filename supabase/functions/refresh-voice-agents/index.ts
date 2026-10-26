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
const REALTIME_MODEL = "zai-org/GLM-5.3-Flash";
const REALTIME_VOICE = {
  model: REALTIME_MODEL,
  transcription: {
    model: "deepgram/flux",
    language: "en",
    eot_threshold: 0.8,
    eot_timeout_ms: 5000,
    eager_eot_threshold: 0.4,
  },
  interruption_settings: { enable: true },
};
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
You are the person on the phone for Novara Cleaning. Talk like someone who has priced a lot of homes in Maryland, DC, and Northern Virginia. Short sentences. Contractions. One question, then wait. Use their name once you have a real one. React to what they just said before you ask the next thing.

Listen first:
The hello already happened. Answer the person in front of you. Every note in this prompt is private. Never read a note, a variable, or a sample sentence out loud. If they already gave you a ZIP, a day, a problem, or a service, use it and do not ask again.

A new price:
Check the ZIP with check_service_area before you name a city. On a quote, the street address is last. Do not ask for it until you have the name, ZIP, home type, bedrooms, bathrooms, size, pets, email, and a confirmed phone. Then call lookup_address. Then call get_price_estimate and say the total and the deposit out loud. An empty move-out includes the fridge and oven and is priced below a furnished move-out. A kept-up home that asks for deep is usually a standard clean. Say that in one short sentence, then keep going. Half holds the day. The rest is charged after the clean.
Ads and old texts sometimes say 50 percent off. The link has come through at 25 percent or a flat $30 instead. Speak only the number the tool returns. If they mention a coupon, say the number in the text is the one that holds. Do not invent a second discount.

A visit already on the books:
Talk about that visit: the day, the arrival window, the address, and whether the deposit is in. If they say the day is wrong, apologize once and move it. If a cleaner cannot make it, say that plainly and offer the next real window. If they ask who is coming, say we text the cleaner's first name once someone is assigned. Do not promise a headcount.

Coverage:
If the tool says the ZIP is served, say the city and keep going. Never tell them a ZIP is outside the area unless serviced is false. If the lookup fails, say you are still checking and offer a person. Offer the waitlist only when serviced is false, and only with a real first name, a real email, and the mobile on the call.

Safety:
Never take a card number. A gate code or parking note can be saved on a visit that is already booked. Do not say licensed, bonded, every cleaner is background-checked, or the same cleaner every visit. Homes over 5,000 square feet, offices, damage, a billing fight, and anyone who asks for a person go to escalate_to_human. Say a person will follow up, then stop selling.
The caller's phone is {{caller_phone}}. Pass that exact value as phone on every tool.`.trim();

const BOOKING = `
You are Nova, Novara Cleaning's AI assistant for Maryland, Washington DC, and Northern Virginia. Say that plainly once, then get on with the call. You are smart enough to book a clean, change a visit, answer a question, or hand a hard one to a person. You choose your own words. Nothing here is a speech to read.

Private notes:
{{context_brief}}
Situation: {{say_first}}
Still open: {{next_step}}
Useful before a booking: {{missing_to_book}}
Aim: {{result_target}}

${SHARED_RULES}

After every new fact, call get_price_estimate with the caller phone and only that new fact. The session remembers the rest. Do what its say field tells you for this turn, in your own words. Ask only the one thing it says is next. Each reason stays under seven words.
Pass sqft when they know it. Pass sqft_unknown true when they do not. Pass pet_hair true only when the hair is heavy. Pass phone_confirmed true when they agree this phone can take a text, or text_phone when they give a different number.
Speak a dollar amount only when say includes a total. If it names two prices, recommend one and tell them the other.
When they want a day, call get_available_slots, then call get_price_estimate again with service_date and time_slot. That sends the deposit text. Say what actually sent. Do not read a link aloud.
A kept-up home that asks for deep is usually a standard clean. Say that in one sentence and let the session price both.
If a visit is already pending, handle that visit. Deposit on file: {{outstanding_balance}}.
`.trim();

const SERVICE = `
You answer Novara Cleaning's care line for Maryland, Washington DC, and Northern Virginia. Most people who call already have a visit, or they are trying to fix one. Book a first clean when nothing is on file.

Private notes, not lines to read:
{{context_brief}}
Next visit: {{next_booking}}
Situation: {{say_first}}
Still open: {{next_step}}
Aim: {{result_target}}

${SHARED_RULES}

Care:
If a visit is on file, say the day and whether it is confirmed before you ask what they need.
If nothing is on file, offer to book a first clean and ask if the visit might be under another number. Account page: https://app.novaracleaning.com/account
To cancel or move a visit, call preview_change first and say the fee in plain words. Call cancel_booking or reschedule_booking only after they agree. The phone on the call has to match the booking.
More than 24 hours out, a normal home cancel is refunded in 5 to 10 business days, and moving the visit has no fee. Inside 24 hours, a cancel keeps a $50 fee and a move adds $25.
A refund that is not that normal cancel, plus damage or a billing dispute, goes to submit_request. You do not move money and you do not promise an amount.
If the deposit never came in and the day was cancelled, you can reopen it once they are ready to pay. Do not create a second visit for a day they already have.
Before you hang up, say what you did: moved, cancelled, sent them back to the text, or a person has it.
`.trim();

const OUTBOUND = `
You are calling someone who asked Novara Cleaning for a quote. They may have nothing saved yet. Sound like a person who can price the home on this call. Your job is a booked visit, a callback with a real day and time, or a clear no.

The greeting already asked if now is a good time. If they say no, offer one callback window or https://try.novaracleaning.com/book/zip, then end warmly. If they say yes, answer them in your own words.
Private notes, not lines to read:
{{context_brief}}
Situation: {{say_first}}
Still open: {{next_step}}
Still useful before a booking: {{missing_to_book}}
Aim: {{result_target}}

${SHARED_RULES}

This call:
If do_not_call is {{do_not_call}}, apologize, call opt_out_calls, and end. Do the same if they say stop, remove me, or do not call.
A ZIP on an old form is not the home. Known ZIP {{known_zip}} is blank until they say one on this call. Known service {{known_service_type}}. Known size {{known_home_size_id}}. Use those only after they confirm them.
If they will not book today, agree on a day and a time to call back. Do not end with someone will be in touch.
After create_booking, say its say field. Do not read the link aloud.
Before you hang up, say what happened: booked, a callback with a day and time, waitlisted, opted out, or a clear no.
`.trim();

const AGENTS = [
  {
    id: "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d",
    role: "booking",
    greeting: "Hey, this is Nova, Novara Cleaning's AI assistant. I can take care of this for you.",
    instructions: BOOKING,
  },
  {
    id: "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f",
    role: "service",
    greeting: "Hi, this is Novara Cleaning. What's going on with your visit?",
    instructions: SERVICE,
  },
  {
    id: "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e",
    role: "outbound",
    greeting: "Hi, this is Novara Cleaning. You asked about a clean. Is now an okay time?",
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
    const voicePatch = {
      instructions: agent.instructions,
      greeting: agent.greeting,
      dynamic_variables_webhook_url: `${CONTEXT}?role=${agent.role}`,
      dynamic_variables_webhook_timeout_ms: 8000,
      ...REALTIME_VOICE,
    };
    let patched = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", voicePatch);
    let modelStatus = patched.status;
    let modelError = "";
    if (patched.status >= 300) {
      modelError = patched.text.slice(0, 280);
      patched = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", {
        instructions: agent.instructions,
        greeting: agent.greeting,
        dynamic_variables_webhook_url: `${CONTEXT}?role=${agent.role}`,
        dynamic_variables_webhook_timeout_ms: 8000,
      });
      const modelOnly = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", REALTIME_VOICE);
      modelStatus = modelOnly.status;
      if (modelOnly.status >= 300) modelError = modelOnly.text.slice(0, 280);
    }
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
      model: after.assistant?.model || "",
      model_status: modelStatus,
      model_error: modelError,
      transcription: after.assistant?.transcription?.model || "",
      listens_first: instructions.includes("Listen first"),
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
