// ─── admin-chat-agent v2 ───────────────────────────────────────────────
//
// Field-aware extraction + autoApply + persist.
//
// Reads a GHL conversation, fetches the location's GHL custom-field
// schema, hands the transcript + the field schema to an LLM (Claude or
// OpenAI), and returns structured insights. When body.autoApply=true,
// it also pushes the extracted custom fields onto the contact via
// admin-ghl-update-contact. When body.persist !== false, it upserts the
// analysis into public.chat_insights so the autonomous pulse function can
// see what's been analyzed already.
//
// The agent does NOT invent tags. It used to be asked for free-text
// "tag_recommendations" and whatever it returned was applied, which is how the
// GHL account filled with one-off tags like "military-gift". It may now propose
// exactly one LEAD STAGE from the closed vocabulary in _shared/ghl-tags.ts;
// everything else it observes belongs in a custom field, which is filterable.
//
// Provider selection (in app_secrets first, env fallback):
//   - LLM_PROVIDER  : "anthropic" (default) | "openai"
//   - ANTHROPIC_API_KEY  /  OPENAI_API_KEY
//   - LLM_MODEL_ANTHROPIC (default: claude-sonnet-4-5)
//   - LLM_MODEL_OPENAI    (default: gpt-4o-mini)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { enforceTagPolicy, LEAD_STAGES, leadStageTag } from "../_shared/ghl-tags.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function resolveSecret(supabase: any, name: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") return data.value.trim();
  } catch {}
  return (Deno.env.get(name) || "").trim();
}

async function ghl(token: string, path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...((init.headers as Record<string, string> | undefined) || {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${GHL_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, body: json ?? text };
}

interface ChatMessage {
  ts: string;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
}

interface FieldDescriptor {
  fieldKey: string;
  bareKey: string;
  name: string;
  dataType: string; // NUMERICAL | TEXT | SINGLE_OPTIONS | MONETORY | ...
  picklistOptions?: string[];
}

let fieldCache: { fields: FieldDescriptor[]; map: Record<string, string> } | null = null;
async function loadGhlFieldSchema(ghlToken: string, locationId: string) {
  if (fieldCache) return fieldCache;
  const fields: FieldDescriptor[] = [];
  const map: Record<string, string> = {};
  try {
    const res = await ghl(ghlToken, `/locations/${encodeURIComponent(locationId)}/customFields`);
    if (res.ok) {
      const raw = ((res.body as any)?.customFields || []) as Array<any>;
      for (const f of raw) {
        if (!f.id) continue;
        const fieldKey = (f.fieldKey || f.key || "").toString();
        const bareKey = fieldKey.split(".").pop() || fieldKey;
        if (bareKey) map[bareKey] = f.id;
        if (fieldKey) map[fieldKey] = f.id;
        if (f.name) map[f.name] = f.id;
        fields.push({
          fieldKey,
          bareKey,
          name: f.name || bareKey,
          dataType: (f.dataType || "TEXT").toString().toUpperCase(),
          picklistOptions: Array.isArray(f.picklistOptions) ? f.picklistOptions : undefined,
        });
      }
    }
  } catch {}
  fieldCache = { fields, map };
  return fieldCache;
}

async function pullConversation(
  ghlToken: string,
  locationId: string,
  args: { contactId?: string; email?: string; phone?: string; conversationId?: string; limit: number },
) {
  let contactId = args.contactId || null;
  let contact: any = null;
  if (!contactId) {
    const q = (args.email || args.phone || "").trim();
    if (!q) {
      return { contactId: null, conversationId: null, messages: [] as ChatMessage[], contact: null, lastMessageDate: null as string | null };
    }
    const params = new URLSearchParams({ locationId, query: q });
    const search = await ghl(ghlToken, `/contacts/?${params.toString()}`);
    const contacts = ((search.body as any)?.contacts ?? []) as any[];
    const phoneDigits = (args.phone || "").replace(/\D/g, "").slice(-10);
    const emailLower = (args.email || "").toLowerCase();
    const matched = contacts.find((c) => {
      const cEmail = (c.email || "").toLowerCase();
      const cDigits = (c.phone || "").replace(/\D/g, "").slice(-10);
      return (emailLower && cEmail === emailLower) || (phoneDigits && cDigits === phoneDigits);
    }) || contacts[0];
    if (!matched) {
      return { contactId: null, conversationId: null, messages: [] as ChatMessage[], contact: null, lastMessageDate: null };
    }
    contactId = matched.id;
    contact = matched;
  } else {
    // contactId was passed directly (e.g. from chat-agent-pulse).
    // Fetch the full contact record so the persisted audit row has
    // name / email / phone — otherwise chat_insights ends up with
    // anonymous entries and downstream filtering / dashboards break.
    try {
      const cRes = await ghl(ghlToken, `/contacts/${encodeURIComponent(contactId)}`);
      if (cRes.ok) {
        contact = (cRes.body as any)?.contact ?? cRes.body ?? null;
      }
    } catch { /* ignore */ }
  }
  let conversationId = args.conversationId || null;
  let lastMessageDate: string | null = null;
  if (!conversationId) {
    const convoRes = await ghl(
      ghlToken,
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId!)}&limit=5`,
    );
    const convos = ((convoRes.body as any)?.conversations ?? []) as any[];
    if (convos.length === 0) {
      return { contactId, conversationId: null, messages: [] as ChatMessage[], contact, lastMessageDate: null };
    }
    conversationId = convos[0].id;
    const lmd = convos[0].lastMessageDate;
    lastMessageDate = typeof lmd === "number" ? new Date(lmd).toISOString() : (lmd || null);
  }
  const msgRes = await ghl(
    ghlToken,
    `/conversations/${encodeURIComponent(conversationId!)}/messages?limit=${args.limit || 50}`,
  );
  const raw = (((msgRes.body as any)?.messages?.messages) ?? ((msgRes.body as any)?.messages) ?? []) as any[];
  const messages: ChatMessage[] = raw
    .map((m) => ({
      ts: m.dateAdded || m.createdAt || "",
      direction: ((m.direction || "outbound") as "inbound" | "outbound"),
      channel: ((m.messageType || "").toString().replace(/^TYPE_/, "").toUpperCase() || "SMS"),
      body: (m.body || "").toString(),
    }))
    .filter((m) => m.body.trim().length > 0)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  if (!lastMessageDate && messages.length) lastMessageDate = messages[messages.length - 1].ts;
  return { contactId, conversationId, messages, contact, lastMessageDate };
}

function buildSystemPrompt(fields: FieldDescriptor[]) {
  const fieldSchema = fields.map((f) => {
    const opts = f.picklistOptions && f.picklistOptions.length
      ? ` options=[${f.picklistOptions.slice(0, 12).join(" | ")}]`
      : "";
    return `  - ${f.bareKey}  (${f.name})  type=${f.dataType}${opts}`;
  }).join("\n");

  return `You are the chat-examination agent for NovaraCleaning, a residential cleaning company in the DMV. You read a customer SMS/email conversation and return STRUCTURED INSIGHTS as a single JSON object.

BRAND VOICE
- Warm, casual, founder-led (Malik). Short sentences. No corporate stiffness. Light emoji on rare occasions.

BUSINESS CONTEXT
- Plans: Standard / Deep (1.5x) / Move-In-Out (2x) / Combo Deep+Standard (2.5x) / Novara Glow membership (monthly | biweekly | weekly).
- Default deposit posture: 50% deposit on first invoice, remaining 50% pre-authorized as a Stripe hold a few days before service.
- Bi-weekly membership: full standard clean every 2 weeks, same cleaner, 2-3 laundry loads included, no contracts.
- First bi-weekly visit adds a one-time $75 Deep Clean baseline fee.
- Service area: Maryland, Washington DC, and Northern Virginia.
- Support: (844) 735-2070.

GHL CUSTOM FIELDS YOU CAN POPULATE
Only emit keys from this list. Use the exact bareKey shown. NUMERICAL fields take a string of digits. MONETORY fields take a raw number string (no $). SINGLE_OPTIONS fields MUST exactly match one of the listed options or be omitted. TEXT fields take any string.
${fieldSchema || "  (no fields available)"}

OUTPUT SCHEMA (single JSON object, no markdown)
{
  "summary": "1-2 sentence neutral state of conversation",
  "lead_temperature": "cold" | "warm" | "hot",
  "stage": "initial_contact" | "quote_requested" | "quote_given" | "considering" | "ready_to_book" | "booked" | "paid" | "service_scheduled" | "post_service" | "ghosted" | "complaint" | "support" | "other",
  "sentiment": "positive" | "neutral" | "negative",
  "key_facts": ["concrete facts spotted in the chat"],
  "open_questions_from_customer": ["customer questions NOT yet answered"],
  "blockers": ["anything stopping the deal from closing"],
  "recommended_next_action": {
    "type": "send_sms" | "send_email" | "create_invoice" | "call" | "wait" | "none",
    "urgency": "now" | "today" | "this_week" | "low",
    "rationale": "why this action"
  },
  "suggested_reply": {
    "channel": "sms" | "email",
    "draft": "ready-to-send message in Malik's voice",
    "tone_note": "1 short note about voice"
  },
  "red_flags": ["anything risky"],
  "upsell_opportunities": ["concrete add-ons that fit this lead"],
  "extracted_fields": {
    // bareKey -> string value extracted from the chat. Only include
    // fields where the customer EXPLICITLY mentioned the data point
    // (e.g. "650 sq ft" -> estimated_sqft: "650"). Do NOT invent.
  },
  "suggested_lead_stage": "one of: ${LEAD_STAGES.join(" | ")}"
}

HARD RULES
- Output MUST be valid JSON parseable with JSON.parse. No backticks, no comments.
- If a field has no data, return an empty string or empty array — never null.
- Never invent customer details. extracted_fields keys must come from explicit chat content.
- Do NOT invent tags. suggested_lead_stage must be EXACTLY one of the listed
  stages or an empty string. Anything descriptive about this customer belongs in
  extracted_fields, which is filterable and reportable — free-text tags are not.
- For SINGLE_OPTIONS fields, pick the option label that EXACTLY matches one in the schema or omit the key entirely.
- For MONETORY fields, use raw numeric strings ("82" not "$82.00").
- suggested_reply.draft must be the next message Malik should send.
- Keep suggested_reply.draft under 480 chars for SMS, 220 words for email.
- If the last message is OUTBOUND and the customer hasn't replied yet, recommended_next_action.type="wait" UNLESS overdue >24h.`;
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: `OpenAI ${res.status}: ${text.slice(0, 400)}` };
  let body: any = {};
  try { body = JSON.parse(text); } catch { return { ok: false as const, error: "OpenAI envelope not JSON" }; }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return { ok: false as const, error: "OpenAI returned no content" };
  let analysis: any = {};
  try { analysis = JSON.parse(content); }
  catch { return { ok: false as const, error: `OpenAI content not JSON: ${content.slice(0, 200)}` }; }
  return { ok: true as const, analysis };
}

async function callAnthropic(apiKey: string, model: string, system: string, user: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: `Anthropic ${res.status}: ${text.slice(0, 400)}` };
  let body: any = {};
  try { body = JSON.parse(text); } catch { return { ok: false as const, error: "Anthropic envelope not JSON" }; }
  const content = body?.content?.[0]?.text;
  if (!content) return { ok: false as const, error: "Anthropic returned no content" };
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let analysis: any = {};
  try { analysis = JSON.parse(cleaned); }
  catch { return { ok: false as const, error: `Anthropic content not JSON: ${cleaned.slice(0, 200)}` }; }
  return { ok: true as const, analysis };
}

function filterExtractedFields(
  extracted: Record<string, unknown> | undefined,
  schema: FieldDescriptor[],
) {
  if (!extracted || typeof extracted !== "object") return {};
  const byBare = new Map(schema.map((f) => [f.bareKey, f]));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (v === undefined || v === null || v === "") continue;
    const f = byBare.get(k) ||
      schema.find((d) => d.bareKey === k || d.fieldKey === k || d.name === k);
    if (!f) continue;
    const value = String(v).trim();
    if (!value) continue;
    if (f.dataType === "SINGLE_OPTIONS" && f.picklistOptions && f.picklistOptions.length) {
      const exact = f.picklistOptions.find((opt) => opt.toLowerCase() === value.toLowerCase());
      if (!exact) continue;
      out[f.bareKey] = exact;
    } else if (f.dataType === "NUMERICAL") {
      const n = value.replace(/[^0-9.\-]/g, "");
      if (n) out[f.bareKey] = n;
    } else if (f.dataType === "MONETORY") {
      const n = value.replace(/[^0-9.\-]/g, "");
      if (n) out[f.bareKey] = n;
    } else {
      out[f.bareKey] = value;
    }
  }
  return out;
}

async function applyToGhl(supabase: any, body: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
  fields: Record<string, string>;
  source: string;
}) {
  const r = await supabase.functions.invoke("admin-ghl-update-contact", {
    body: {
      email: body.email,
      phone: body.phone,
      firstName: body.firstName,
      lastName: body.lastName,
      source: body.source,
      tags: body.tags,
      customFieldsByKey: body.fields,
    },
  });
  return r;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const ghlToken = await resolveSecret(supabase, "GHL_PIT_TOKEN");
    const ghlLocationId = await resolveSecret(supabase, "GHL_LOCATION_ID");
    if (!ghlToken || !ghlLocationId) {
      return new Response(JSON.stringify({ ok: false, reason: "GHL credentials not configured" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const schema = await loadGhlFieldSchema(ghlToken, ghlLocationId);

    const pulled = await pullConversation(ghlToken, ghlLocationId, {
      contactId: body.contactId,
      email: body.email,
      phone: body.phone,
      conversationId: body.conversationId,
      limit: Number(body.limit) || 50,
    });
    const messages = pulled.messages;
    const contact = pulled.contact;
    const contactId = pulled.contactId;
    const conversationId = pulled.conversationId;
    if (!messages.length) {
      return new Response(JSON.stringify({
        ok: false,
        reason: "No messages found",
        contactId,
        conversationId,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const providerRaw = (await resolveSecret(supabase, "LLM_PROVIDER")).toLowerCase() || "openai";
    const provider = providerRaw === "anthropic" ? "anthropic" : "openai";
    const apiKey = await resolveSecret(
      supabase,
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
    );
    const model = (await resolveSecret(
      supabase,
      provider === "openai" ? "LLM_MODEL_OPENAI" : "LLM_MODEL_ANTHROPIC",
    )) || (provider === "openai" ? "gpt-4o-mini" : "claude-sonnet-4-5");
    if (!apiKey) {
      return new Response(JSON.stringify({
        ok: false,
        reason: `${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} not configured`,
        contactId,
        conversationId,
        message_count: messages.length,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const systemPrompt = buildSystemPrompt(schema.fields);
    const contactSummary = contact
      ? `Name: ${contact.contactName || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "(unknown)"}\nEmail: ${contact.email || "-"}\nPhone: ${contact.phone || "-"}`
      : "Name: (unknown)";
    const transcript = messages
      .map((m) => `[${m.ts || "-"}] ${m.direction === "inbound" ? "CUSTOMER" : "NOVARA"} (${m.channel}): ${m.body}`)
      .join("\n");
    const userPrompt = `CONTACT\n${contactSummary}\n\nTRANSCRIPT (oldest to newest)\n${transcript}\n\nReturn the JSON object now.`;

    const llm = provider === "anthropic"
      ? await callAnthropic(apiKey, model, systemPrompt, userPrompt)
      : await callOpenAI(apiKey, model, systemPrompt, userPrompt);
    if (!llm.ok) {
      return new Response(JSON.stringify({
        ok: false,
        reason: llm.error,
        contactId,
        conversationId,
        message_count: messages.length,
      }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const analysis = llm.analysis;
    const cleanFields = filterExtractedFields(analysis?.extracted_fields, schema.fields);

    // The agent no longer invents tags. It may propose ONE lead stage from the
    // closed vocabulary; anything else it suggests is dropped here, before it
    // can reach GHL. Free-text tags from a model are unbounded by construction,
    // and an unbounded tag list is a filter nobody can rely on.
    const suggestedStage = String(analysis?.suggested_lead_stage || "").trim().toLowerCase();
    const stageTag = (LEAD_STAGES as readonly string[]).includes(suggestedStage)
      ? leadStageTag(suggestedStage)
      : null;
    const tagRecs = enforceTagPolicy([
      stageTag,
      // Tolerate an older model response still returning the retired key so a
      // cached prompt can't crash the run — the policy discards it anyway.
      ...(Array.isArray(analysis?.tag_recommendations) ? analysis.tag_recommendations : []),
    ]).tags;

    let applyReport: any = null;
    if (body.autoApply && contact && (Object.keys(cleanFields).length > 0 || tagRecs.length > 0)) {
      try {
        const r = await applyToGhl(supabase, {
          email: contact.email,
          phone: contact.phone,
          firstName: contact.firstName || (contact.contactName || "").split(" ")[0],
          lastName: contact.lastName || (contact.contactName || "").split(" ").slice(1).join(" "),
          tags: tagRecs,
          fields: cleanFields,
          source: "chat-agent autoApply",
        });
        applyReport = r.error
          ? { error: r.error.message || String(r.error) }
          : (r.data ?? null);
      } catch (e) {
        applyReport = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (body.persist !== false && conversationId) {
      try {
        // Prefer the caller-supplied override (pulse passes the
        // conversation's lastMessageDate from GHL's conversation list)
        // so the next tick's idempotency comparison matches exactly.
        const lastTs = body.lastMessageDateOverride
          || pulled.lastMessageDate
          || messages[messages.length - 1]?.ts
          || null;
        await supabase.from("chat_insights").upsert({
          conversation_id: conversationId,
          contact_id: contactId,
          contact_email: contact?.email || null,
          contact_phone: contact?.phone || null,
          contact_name: contact?.contactName || `${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim() || null,
          last_analyzed_at: new Date().toISOString(),
          last_analyzed_message_ts: lastTs,
          message_count: messages.length,
          provider,
          model,
          lead_temperature: analysis?.lead_temperature || null,
          stage: analysis?.stage || null,
          sentiment: analysis?.sentiment || null,
          urgency: analysis?.recommended_next_action?.urgency || null,
          recommended_action_type: analysis?.recommended_next_action?.type || null,
          analysis,
          extracted_fields: cleanFields,
          applied_tags: tagRecs,
          ghl_fields_skipped: applyReport?.custom_fields_skipped ?? [],
          error_message: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "conversation_id" });
      } catch (e) {
        console.warn("persist failed", e instanceof Error ? e.message : String(e));
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      provider,
      model,
      contactId,
      conversationId,
      message_count: messages.length,
      contact: contact ? {
        id: contact.id,
        name: contact.contactName || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim(),
        email: contact.email,
        phone: contact.phone,
      } : null,
      analysis,
      extracted_fields: cleanFields,
      tag_recommendations: tagRecs,
      applied: Boolean(body.autoApply),
      apply_report: applyReport,
    }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
