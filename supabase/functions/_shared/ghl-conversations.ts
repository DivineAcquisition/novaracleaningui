// Read-only GHL conversation + notes pull for QC case files.
// Never writes. Missing credentials become an explicit gap, not a throw.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface GhlRawMessage {
  id: string | null;
  conversationId: string | null;
  direction: string | null;
  messageType: string | null;
  body: string | null;
  at: string | null;
  atMs: number | null;
  callDurationSeconds: number | null;
  callStatus: string | null;
  status: string | null;
  userId: string | null;
  attachments: unknown;
  raw: unknown;
}

export interface GhlNote {
  id: string | null;
  body: string | null;
  at: string | null;
  userId: string | null;
  raw: unknown;
}

export interface GhlContactHistory {
  party: string;
  configured: boolean;
  contactId: string | null;
  lookup: { email?: string | null; phone?: string | null };
  conversations: Array<{ id: string; lastMessageDate?: string | number | null; raw?: unknown }>;
  messages: GhlRawMessage[];
  notes: GhlNote[];
  errors: string[];
  gaps: string[];
}

function toMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? v * 1000 : v;
  }
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : null;
}

function iso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

async function ghlJson(
  token: string,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: "application/json",
      },
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `GHL ${res.status} ${path} ${text.slice(0, 240)}` };
    }
    try {
      return { ok: true, body: text ? JSON.parse(text) : {} };
    } catch {
      return { ok: false, error: `GHL ${path} returned non-JSON` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function lookupContactId(
  token: string,
  locationId: string,
  email?: string | null,
  phone?: string | null,
): Promise<{ id: string | null; error?: string }> {
  const params = new URLSearchParams({ locationId });
  if (email) params.set("email", email);
  if (phone) params.set("phone", phone);
  if (!email && !phone) return { id: null, error: "No email or phone for GHL lookup" };
  const r = await ghlJson(token, `/contacts/lookup?${params.toString()}`);
  if (!r.ok) return { id: null, error: r.error };
  const body = r.body as Record<string, unknown>;
  const contact = (body.contact || body) as Record<string, unknown>;
  const id = String(contact.id || contact.contactId || "").trim();
  return { id: id || null };
}

async function searchConversations(
  token: string,
  locationId: string,
  contactId: string,
): Promise<{ ids: Array<{ id: string; lastMessageDate?: string | number | null; raw: unknown }>; error?: string }> {
  const out: Array<{ id: string; lastMessageDate?: string | number | null; raw: unknown }> = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const q =
      `/conversations/search?locationId=${encodeURIComponent(locationId)}` +
      `&contactId=${encodeURIComponent(contactId)}&limit=50&startAfter=${offset}`;
    const r = await ghlJson(token, q);
    if (!r.ok) return { ids: out, error: r.error };
    const body = r.body as { conversations?: Array<Record<string, unknown>> };
    const pageRows = body.conversations ?? [];
    if (pageRows.length === 0) break;
    for (const c of pageRows) {
      const id = String(c.id || "").trim();
      if (id) out.push({ id, lastMessageDate: (c.lastMessageDate as string | number | null) ?? null, raw: c });
    }
    if (pageRows.length < 50) break;
    offset += pageRows.length;
  }
  return { ids: out };
}

function extractMessages(raw: unknown, conversationId: string): GhlRawMessage[] {
  const body = raw as Record<string, unknown>;
  const list = Array.isArray(body.messages)
    ? body.messages as Record<string, unknown>[]
    : Array.isArray((body.messages as { messages?: unknown[] } | undefined)?.messages)
      ? ((body.messages as { messages: Record<string, unknown>[] }).messages)
      : [];
  return list.map((m) => {
    const meta = (m.meta && typeof m.meta === "object") ? m.meta as Record<string, unknown> : {};
    const call = (meta.call && typeof meta.call === "object") ? meta.call as Record<string, unknown> : {};
    const atMs = toMs(m.dateAdded ?? m.timestamp ?? m.createdAt);
    const duration = typeof call.duration === "number"
      ? call.duration
      : (typeof m.callDuration === "number" ? m.callDuration : null);
    return {
      id: m.id ? String(m.id) : null,
      conversationId,
      direction: m.direction ? String(m.direction) : null,
      messageType: String(m.messageType || m.type || "").toUpperCase() || null,
      body: m.body != null ? String(m.body) : (m.message != null ? String(m.message) : null),
      at: iso(atMs),
      atMs,
      callDurationSeconds: duration,
      callStatus: call.status != null ? String(call.status) : (m.status != null ? String(m.status) : null),
      status: m.status != null ? String(m.status) : null,
      userId: m.userId != null ? String(m.userId) : null,
      attachments: m.attachments ?? m.attachmentsUrls ?? null,
      raw: m,
    };
  });
}

async function conversationMessages(
  token: string,
  conversationId: string,
): Promise<{ messages: GhlRawMessage[]; error?: string }> {
  const all: GhlRawMessage[] = [];
  let lastId: string | null = null;
  for (let page = 0; page < 40; page++) {
    const q = lastId
      ? `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100&lastMessageId=${encodeURIComponent(lastId)}`
      : `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`;
    const r = await ghlJson(token, q);
    if (!r.ok) return { messages: all, error: r.error };
    const batch = extractMessages(r.body, conversationId);
    if (batch.length === 0) break;
    all.push(...batch);
    const nextLast = batch[batch.length - 1]?.id;
    if (!nextLast || nextLast === lastId || batch.length < 100) break;
    lastId = nextLast;
  }
  return { messages: all };
}

async function contactNotes(token: string, contactId: string): Promise<{ notes: GhlNote[]; error?: string }> {
  const r = await ghlJson(token, `/contacts/${encodeURIComponent(contactId)}/notes`);
  if (!r.ok) return { notes: [], error: r.error };
  const body = r.body as { notes?: Array<Record<string, unknown>> };
  const list = body.notes ?? (Array.isArray(r.body) ? r.body as Array<Record<string, unknown>> : []);
  const notes = list.map((n) => {
    const atMs = toMs(n.dateAdded ?? n.createdAt ?? n.body?.dateAdded);
    return {
      id: n.id ? String(n.id) : null,
      body: n.body != null ? (typeof n.body === "string" ? n.body : JSON.stringify(n.body)) : null,
      at: iso(atMs),
      userId: n.userId != null ? String(n.userId) : null,
      raw: n,
    };
  });
  return { notes };
}

export async function fetchGhlContactHistory(opts: {
  token: string | null;
  locationId: string | null;
  party: string;
  contactId?: string | null;
  email?: string | null;
  phone?: string | null;
}): Promise<GhlContactHistory> {
  const gaps: string[] = [];
  const errors: string[] = [];
  const base: GhlContactHistory = {
    party: opts.party,
    configured: Boolean(opts.token && opts.locationId),
    contactId: opts.contactId || null,
    lookup: { email: opts.email || null, phone: opts.phone || null },
    conversations: [],
    messages: [],
    notes: [],
    errors,
    gaps,
  };
  if (!opts.token || !opts.locationId) {
    gaps.push("GHL credentials are not configured in this environment; conversation history could not be retrieved.");
    return base;
  }

  let contactId = String(opts.contactId || "").trim() || null;
  if (!contactId) {
    const looked = await lookupContactId(opts.token, opts.locationId, opts.email, opts.phone);
    if (looked.error) errors.push(looked.error);
    contactId = looked.id;
  }
  base.contactId = contactId;
  if (!contactId) {
    gaps.push(`No GHL contact id found for ${opts.party} (lookup by stored id / email / phone returned nothing).`);
    return base;
  }

  const conv = await searchConversations(opts.token, opts.locationId, contactId);
  if (conv.error) errors.push(conv.error);
  base.conversations = conv.ids.map((c) => ({ id: c.id, lastMessageDate: c.lastMessageDate, raw: c.raw }));
  if (conv.ids.length === 0) {
    gaps.push(`GHL returned no conversations for ${opts.party} contact ${contactId}.`);
  }

  for (const c of conv.ids) {
    const msgs = await conversationMessages(opts.token, c.id);
    if (msgs.error) errors.push(msgs.error);
    base.messages.push(...msgs.messages);
  }
  base.messages.sort((a, b) => (a.atMs || 0) - (b.atMs || 0));

  const notes = await contactNotes(opts.token, contactId);
  if (notes.error) errors.push(notes.error);
  base.notes = notes.notes.sort((a, b) => (toMs(a.at) || 0) - (toMs(b.at) || 0));
  if (base.notes.length === 0) {
    gaps.push(`No GHL notes on file for ${opts.party}.`);
  }
  return base;
}
