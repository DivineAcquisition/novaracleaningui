// ─── admin-ghl-conversation-probe ─────────────────────────────────────
//
// Resolves a GHL contact by email or phone, finds their most recent
// conversation, and returns the last N messages. Used by the admin
// tooling to surface chat history without leaving the dashboard.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

async function ghl(path: string, init: RequestInit = {}) {
  const env = (globalThis as any).Deno?.env;
  const token = (env?.get("GHL_PIT_TOKEN") || "").trim();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: VERSION,
    Accept: "application/json",
    ...((init.headers as Record<string, string> | undefined) || {}),
  };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, ok: res.ok, body: json ?? text };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    if (!locationId) {
      return new Response(JSON.stringify({ error: "GHL_LOCATION_ID not set" }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const out: any = { input: { email, phone }, contacts: [], conversations: [], messages: [] };
    const params = new URLSearchParams();
    params.set("locationId", locationId);
    if (email) params.set("query", email);
    else if (phone) params.set("query", phone);
    const search = await ghl(`/contacts/?${params.toString()}`);
    if (!search.ok) {
      return new Response(JSON.stringify({ stage: "contact_search", ...search }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const contacts = ((search.body as any)?.contacts ?? []) as Array<any>;
    out.contacts = contacts.map((c) => ({
      id: c.id,
      name: c.contactName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(),
      email: c.email,
      phone: c.phone,
      tags: c.tags,
      dateAdded: c.dateAdded,
    }));

    const phoneDigits = phone.replace(/\D/g, "");
    const matched = contacts.filter((c) => {
      const cEmail = (c.email || "").toLowerCase();
      const cPhoneDigits = (c.phone || "").replace(/\D/g, "");
      return (email && cEmail === email) ||
        (phoneDigits && cPhoneDigits.endsWith(phoneDigits.slice(-10)));
    });
    const target = matched[0] || contacts[0];
    if (!target) {
      return new Response(JSON.stringify({ ...out, note: "no contacts matched" }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const convoSearch = await ghl(
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(target.id)}&limit=20`,
    );
    if (!convoSearch.ok) {
      return new Response(JSON.stringify({ ...out, target_id: target.id, stage: "conversation_search", convoSearch }), {
        status: 200, headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const convos = ((convoSearch.body as any)?.conversations ?? []) as Array<any>;
    out.conversations = convos.map((c) => ({
      id: c.id, type: c.type, lastMessageDate: c.lastMessageDate,
      lastMessageBody: c.lastMessageBody, lastMessageType: c.lastMessageType,
      unreadCount: c.unreadCount, contactName: c.fullName || c.contactName,
    }));

    for (const c of convos.slice(0, 3)) {
      const msgRes = await ghl(`/conversations/${encodeURIComponent(c.id)}/messages?limit=50`);
      if (!msgRes.ok) {
        out.messages.push({ conversationId: c.id, error: msgRes.body });
        continue;
      }
      const msgs = (((msgRes.body as any)?.messages?.messages) ?? ((msgRes.body as any)?.messages) ?? []) as Array<any>;
      out.messages.push({
        conversationId: c.id,
        count: msgs.length,
        items: msgs.map((m) => ({
          id: m.id, type: m.type, messageType: m.messageType, direction: m.direction,
          body: m.body, dateAdded: m.dateAdded, status: m.status, source: m.source,
          subject: m.subject, attachments: Array.isArray(m.attachments) ? m.attachments.length : 0,
        })),
      });
    }

    return new Response(JSON.stringify({ ...out, target_id: target.id }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
