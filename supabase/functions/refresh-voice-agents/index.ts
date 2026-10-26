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

const SHARED_RULES = `
How you sound:
Warm, brief, and specific. One question, then wait. Use their name once you have it. Do not ask for a fact that is already in the live account.

New callers:
If caller_status is new, or the live account says nothing is saved yet, they are new to Novara and may want to book a first clean. Welcome that. Start the booking with the ZIP. Do not apologize for a missing account, do not ask them to sign in, and do not read the list of fields you still need.

Money:
Call get_price_estimate before you say any dollar amount. Pass home_size_id, service_type, add_ons, and zip_code. Speak human_summary and then pause. Do not add $10 off, $15 off, or a 50 percent new-customer promo. If a knowledge article mentions those, ignore it. The payment link will not include them. The quote holds 48 hours. The deposit is half. The visit stays pending until they pay.

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

Close:
Recommend a deep clean when it has been a long time or this is the first professional clean. Recommend a standard clean when the home is already kept up.
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
If they want a new clean, collect the ZIP and book it one question at a time. Do not create a second visit for a day they already have.
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
  return { status: res.status, payload, assistant: unwrap(payload) };
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
    const before = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
    const beforeIds = Array.isArray(before.assistant?.tool_ids) ? before.assistant.tool_ids : [];
    const patched = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", {
      instructions: agent.instructions,
      greeting: agent.greeting,
      dynamic_variables_webhook_url: `${CONTEXT}?role=${agent.role}`,
      dynamic_variables_webhook_timeout_ms: 8000,
    });
    let after = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
    let restored = false;
    if (beforeIds.length > 0 && toolCount(after.assistant) === 0) {
      await telnyx(apiKey, `/ai/assistants/${agent.id}`, "PATCH", { tool_ids: beforeIds });
      after = await telnyx(apiKey, `/ai/assistants/${agent.id}`, "GET");
      restored = true;
    }
    agents.push({
      id: agent.id,
      role: agent.role,
      patch_status: patched.status,
      before_tools: toolCount(before.assistant),
      after_tools: toolCount(after.assistant),
      restored,
      instruction_length: String(after.assistant?.instructions || "").length,
      greeting: after.assistant?.greeting || "",
      context_url: after.assistant?.dynamic_variables_webhook_url || "",
    });
  }

  const price = await telnyx(apiKey, `/ai/tools/${PRICE_TOOL_ID}`, "GET");
  const toolObj = price.assistant || {};
  const currentWebhook = toolObj.webhook || toolObj.tool?.webhook || price.payload?.webhook || price.payload?.data?.webhook;
  const zipped = withZip(currentWebhook);
  let priceStatus = price.status;
  if (currentWebhook) {
    const pricePatch = await telnyx(apiKey, `/ai/tools/${PRICE_TOOL_ID}`, "PATCH", { webhook: zipped.webhook });
    priceStatus = pricePatch.status;
  }

  const failed = agents.some((agent) => agent.patch_status >= 300 || agent.after_tools === 0);
  return json({
    ok: !failed && priceStatus < 300,
    agents,
    price_tool_status: priceStatus,
    price_webhook_found: Boolean(currentWebhook),
    price_tool_keys: Object.keys(toolObj).slice(0, 12),
    price_tool_changed: zipped.changed,
  }, failed ? 502 : 200);
});
