// LSA conversational replies.
//
// Google Local Services Ads texts Novara from a relay number. That number
// is not the customer. On each new LSA thread this sends Malik's opener,
// then keeps the conversation on that same thread and saves the real
// phone the customer sends back.
//
// Cron posts { "mode": "run" } with header x-lsa-secret. "audit" sends nothing.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GHL = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const OPENER =
  "Hey, this is Malik from NovaraCleaning. Got your inquiry from google. What's your phone number so I can text or call I can get you a fair price?";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lsa-secret",
};

type Msg = { id: string; direction: string; type: string; body: string; at: number; source: string; contactId: string; conversationId: string; fromPhone: string };

function log(step: string, details?: unknown) {
  console.log(`[LSA-CHAT] ${step}${details ? " " + JSON.stringify(details) : ""}`);
}

async function secret(supabase: ReturnType<typeof createClient>, name: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value && typeof data.value === "string" && data.value.trim()) return data.value.trim();
  } catch { /* ignore */ }
  return (Deno.env.get(name) || "").trim();
}

async function ghl(token: string, path: string, init?: RequestInit) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
    ...((init?.headers as Record<string, string> | undefined) || {}),
  };
  if (init?.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(GHL + path, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function exportMessages(token: string, locationId: string): Promise<Msg[]> {
  const res = await ghl(token, `/conversations/messages/export?locationId=${encodeURIComponent(locationId)}`);
  if (!res.ok) {
    log("export failed", { status: res.status });
    return [];
  }
  return messageList(res.body);
}

function messageList(raw: unknown): Msg[] {
  const root = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const nested = root?.messages;
  const list = (Array.isArray(raw) ? raw : Array.isArray(nested) ? nested : Array.isArray((nested as { messages?: unknown[] } | undefined)?.messages) ? (nested as { messages: unknown[] }).messages : []) as Record<string, unknown>[];
  return list.filter((m) => m && typeof m === "object").map((m) => {
    const atRaw = m.dateAdded ?? m.timestamp ?? m.createdAt ?? 0;
    const atNum = typeof atRaw === "number" ? (atRaw < 1e12 ? atRaw * 1000 : atRaw) : Date.parse(String(atRaw));
    const body = m.body != null ? String(m.body) : (m.message != null ? String(m.message) : "");
    return {
      id: String(m.id || ""),
      direction: String(m.direction || "").toLowerCase(),
      type: String(m.messageType || m.type || "").toUpperCase(),
      body,
      at: Number.isFinite(atNum) ? atNum : 0,
      source: String(m.source || ""),
      contactId: String(m.contactId || ""),
      conversationId: String(m.conversationId || ""),
      fromPhone: toE164(String(m.from || "")) || "",
    };
  }).filter((m) => m.body.trim()).sort((a, b) => a.at - b.at);
}

function isLsaText(body: string): boolean {
  const t = body.toLowerCase();
  return t.includes("local services ads") || t.includes("g.co/homeservices") || t.includes("notes from lsa") || t.includes("replies to this number will be sent to the customer");
}

function isChat(type: string): boolean {
  return type.includes("SMS") || type.includes("FB") || type.includes("IG") || type.includes("CUSTOM");
}

function channelOf(messages: Msg[]): "SMS" | "FB" | "IG" {
  if (messages.some((m) => m.type.includes("IG"))) return "IG";
  if (messages.some((m) => m.type.includes("FB"))) return "FB";
  return "SMS";
}

function isAutomatedNotice(body: string): boolean {
  const t = body.toLowerCase();
  return t.includes("missed your call")
    || t.includes("pulse check")
    || t.includes("job offer")
    || t.includes("submit your w-9")
    || t.includes("is still pending")
    || t.includes("tried giving you");
}

function sameOutbound(sent: string, actual: string): boolean {
  const clean = (value: string) => value
    .replace(/\s*reply stop to unsubscribe\.?/gi, "")
    .replace(/\s*thanks, novaracleaning\.?/gi, "")
    .trim();
  return clean(actual) === clean(sent);
}

function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function phonesIn(text: string): string[] {
  const found: string[] = [];
  const re = /(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}/g;
  for (const match of text.match(re) || []) {
    const e164 = toE164(match);
    if (e164 && !found.includes(e164)) found.push(e164);
  }
  return found;
}

function homeSizeFromSqft(sqft: number): string | null {
  const bands: Array<[number, number, string | null]> = [
    [0, 999, "0_999"],
    [1000, 1500, "1000_1500"],
    [1501, 2000, "1501_2000"],
    [2001, 2500, "2001_2500"],
    [2501, 3000, "2501_3000"],
    [3001, 3500, "3001_3500"],
    [3501, 4000, "3501_4000"],
    [4001, 4500, "4001_4500"],
    [4501, 5000, "4501_5000"],
    [5001, 999999, null],
  ];
  for (const [min, max, id] of bands) if (sqft >= min && sqft <= max) return id;
  return null;
}

function homeSizeFromBeds(beds: number): string {
  if (beds <= 1) return "0_999";
  if (beds === 2) return "1000_1500";
  if (beds === 3) return "1501_2000";
  if (beds === 4) return "2001_2500";
  return "3001_3500";
}

function serviceFrom(text: string): string {
  const t = text.toLowerCase();
  if (/\bmove[\s-]?(in|out)\b/.test(t)) return "moveInOut";
  if (t.includes("deep")) return "deep";
  if (t.includes("standard") || t.includes("regular") || t.includes("maintenance")) return "standard";
  return "deep";
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function wantsStop(text: string): boolean {
  return /^(stop|unsubscribe|stopall|cancel|end|quit)\b/i.test(text.trim());
}

function saidYes(text: string): boolean {
  return /^(yes|yeah|yep|yea|ya|ok|okay|sure|book it|send it|lock it|that works|sounds good)\b/i.test(text.trim());
}

function nextWeekday(name: string): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const target = days.indexOf(name);
  const now = new Date();
  const delta = (target - now.getDay() + 7) % 7 || 7;
  now.setDate(now.getDate() + delta);
  return now.toISOString().slice(0, 10);
}

function parseWhen(text: string): { date: string | null; slot: string | null } {
  const t = text.toLowerCase();
  let slot: string | null = null;
  if (/\bmorning\b/.test(t)) slot = "8:00 AM - 12:00 PM";
  else if (/\bafternoon\b/.test(t)) slot = "12:00 PM - 4:00 PM";
  else if (/\bevening\b|\bnight\b/.test(t)) slot = "4:00 PM - 8:00 PM";
  let date: string | null = null;
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) date = iso[1];
  else if (/\btoday\b/.test(t)) date = new Date().toISOString().slice(0, 10);
  else if (/\btomorrow\b/.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    date = d.toISOString().slice(0, 10);
  } else {
    for (const day of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
      if (t.includes(day)) {
        date = nextWeekday(day);
        break;
      }
    }
  }
  return { date, slot };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let releaseLock = false;
  try {
  const url = new URL(req.url);
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const expected = await secret(supabase, "LSA_CHAT_AGENT_SECRET");
  const got = req.headers.get("x-lsa-secret") || url.searchParams.get("secret") || String(payload.secret || "");
  if (!expected || got !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: cors });
  }

  const direction = String(
    (payload.direction as string) ||
    ((payload.message as { direction?: string } | undefined)?.direction) ||
    "inbound",
  ).toLowerCase();
  if (direction === "outbound") {
    return new Response(JSON.stringify({ skipped: "outbound" }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  const mode = String(payload.mode || (payload.contactId || payload.contact_id || payload.conversationId ? "webhook" : "run"));
  const dry = mode === "audit";

  const token = (await secret(supabase, "GHL_PIT_TOKEN")) || (Deno.env.get("GHL_PIT_TOKEN") || "");
  const locationId = (await secret(supabase, "GHL_LOCATION_ID")) || (Deno.env.get("GHL_LOCATION_ID") || "");
  if (!token || !locationId) {
    return new Response(JSON.stringify({ error: "GHL not configured" }), { status: 500, headers: cors });
  }

  if (!dry) {
    const lock = Number(await secret(supabase, "LSA_CHAT_AGENT_LOCK") || 0);
    if (lock && Date.now() - lock < 55000) {
      return new Response(JSON.stringify({ skipped: "busy" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    releaseLock = true;
    await supabase.from("app_secrets").upsert({
      key: "LSA_CHAT_AGENT_LOCK",
      value: String(Date.now()),
      description: "chat agent watch lock",
    }, { onConflict: "key" });
  }

  const wantedContact = String(payload.contactId || payload.contact_id || (payload.contact as { id?: string } | undefined)?.id || "");
  const wantedConv = String(payload.conversationId || payload.conversation_id || "");
  const report: Array<Record<string, unknown>> = [];
  const freshAfter = Date.now() - 48 * 60 * 60 * 1000;
  const deadline = Date.now() + (dry || wantedContact || wantedConv ? 0 : 50000);
  const seenInbound = new Set<string>();
  const failedSend = new Set<string>();

  do {
  const exported = await exportMessages(token, locationId);
  const since = seenInbound.size === 0 ? Date.now() - 6 * 60 * 60 * 1000 : Date.now() - 90 * 1000;
  const inboundNow = exported.filter((m) => m.direction === "inbound" && m.at >= since && !seenInbound.has(m.id));
  for (const m of inboundNow) seenInbound.add(m.id);
  const fromExport = new Map<string, { id: string; contactId: string }>();
  for (const m of (seenInbound.size && inboundNow.length === 0 ? exported.filter((m) => m.direction === "inbound" && m.at >= since) : inboundNow)) {
    if (m.conversationId) fromExport.set(m.conversationId, { id: m.conversationId, contactId: m.contactId });
  }
  if (wantedContact) {
    for (const m of exported) {
      if (m.contactId === wantedContact && m.conversationId) fromExport.set(m.conversationId, { id: m.conversationId, contactId: m.contactId });
    }
  }
  const search = await ghl(token, `/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=20`);
  const searched = search.ok ? (((search.body as { conversations?: Record<string, unknown>[] }).conversations) || []) : [];
  const conversations: Array<{ id: string; contactId: string }> = [];
  const have = new Set<string>();
  for (const c of [...fromExport.values(), ...searched.map((c) => ({ id: String(c.id || ""), contactId: String(c.contactId || "") }))]) {
    if (!c.id || have.has(c.id)) continue;
    if (wantedConv && c.id !== wantedConv) continue;
    if (wantedContact && c.contactId && c.contactId !== wantedContact) continue;
    have.add(c.id);
    conversations.push(c);
  }
  const exportByConv = new Map<string, Msg[]>();
  for (const m of exported) {
    const id = m.conversationId;
    if (!id) continue;
    const list = exportByConv.get(id) || [];
    list.push(m);
    exportByConv.set(id, list);
  }

  for (const conv of conversations) {
    const conversationId = String(conv.id || "");
    const contactId = String(conv.contactId || "");
    if (!conversationId || !contactId || failedSend.has(conversationId)) continue;
    try {
    const cached = exportByConv.get(conversationId) || [];
    const loaded = cached.length ? cached : await (async () => {
      const msgsRes = await ghl(token, `/conversations/${conversationId}/messages?limit=40`);
      return msgsRes.ok ? messageList(msgsRes.body) : [];
    })();
    const messages = loaded.filter((m) => isChat(m.type) || isLsaText(m.body));
    if (!messages.length) continue;
    const lsaAt = messages.find((m) => isLsaText(m.body));
    const channel = channelOf(messages);
    const facebook = channel === "FB" || channel === "IG";

    let { data: row } = await supabase
      .from("lsa_chat_threads")
      .select("*")
      .eq("ghl_conversation_id", conversationId)
      .maybeSingle();
    if (!row) {
      const fromPhone = [...messages].reverse().find((m) => m.direction === "inbound" && m.fromPhone)?.fromPhone;
      if (fromPhone) {
        const { data: byPhone } = await supabase
          .from("lsa_chat_threads")
          .select("*")
          .eq("customer_phone", fromPhone)
          .eq("handoff", false)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (byPhone?.[0] && byPhone[0].status !== "human" && byPhone[0].status !== "opted_out") row = byPhone[0];
      }
    }

    const owned = Boolean(row?.opener_sent_at && !row?.handoff && row?.status !== "human" && row?.status !== "opted_out");
    if (!lsaAt && !facebook && !owned) continue;

    const threadText = messages.map((m) => m.body).join("\n");
    const serviceType = serviceFrom(lsaAt ? threadText : (row?.service_hint ? `${row.service_hint}\n${threadText}` : threadText));
    const startAt = lsaAt?.at || 0;
    const humanAlready = messages.some((m) =>
      m.at >= startAt
      && m.direction === "outbound"
      && isChat(m.type)
      && m.source !== "workflow"
      && !isAutomatedNotice(m.body)
      && !m.body.startsWith("Hey, this is Malik from NovaraCleaning")
    );
    const sentBodies = new Set<string>(
      (Array.isArray(row?.agent_messages) ? row.agent_messages : []).map((s: string) => String(s).trim()),
    );
    const manualTakeover = Boolean(row?.opener_sent_at) && messages.some((m) =>
      m.direction === "outbound"
      && isChat(m.type)
      && m.source !== "workflow"
      && ![...sentBodies].some((sent) => sameOutbound(sent, m.body))
      && !isAutomatedNotice(m.body)
      && !m.body.startsWith("Hey, this is Malik from NovaraCleaning")
    );

    if (row?.handoff || row?.status === "opted_out" || row?.status === "human") {
      report.push({ conversationId, action: "skipped", reason: row.status });
      continue;
    }

    if (manualTakeover) {
      if (!dry) {
        await supabase.from("lsa_chat_threads").upsert({
          ghl_conversation_id: conversationId,
          ghl_contact_id: contactId,
          channel,
          status: "human",
          handoff: true,
          updated_at: new Date().toISOString(),
        });
      }
      report.push({ conversationId, action: "stopped-manual" });
      continue;
    }

    if (!row && humanAlready) {
      if (!dry) {
        await supabase.from("lsa_chat_threads").upsert({
          ghl_conversation_id: conversationId,
          ghl_contact_id: contactId,
          status: "human",
          handoff: true,
          updated_at: new Date().toISOString(),
        });
      }
      report.push({ conversationId, action: "left-with-human" });
      continue;
    }

    const contact = await ghl(token, `/contacts/${contactId}`);
    const contactBody = (contact.ok ? contact.body : {}) as { contact?: Record<string, unknown> };
    const c = contactBody.contact || (contact.body as Record<string, unknown>) || {};
    const relay = toE164(String(c.phone || conv.phone || ""));
    const inbound = messages.filter((m) => m.direction === "inbound" && isChat(m.type) && !isLsaText(m.body));
    const latestInbound = inbound[inbound.length - 1];
    const customerSaid = latestInbound?.body || "";

    if (latestInbound && wantsStop(customerSaid)) {
      if (!dry) {
        await supabase.from("lsa_chat_threads").upsert({
          ghl_conversation_id: conversationId,
          ghl_contact_id: contactId,
          relay_phone: relay,
          status: "opted_out",
          updated_at: new Date().toISOString(),
        });
      }
      report.push({ conversationId, action: "stop" });
      continue;
    }

    const opener = lsaAt ? OPENER : "Hey, this is Malik from NovaraCleaning. What's your phone number so I can text or call and get you a fair price?";
    const openerSent = Boolean(row?.opener_sent_at) || messages.some((m) => m.direction === "outbound" && m.body.startsWith("Hey, this is Malik from NovaraCleaning"));
    const lastTouch = Math.max(lsaAt?.at || 0, latestInbound?.at || 0);
    let reply: string | null = null;
    let patch: Record<string, unknown> = {
      ghl_conversation_id: conversationId,
      ghl_contact_id: contactId,
      relay_phone: relay,
      service_hint: serviceType,
      updated_at: new Date().toISOString(),
    };

    if (!openerSent) {
      if (lastTouch < freshAfter) {
        report.push({ conversationId, action: "old-lsa-left-alone" });
        continue;
      }
      reply = opener;
      patch = { ...patch, channel, status: "need_phone", opener_sent_at: new Date().toISOString() };
    } else if (latestInbound && (!row?.last_inbound_id || row.last_inbound_id !== latestInbound.id)) {
      const knownRelay = relay || String(row?.relay_phone || "");
      const customerTexts = inbound.map((m) => m.body).join("\n");
      const fromCustomer = phonesIn(customerTexts).filter((p) => p !== knownRelay);
      const fromNotice = phonesIn(lsaAt?.body || "").filter((p) => p !== knownRelay);
      const phone = fromCustomer[0] || (saidYes(customerSaid) ? fromNotice[0] : null) || row?.customer_phone || null;
      const zip = (customerTexts.match(/\b(\d{5})\b/) || [])[1] || row?.zip_code || null;
      const sqftMatch = customerTexts.match(/(\d{3,5})\s*(sq|square)/i);
      const bedsMatch = customerTexts.match(/(\d)\s*(bed|br|bedroom)/i);
      const sqft = sqftMatch ? Number(sqftMatch[1]) : row?.sqft || null;
      const beds = bedsMatch ? Number(bedsMatch[1]) : row?.bedrooms || null;
      const emailMatch = customerTexts.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const email = emailMatch ? emailMatch[0] : row?.email || null;
      const named = customerTexts.match(/\b(?:i'm|im|this is|name is)\s+([A-Za-z]{2,20})\b/i);
      const firstName = named?.[1] || row?.first_name || null;
      const when = parseWhen(customerTexts);
      const preferredDate = when.date || row?.preferred_date || null;
      const timeSlot = when.slot || row?.time_slot || null;

      patch = {
        ...patch,
        status: row?.status || "need_phone",
        customer_phone: phone,
        zip_code: zip,
        sqft,
        bedrooms: beds,
        email,
        first_name: firstName,
        preferred_date: preferredDate,
        time_slot: timeSlot,
        last_inbound_id: latestInbound.id,
      };

      if (!phone) {
        reply = "I just need the best number to reach you on. What's your phone number?";
        patch.status = "need_phone";
      } else if (!zip) {
        reply = `Perfect. I'll call and text you at ${phone}. What's your ZIP so I can get you a fair price?`;
        patch.status = "need_zip";
        if (!dry && !row?.customer_phone) {
          await ghl(token, `/contacts/${contactId}/notes`, {
            method: "POST",
            body: JSON.stringify({ body: `Customer phone from LSA chat (not the Google relay): ${phone}` }),
          });
        }
      } else if (!sqft && !beds) {
        reply = "Got it. About how many bedrooms and bathrooms, or the square feet?";
        patch.status = "need_size";
      } else if (!row?.quote_cents) {
        const homeSizeId = sqft ? homeSizeFromSqft(Number(sqft)) : homeSizeFromBeds(Number(beds));
        if (!homeSizeId) {
          reply = "That home is big enough that I need to price it with you directly. I'll have someone call you on that number.";
          patch.status = "human";
          patch.handoff = true;
        } else {
          const quoteRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/quote-dynamic-price`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            },
            body: JSON.stringify({
              action: "quote",
              zip,
              serviceType,
              homeSizeId,
              condition: "standard",
            }),
          });
          const quote = await quoteRes.json().catch(() => ({}));
          if (!quote.ok || !quote.served) {
            reply = quote.message || "We don't cover that ZIP yet. I can put you on the list for when we do.";
            patch.status = "unserved";
          } else {
            const total = Number(quote.breakdown?.totalCents || 0);
            const deposit = Math.round(total / 2);
            patch.quote_cents = total;
            patch.home_size_id = homeSizeId;
            patch.status = "quoted";
            const label = serviceType === "deep" ? "deep clean" : serviceType === "moveInOut" ? "move-out clean" : "standard clean";
            reply = `For that size, a ${label} is ${money(total)}. A 50% deposit (${money(deposit)}) holds the spot, and the rest is charged after the clean. Want me to lock a day?`;
          }
        }
      } else if ((saidYes(customerSaid) || preferredDate) && !row?.pay_url && row?.quote_cents) {
        if (!preferredDate || !timeSlot) {
          reply = "What day works, and do you want morning, afternoon, or evening?";
          patch.status = "need_when";
        } else if (!email || !firstName) {
          reply = "What's your first name and email so I can send the pay link?";
          patch.status = "need_contact";
        } else if (dry) {
          reply = "[would send pay link]";
          patch.status = "booked";
        } else {
          reply = await bookAndLink(supabase, {
            firstName: String(firstName),
            email: String(email),
            phone: String(phone),
            zip: String(zip),
            homeSizeId: String(row.home_size_id || (sqft ? homeSizeFromSqft(Number(sqft)) : homeSizeFromBeds(Number(beds)))),
            serviceType,
            serviceDate: String(preferredDate),
            timeSlot: String(timeSlot),
          }, patch);
        }
      } else if (row?.status === "need_contact") {
        const name = (customerSaid.match(/\b([A-Z][a-z]{1,20})\b/) || [])[1] || firstName;
        if (name) patch.first_name = name;
        if (email && (name || firstName) && dry) {
          reply = "[would send pay link]";
          patch.status = "booked";
        } else if (email && (name || firstName)) {
          reply = await bookAndLink(supabase, {
            firstName: String(name || firstName),
            email: String(email),
            phone: String(phone),
            zip: String(zip),
            homeSizeId: String(row.home_size_id),
            serviceType,
            serviceDate: String(preferredDate || row.preferred_date),
            timeSlot: String(timeSlot || row.time_slot),
          }, patch);
        } else {
          reply = "I still need a first name and an email to send the pay link.";
        }
      } else if (row?.pay_url) {
        reply = `You're all set once the deposit is in. Here's the link again: ${row.pay_url}`;
      } else {
        reply = await malikReply(supabase, customerSaid, String(row?.status || "need_phone"));
      }
    }

    if (reply && !dry) {
      const sendSms = async (payload: Record<string, unknown>) => {
        const sent = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ghl-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify(payload),
        });
        const sentBody = await sent.text();
        return { ok: sent.ok, status: sent.status, body: sentBody };
      };
      let sent = await sendSms({ contactId, message: reply, type: channel });
      const phone = String(patch.customer_phone || row?.customer_phone || "");
      if (!sent.ok && phone && /contact not found/i.test(sent.body)) {
        sent = await sendSms({ phone, message: reply, type: channel });
      }
      if (!sent.ok) {
        failedSend.add(conversationId);
        log("send failed", { conversationId, status: sent.status, body: sent.body.slice(0, 180) });
        report.push({ conversationId, action: "send-failed" });
        continue;
      }
      let sentJson: Record<string, unknown> = {};
      try { sentJson = JSON.parse(sent.body) as Record<string, unknown>; } catch { /* ignore */ }
      if (sentJson.contactId) patch.ghl_contact_id = String(sentJson.contactId);
      patch.last_reply_at = new Date().toISOString();
      patch.channel = channel;
      patch.agent_messages = [...sentBodies, reply.trim()];
      patch.ghl_conversation_id = conversationId;
      await supabase.from("lsa_chat_threads").upsert(patch);
      if (row?.ghl_conversation_id && row.ghl_conversation_id !== conversationId) {
        await supabase.from("lsa_chat_threads").delete().eq("ghl_conversation_id", row.ghl_conversation_id);
      }
      report.push({ conversationId, action: openerSent ? "replied" : "opener", status: patch.status });
    } else {
      report.push({ conversationId, action: dry ? "would-send" : "no-reply", status: patch.status || row?.status, preview: reply?.slice(0, 80) || null });
    }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("thread failed", { conversationId, message });
      report.push({ conversationId, action: "error", message: message.slice(0, 160) });
    }
  }
  if (Date.now() >= deadline) break;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (Date.now() < deadline);

  return new Response(JSON.stringify({ mode, count: report.length, report }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("run failed", { message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } finally {
    if (releaseLock) {
      await supabase.from("app_secrets").upsert({
        key: "LSA_CHAT_AGENT_LOCK",
        value: "0",
        description: "chat agent watch lock",
      }, { onConflict: "key" });
    }
  }
});

async function bookAndLink(
  supabase: ReturnType<typeof createClient>,
  info: { firstName: string; email: string; phone: string; zip: string; homeSizeId: string; serviceType: string; serviceDate: string; timeSlot: string },
  patch: Record<string, unknown>,
): Promise<string> {
  const serviceDate = info.serviceDate;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/book-as-va`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}` },
    body: JSON.stringify({
      firstName: info.firstName,
      email: info.email,
      phone: info.phone,
      zipCode: info.zip,
      homeSizeId: info.homeSizeId,
      serviceType: info.serviceType,
      serviceDate,
      timeSlot: info.timeSlot,
      invoiceMode: "deposit_plus_preauth",
      csrName: "Malik",
      sendConfirmationSms: false,
      sendChecklistEmail: false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const url = data?.preauthSession?.url as string | undefined;
  if (!res.ok || !url) {
    patch.status = "human";
    patch.handoff = true;
    return "I hit a snag sending the link. Someone from Novara will text you on that number.";
  }
  patch.status = "booked";
  patch.booking_id = data.bookingId;
  patch.pay_url = url;
  const total = Number(data?.totals?.totalCents || 0);
  const deposit = Number(data?.totals?.depositCents || 0);
  return `You're booked pending the deposit. Total ${money(total)}, deposit ${money(deposit)}. Pay here and it confirms: ${url}`;
}

async function malikReply(supabase: ReturnType<typeof createClient>, customerSaid: string, missing: string): Promise<string> {
  const apiKey = await secret(supabase, "ANTHROPIC_API_KEY");
  const model = (await secret(supabase, "LLM_MODEL_ANTHROPIC")) || "claude-sonnet-4-5";
  const fallback = missing === "need_phone"
    ? "What's the best phone number to reach you?"
    : missing === "need_zip"
    ? "What's your ZIP so I can get you a fair price?"
    : "About how many bedrooms and bathrooms?";
  if (!apiKey) return fallback;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0.4,
      system: "You are Malik texting for NovaraCleaning. One or two short sentences. Sound like a person, not a script. Do not invent a price. Ask only for the missing piece: " + missing + ".",
      messages: [{ role: "user", content: `The customer just said: ${customerSaid.slice(0, 500)}` }],
    }),
  });
  if (!res.ok) return fallback;
  const body = await res.json().catch(() => ({}));
  const text = body?.content?.[0]?.text;
  return typeof text === "string" && text.trim() ? text.trim() : fallback;
}
