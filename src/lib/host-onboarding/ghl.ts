// ─── Invoke the partner-host-onboarding edge function (GHL side) ──────────
//
// The Next.js routes own the DB + Airtable writes; the GHL writes live in the
// Deno edge function (which reuses the shared ghl-client). This thin invoker
// calls it server-to-server with the service-role key. Best-effort — callers
// treat GHL as non-blocking.

function getSupabaseConfig(): { url: string; serviceKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

export type HostOnboardingGhlAction = "submit" | "sendForSignature" | "markSigned";

export interface HostOnboardingGhlResult {
  ok: boolean;
  contactId?: string | null;
  opportunityId?: string | null;
  error?: string;
}

export async function invokeHostOnboardingGhl(
  action: HostOnboardingGhlAction,
  payload: Record<string, unknown>,
): Promise<HostOnboardingGhlResult> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    return { ok: false, error: "Supabase service config missing (GHL sync skipped)." };
  }
  try {
    const res = await fetch(`${cfg.url}/functions/v1/partner-host-onboarding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.serviceKey}`,
        apikey: cfg.serviceKey,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = (await res.json().catch(() => ({}))) as HostOnboardingGhlResult;
    if (!res.ok) return { ok: false, error: data?.error || `GHL edge ${res.status}` };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
