// ─── GHL read-only client for the Next.js server ──────────────────────────────
//
// The write side of the GHL integration lives in the Supabase edge functions
// (supabase/functions/_shared/ghl-client.ts). This is the read side the
// verification layer needs: messaging activity for a time window, attributed
// to the GHL user who sent it.
//
// Same credentials as everywhere else — GHL_PIT_TOKEN + GHL_LOCATION_ID from
// app_secrets (env override). Missing credentials are NOT an error: callers
// treat that as "source not connected" and the affected metrics stay
// unverified rather than being recorded as zero.

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export class GhlNotConfiguredError extends Error {
  constructor() {
    super("GHL is not connected (GHL_PIT_TOKEN / GHL_LOCATION_ID unset).");
    this.name = "GhlNotConfiguredError";
  }
}

export function isGhlConfigured(): boolean {
  return Boolean(
    (process.env.GHL_PIT_TOKEN || "").trim() && (process.env.GHL_LOCATION_ID || "").trim(),
  );
}

function credentials(): { token: string; locationId: string } {
  const token = (process.env.GHL_PIT_TOKEN || "").trim();
  const locationId = (process.env.GHL_LOCATION_ID || "").trim();
  if (!token || !locationId) throw new GhlNotConfiguredError();
  return { token, locationId };
}

async function ghl<T = unknown>(path: string): Promise<T> {
  const { token } = credentials();
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GHL ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

const toMs = (v: unknown): number => {
  if (typeof v === "number") return v;
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : NaN;
};

interface RawConversation {
  id?: string;
  lastMessageDate?: string | number;
}

/**
 * Conversation ids whose last message falls at or after `sinceMs`, newest
 * first. Paging stops as soon as we walk past the cutoff — conversations are
 * returned sorted by last_message_date desc.
 */
export async function conversationsSince(sinceMs: number, cap = 300): Promise<string[]> {
  const { locationId } = credentials();
  const ids: string[] = [];
  let offset = 0;

  while (ids.length < cap) {
    const body = await ghl<{ conversations?: RawConversation[] }>(
      `/conversations/search?locationId=${encodeURIComponent(locationId)}` +
        `&sort=desc&sortBy=last_message_date&limit=50&startAfter=${offset}`,
    );
    const page = body.conversations ?? [];
    if (page.length === 0) break;

    let walkedPast = false;
    for (const c of page) {
      const ts = toMs(c.lastMessageDate);
      if (!Number.isFinite(ts)) continue;
      if (ts < sinceMs) {
        walkedPast = true;
        break;
      }
      if (c.id) ids.push(c.id);
      if (ids.length >= cap) break;
    }
    if (walkedPast) break;
    offset += page.length;
  }

  return ids;
}

/** One outbound/inbound touch, reduced to what attribution needs. */
export interface GhlMessage {
  conversationId: string;
  /** GHL user who sent it — the attribution key. Null for inbound. */
  userId: string | null;
  direction: "inbound" | "outbound";
  /** TYPE_SMS, TYPE_CALL, TYPE_EMAIL, … */
  messageType: string;
  at: number;
  /** Call duration in seconds when the message is a call. */
  callDurationSeconds: number | null;
  callStatus: string | null;
}

interface RawMessage {
  id?: string;
  userId?: string;
  direction?: string;
  messageType?: string;
  type?: number | string;
  dateAdded?: string | number;
  status?: string;
  meta?: { call?: { duration?: number; status?: string } };
}

export async function conversationMessages(conversationId: string): Promise<GhlMessage[]> {
  const body = await ghl<{ messages?: { messages?: RawMessage[] } | RawMessage[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages?limit=100`,
  );
  const raw = Array.isArray(body.messages)
    ? body.messages
    : ((body.messages as { messages?: RawMessage[] } | undefined)?.messages ?? []);

  return raw
    .map((m): GhlMessage | null => {
      const at = toMs(m.dateAdded);
      if (!Number.isFinite(at)) return null;
      const duration = m.meta?.call?.duration;
      return {
        conversationId,
        userId: m.userId ? String(m.userId) : null,
        direction: String(m.direction || "").toLowerCase() === "inbound" ? "inbound" : "outbound",
        messageType: String(m.messageType || m.type || "").toUpperCase(),
        at,
        callDurationSeconds: typeof duration === "number" ? duration : null,
        callStatus: m.meta?.call?.status ? String(m.meta.call.status) : (m.status ?? null),
      };
    })
    .filter((m): m is GhlMessage => m !== null);
}

/** Bounded-concurrency map so a busy day doesn't fire 300 requests at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const pump = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => pump()),
  );
  return results;
}
