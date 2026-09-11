// Read-only GHL conversation pull for dispute packets / case files.
// Callers are already admin-gated service-role functions.

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export interface PacketMessage {
  at: string;
  direction: "inbound" | "outbound" | "unknown";
  channel: string;
  body: string;
}

async function ghl(path: string): Promise<{ ok: boolean; body: unknown }> {
  const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
  if (!token) return { ok: false, body: "GHL_PIT_TOKEN not set" };
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json: unknown = text;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { ok: res.ok, body: json };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? v as Record<string, unknown> : {};
}

export async function loadGhlConversation(email: string, phone: string): Promise<PacketMessage[]> {
  const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
  if (!locationId) return [];
  const query = (email || phone || "").trim();
  if (!query) return [];

  try {
    const params = new URLSearchParams({ locationId, query });
    const search = await ghl(`/contacts/?${params.toString()}`);
    if (!search.ok) return [];
    const contacts = (asRecord(search.body).contacts as Array<Record<string, unknown>> | undefined) || [];
    const emailLc = email.trim().toLowerCase();
    const phoneDigits = phone.replace(/\D/g, "");
    const target = contacts.find((c) => {
      const cEmail = String(c.email || "").toLowerCase();
      const cPhone = String(c.phone || "").replace(/\D/g, "");
      return (emailLc && cEmail === emailLc) ||
        (phoneDigits.length >= 10 && cPhone.endsWith(phoneDigits.slice(-10)));
    }) || contacts[0];
    if (!target?.id) return [];

    const convoSearch = await ghl(
      `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(String(target.id))}&limit=5`,
    );
    if (!convoSearch.ok) return [];
    const convos = (asRecord(convoSearch.body).conversations as Array<Record<string, unknown>> | undefined) || [];
    const out: PacketMessage[] = [];

    for (const c of convos.slice(0, 2)) {
      const msgRes = await ghl(`/conversations/${encodeURIComponent(String(c.id))}/messages?limit=80`);
      if (!msgRes.ok) continue;
      const body = asRecord(msgRes.body);
      const nested = asRecord(body.messages);
      const msgs = (Array.isArray(nested.messages) ? nested.messages : Array.isArray(body.messages) ? body.messages : []) as Array<Record<string, unknown>>;
      for (const m of msgs) {
        const text = String(m.body || "").trim();
        const channel = String(m.messageType || m.type || "message").replace(/^TYPE_/, "");
        if (!text && channel !== "CALL") continue;
        const dir = String(m.direction || "").toLowerCase();
        out.push({
          at: String(m.dateAdded || ""),
          direction: dir === "inbound" ? "inbound" : dir === "outbound" ? "outbound" : "unknown",
          channel,
          body: text || `[${channel.toLowerCase()}]`,
        });
      }
    }

    out.sort((a, b) => a.at.localeCompare(b.at));
    return out;
  } catch {
    return [];
  }
}
