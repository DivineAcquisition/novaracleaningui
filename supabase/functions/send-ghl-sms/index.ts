// send-ghl-sms
//
// Sends an SMS to a contact through GoHighLevel's Conversations API.
// This is the fallback path when Telnyx fails (e.g. number not verified
// in the Telnyx portal because the A2P 10DLC campaign hasn't completed).
// Reuses the GHL Private Integration Token already set as an Edge
// Function secret (GHL_PIT_TOKEN + GHL_LOCATION_ID).
//
// Body shapes accepted:
//   { phone: '+13013468452', message: '...' }            // looks up / creates contact by phone
//   { contactId: '...',      message: '...' }            // direct send
//   { email: '...', phone?: '...', message: '...' }      // by email
//
// Returns the GHL conversation message id on success.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Body {
  phone?: string;
  email?: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  message: string;
  type?: "SMS" | "WhatsApp";
}

async function ghlFetch(path: string, init: RequestInit, token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${GHL_BASE}${path}`, { ...init, headers });
  return res;
}

async function resolveContactId(
  body: Body,
  token: string,
  locationId: string,
): Promise<string | null> {
  if (body.contactId) return body.contactId;
  if (!body.email && !body.phone) return null;

  // Upsert the contact (idempotent in GHL) so we always have an id
  const upsertBody: Record<string, unknown> = {
    locationId,
    email: body.email || undefined,
    phone: body.phone || undefined,
    firstName: body.firstName || undefined,
    lastName: body.lastName || undefined,
    country: "US",
  };
  const res = await ghlFetch("/contacts/upsert", {
    method: "POST",
    body: JSON.stringify(upsertBody),
  }, token);
  if (!res.ok) {
    const text = await res.text();
    console.error("[send-ghl-sms] upsert failed", res.status, text.slice(0, 300));
    return null;
  }
  const json = await res.json();
  return (json?.contact?.id as string | undefined) ||
    (json?.id as string | undefined) || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    if (!token || !locationId) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const body: Body = await req.json();
    if (!body.message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const contactId = await resolveContactId(body, token, locationId);
    if (!contactId) {
      return new Response(
        JSON.stringify({ error: "unable to resolve contactId" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    const messagePayload: Record<string, unknown> = {
      type: body.type || "SMS",
      contactId,
      message: body.message,
    };

    const res = await ghlFetch("/conversations/messages", {
      method: "POST",
      body: JSON.stringify(messagePayload),
    }, token);
    const text = await res.text();
    if (!res.ok) {
      console.error("[send-ghl-sms] send failed", res.status, text.slice(0, 500));
      return new Response(
        JSON.stringify({
          error: "send failed",
          status: res.status,
          body: text.slice(0, 500),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        },
      );
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text);
    } catch { /* ignore */ }
    return new Response(
      JSON.stringify({
        success: true,
        contactId,
        messageId: parsed.messageId || parsed.id || null,
        conversationId: parsed.conversationId || null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-ghl-sms] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
