// ─── admin-chat-agent ──────────────────────────────────────────────────
//
// "Chat-examination" agent protocol for the Novara internal team.
// Given a customer's email / phone / GHL contact id, it:
//
//   1. Pulls the most-recent N messages of that contact's GHL
//      conversation (SMS + email + inbound voicemail transcripts).
//   2. Hands the transcript to an LLM with a strict system prompt
//      that constrains the output to a single JSON object.
//   3. Returns structured insights the admin UI can render directly:
//        • summary, lead temperature, stage, sentiment
//        • key facts (price, address, household size, etc.)
//        • open customer questions the team owes a reply to
//        • blockers
//        • recommended next action (with urgency + rationale)
//        • a brand-voiced draft reply ready to send
//        • red flags and upsell opportunities
//
// The output schema is intentionally stable so the admin UI can render
// it as cards without re-prompting, and so cron jobs can act on
// "urgency=now" rows automatically later.
//
// Provider selection:
//   - LLM_PROVIDER  in app_secrets / env: "openai" (default) | "anthropic"
//   - OPENAI_API_KEY or ANTHROPIC_API_KEY in app_secrets / env
//   - Model overrides:  LLM_MODEL_OPENAI / LLM_MODEL_ANTHROPIC
//
// The function never throws — when an API key is missing or the LLM
// call fails, it returns a graceful { ok: false, reason } so the
// caller can show "Set OPENAI_API_KEY to enable AI insights".

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
    if (data?.value && typeof data.value === "string") {
      return data.value.trim();
    }
  } catch {
    /* ignore */
  }
  return (Deno.env.get(name) || "").trim();
}

async function ghlFetch(token: string, path: string) {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, body: text };
  }
}

interface ChatMessage {
  ts: string;
  direction: "inbound" | "outbound";
  channel: string; // SMS | EMAIL | etc.
  body: string;
}

async function pullConversation(
  ghlToken: string,
  ghlLocationId: string,
  args: { contactId?: string; email?: string; phone?: string; limit: number },
): Promise<{
  contactId: string | null;
  conversationId: string | null;
  messages: ChatMessage[];
  contact: any;
  raw?: unknown;
}> {
  let contactId = args.contactId || null;
  let contact: any = null;

  // Resolve contact via search if not given.
  if (!contactId) {
    const q = (args.email || args.phone || "").trim();
    if (!q) {
      return { contactId: null, conversationId: null, messages: [], contact: null };
    }
    const params = new URLSearchParams({ locationId: ghlLocationId, query: q });
    const search = await ghlFetch(ghlToken, `/contacts/?${params.toString()}`);
    if (!search.ok) {
      return {
        contactId: null,
        conversationId: null,
        messages: [],
        contact: null,
        raw: { stage: "contact_search", ...search },
      };
    }
    const contacts = (search.body?.contacts ?? []) as any[];
    const phoneDigits = (args.phone || "").replace(/\D/g, "").slice(-10);
    const emailLower = (args.email || "").toLowerCase();
    const matched =
      contacts.find((c) => {
        const cEmail = (c.email || "").toLowerCase();
        const cDigits = (c.phone || "").replace(/\D/g, "").slice(-10);
        return (
          (emailLower && cEmail === emailLower) ||
          (phoneDigits && cDigits === phoneDigits)
        );
      }) || contacts[0];
    if (!matched) {
      return { contactId: null, conversationId: null, messages: [], contact: null };
    }
    contactId = matched.id;
    contact = matched;
  }

  if (!contactId) {
    return { contactId: null, conversationId: null, messages: [], contact: null };
  }

  // Latest conversation for this contact.
  const convoRes = await ghlFetch(
    ghlToken,
    `/conversations/search?locationId=${encodeURIComponent(
      ghlLocationId,
    )}&contactId=${encodeURIComponent(contactId)}&limit=5`,
  );
  if (!convoRes.ok) {
    return {
      contactId,
      conversationId: null,
      messages: [],
      contact,
      raw: { stage: "convo_search", ...convoRes },
    };
  }
  const convos = (convoRes.body?.conversations ?? []) as any[];
  if (convos.length === 0) {
    return { contactId, conversationId: null, messages: [], contact };
  }
  const convo = convos[0];

  // Pull messages (newest first per GHL, normalize to oldest-first below).
  const msgRes = await ghlFetch(
    ghlToken,
    `/conversations/${encodeURIComponent(convo.id)}/messages?limit=${args.limit || 50}`,
  );
  const raw =
    (msgRes.body?.messages?.messages ?? msgRes.body?.messages ?? []) as any[];
  const messages: ChatMessage[] = raw
    .map((m) => ({
      ts: m.dateAdded || m.createdAt || "",
      direction: (m.direction || "outbound") as "inbound" | "outbound",
      channel:
        (m.messageType || "")
          .toString()
          .replace(/^TYPE_/, "")
          .toUpperCase() || "SMS",
      body: (m.body || "").toString(),
    }))
    .filter((m) => m.body.trim().length > 0)
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));

  return { contactId, conversationId: convo.id, messages, contact };
}

// ─── LLM call (OpenAI Chat Completions / Anthropic Messages) ───────────

const SYSTEM_PROMPT = `You are the chat-examination agent for NovaraCleaning — a residential cleaning company. You ANALYZE a customer conversation and return structured insights for the founder Malik and his VAs.

CONTEXT YOU MUST KNOW
- Brand voice: warm, casual, founder-led, no corporate stiffness. Short sentences. Light emoji on rare occasions.
- Plans: One-time Standard ($), Deep ($1.5×), Move-In/Out ($2×), Combo (Deep+Standard $2.5×), or Novara Glow membership (monthly/biweekly/weekly).
- Default deposit posture: 50% deposit on first invoice, remaining 50% pre-authorized as a Stripe hold a few days before service, captured on completion.
- Bi-weekly membership covers a full standard clean every 2 weeks with the same cleaner, 2–3 laundry loads included, no contracts.
- First bi-weekly visit adds a one-time $75 Deep Clean baseline fee.
- Service area: DMV / Maryland focus. ZIP-based pricing zones A/B/C.
- Support phone for fallback: (844) 735-2070.

YOUR JOB
Read the conversation transcript and produce a single JSON object exactly matching the schema below. NO prose, NO markdown, NO code fences — pure JSON.

SCHEMA
{
  "summary": "1-2 sentence neutral summary of where this conversation stands right now.",
  "lead_temperature": "cold" | "warm" | "hot",
  "stage": "initial_contact" | "quote_requested" | "quote_given" | "considering" | "ready_to_book" | "booked" | "paid" | "service_scheduled" | "post_service" | "ghosted" | "complaint" | "support" | "other",
  "sentiment": "positive" | "neutral" | "negative",
  "key_facts": [ "concrete fact extracted from the chat (zip code, square footage, household size, budget, gift recipient, etc.)" ],
  "open_questions_from_customer": [ "verbatim or paraphrased customer questions that have NOT been answered yet" ],
  "blockers": [ "anything stopping the deal from closing (missing email, undecided cadence, price objection, etc.)" ],
  "recommended_next_action": {
    "type": "send_sms" | "send_email" | "create_invoice" | "call" | "wait" | "none",
    "urgency": "now" | "today" | "this_week" | "low",
    "rationale": "why this action, in one sentence"
  },
  "suggested_reply": {
    "channel": "sms" | "email",
    "draft": "ready-to-send message in Malik's voice, never robotic",
    "tone_note": "1 short note about voice, e.g. 'casual founder tone, no hedging'"
  },
  "red_flags": [ "anything risky — angry tone, refund threat, fraud signal, etc." ],
  "upsell_opportunities": [ "concrete add-ons that fit this lead (laundry, deep clean, biweekly upgrade, etc.)" ]
}

HARD RULES
- Output MUST be valid JSON parseable with JSON.parse. No backticks, no comments, no trailing commas.
- If a field has no data, return an empty string or empty array — never null.
- Never invent customer details. Only use what's in the transcript or the public context above.
- "suggested_reply.draft" must be the next message Malik should send — not a meta-description.
- Keep "suggested_reply.draft" under 480 chars for SMS, under 220 words for email.
- If the customer is angry or asks for a refund, set lead_temperature to "cold" only if they have abandoned; otherwise reflect actual signal.
- If the last message is from the OUTBOUND team and the customer hasn't replied yet, "recommended_next_action.type" = "wait" UNLESS the customer is overdue (>24h).`;

async function callOpenAI(
  apiKey: string,
  model: string,
  transcript: string,
  contactSummary: string,
): Promise<{ ok: true; analysis: any; raw?: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `CONTACT\n${contactSummary}\n\nTRANSCRIPT (oldest → newest)\n${transcript}\n\nReturn the JSON object now.`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `OpenAI ${res.status}: ${text.slice(0, 400)}` };
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "OpenAI returned non-JSON envelope" };
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return { ok: false, error: "OpenAI returned no content" };
  let analysis: any = {};
  try {
    analysis = JSON.parse(content);
  } catch {
    return { ok: false, error: `OpenAI returned non-JSON content: ${content.slice(0, 200)}` };
  }
  return { ok: true, analysis, raw: content };
}

async function callAnthropic(
  apiKey: string,
  model: string,
  transcript: string,
  contactSummary: string,
): Promise<{ ok: true; analysis: any; raw?: string } | { ok: false; error: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `CONTACT\n${contactSummary}\n\nTRANSCRIPT (oldest → newest)\n${transcript}\n\nReturn the JSON object now, no markdown.`,
        },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Anthropic ${res.status}: ${text.slice(0, 400)}` };
  }
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, error: "Anthropic returned non-JSON envelope" };
  }
  const content = body?.content?.[0]?.text;
  if (!content) return { ok: false, error: "Anthropic returned no content" };
  // Anthropic sometimes wraps in ```json — strip that defensively.
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let analysis: any = {};
  try {
    analysis = JSON.parse(cleaned);
  } catch {
    return {
      ok: false,
      error: `Anthropic returned non-JSON content: ${cleaned.slice(0, 200)}`,
    };
  }
  return { ok: true, analysis, raw: cleaned };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ── 1. Pull conversation from GHL (unless caller passed messages) ──
    let messages: ChatMessage[] = Array.isArray(body.messages)
      ? body.messages
      : [];
    let contact: any = body.contact || null;
    let contactId: string | null = body.contactId || null;
    let conversationId: string | null = null;

    if (messages.length === 0) {
      const ghlToken = await resolveSecret(supabase, "GHL_PIT_TOKEN");
      const ghlLocationId = await resolveSecret(supabase, "GHL_LOCATION_ID");
      if (!ghlToken || !ghlLocationId) {
        return new Response(
          JSON.stringify({
            ok: false,
            reason:
              "GHL_PIT_TOKEN and GHL_LOCATION_ID must be set in app_secrets or env for GHL pull. Or pass `messages: [...]` directly.",
          }),
          {
            status: 500,
            headers: { ...cors, "Content-Type": "application/json" },
          },
        );
      }
      const pulled = await pullConversation(ghlToken, ghlLocationId, {
        contactId: body.contactId,
        email: body.email,
        phone: body.phone,
        limit: Number(body.limit) || 50,
      });
      messages = pulled.messages;
      contact = contact || pulled.contact;
      contactId = pulled.contactId;
      conversationId = pulled.conversationId;
    }

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: "No conversation messages found for this contact.",
          contactId,
          conversationId,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Resolve LLM provider + key ───────────────────────────────────
    const providerRaw =
      (await resolveSecret(supabase, "LLM_PROVIDER")).toLowerCase() ||
      "openai";
    const provider = providerRaw === "anthropic" ? "anthropic" : "openai";
    const apiKey = await resolveSecret(
      supabase,
      provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
    );
    const model =
      (await resolveSecret(
        supabase,
        provider === "openai" ? "LLM_MODEL_OPENAI" : "LLM_MODEL_ANTHROPIC",
      )) ||
      (provider === "openai" ? "gpt-4o-mini" : "claude-3-5-sonnet-latest");

    if (!apiKey) {
      // Return the transcript + contact info but skip the analysis so
      // the caller can show "key not configured" UI without crashing.
      return new Response(
        JSON.stringify({
          ok: false,
          reason: `${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} not configured. Add it to public.app_secrets or set as an env var.`,
          contactId,
          conversationId,
          contact: contact
            ? {
                id: contact.id,
                name:
                  contact.contactName ||
                  `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim(),
                email: contact.email,
                phone: contact.phone,
              }
            : null,
          transcript_preview: messages.slice(-10),
          message_count: messages.length,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Build prompt + call the chosen provider ──────────────────────
    const contactSummary = contact
      ? `Name: ${contact.contactName || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "(unknown)"}\nEmail: ${contact.email || "—"}\nPhone: ${contact.phone || "—"}`
      : "Name: (unknown)";
    const transcript = messages
      .map(
        (m) =>
          `[${m.ts || "—"}] ${m.direction === "inbound" ? "CUSTOMER" : "NOVARA"} (${m.channel}): ${m.body}`,
      )
      .join("\n");

    const llm =
      provider === "anthropic"
        ? await callAnthropic(apiKey, model, transcript, contactSummary)
        : await callOpenAI(apiKey, model, transcript, contactSummary);

    if (!llm.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          reason: llm.error,
          contactId,
          conversationId,
          message_count: messages.length,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        provider,
        model,
        contactId,
        conversationId,
        contact: contact
          ? {
              id: contact.id,
              name:
                contact.contactName ||
                `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim(),
              email: contact.email,
              phone: contact.phone,
            }
          : null,
        message_count: messages.length,
        analysis: llm.analysis,
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
