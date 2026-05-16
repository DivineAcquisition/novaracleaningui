// ─── LeadConnector inbound webhook mirror ────────────────────────────────────
// User-supplied always-on backup. Every booking/lead/waitlist event we
// process also fires here so the data lands in GHL even if the Private
// Integration credentials are misconfigured or the API call fails.
//
// The URL is intentionally hardcoded as a SAFETY NET — overriding via env
// (`LEADCONNECTOR_INBOUND_WEBHOOK_URL`) is supported so it can be rotated
// without a code change.

const DEFAULT_LEADCONNECTOR_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/fJddieqJDUjUoYAGOvbk/webhook-trigger/e4e949e8-eee9-4683-99f6-b58c7057e7f7";

function resolveUrl(): string {
  // deno-lint-ignore no-explicit-any
  const env = (globalThis as any).Deno?.env;
  const fromEnv = env ? (env.get("LEADCONNECTOR_INBOUND_WEBHOOK_URL") || "").trim() : "";
  return fromEnv || DEFAULT_LEADCONNECTOR_WEBHOOK_URL;
}

interface MirrorOptions {
  /** Event family — "booking", "lead", "waitlist", "reschedule", "cancellation", etc. */
  event: string;
  /** Arbitrary payload to forward verbatim. */
  payload: Record<string, unknown>;
  /** Optional override URL (mostly for tests). */
  url?: string;
}

/**
 * Fire-and-forget mirror to the LeadConnector inbound webhook. Never
 * throws — failures are logged and swallowed so they don't break the
 * primary flow. Adds a top-level `event` discriminator + ISO timestamp
 * so the receiving GHL automation can route different event types to
 * different sub-workflows.
 */
export async function mirrorToLeadConnector({
  event,
  payload,
  url,
}: MirrorOptions): Promise<void> {
  const target = (url || resolveUrl()).trim();
  if (!target) return;

  const enriched = {
    event,
    timestamp: new Date().toISOString(),
    source: "novara-supabase",
    ...payload,
  };

  try {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });
    const text = await res.text().catch(() => "");
    console.log(
      `[LEADCONNECTOR-MIRROR] event=${event} status=${res.status}` +
        (text ? ` bodyPreview=${text.slice(0, 200)}` : ""),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LEADCONNECTOR-MIRROR] event=${event} failed: ${msg}`);
  }
}
