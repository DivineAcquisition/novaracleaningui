// ─── ops-sync-env-secrets ────────────────────────────────────────────────────
//
// Some credentials only exist as Edge Function secrets (Deno.env), which the
// Next.js runtime can never see. That's fine for the edge functions themselves,
// but it silently starves anything on the Next side — the VA verification layer
// couldn't read GHL at all, so calls fell back to the local call log and SMS
// stayed permanently unverified.
//
// This copies an explicit ALLOWLIST of keys from the function environment into
// public.app_secrets, which both runtimes already read through the same
// resolveSecret / prime* helpers.
//
// Guard rails, because this handles credentials:
//   * Allowlist only. It will not enumerate or dump the environment.
//   * Values are NEVER returned. The probe reports presence and length only.
//   * It never overwrites a non-empty app_secrets row — whatever an operator
//     put there by hand wins over whatever is in env.
//   * Gated on CRON_SECRET, and the function keeps verify_jwt on.
//
// app_secrets is service-role only (no authenticated policy), so this doesn't
// widen who can read these values — it's the same store that already holds the
// Stripe key and the Airtable PAT.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * The only keys this function will ever touch. Anything the Next.js runtime
 * needs but can't otherwise reach belongs here; nothing else does.
 */
const ALLOWLIST = [
  "GHL_PIT_TOKEN",
  "GHL_LOCATION_ID",
  "RESEND_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Shared-secret gate. Read from app_secrets so it rotates with everything else.
  const { data: secretRow } = await supabase
    .from("app_secrets")
    .select("value")
    .eq("key", "CRON_SECRET")
    .maybeSingle();
  const expected = String(secretRow?.value || Deno.env.get("CRON_SECRET") || "").trim();
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  if (!expected || provided !== expected) {
    return json({ ok: false, error: "Not authorised." }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "probe");

  // What's actually available, described without disclosing anything.
  const present: Record<string, { inEnv: boolean; length: number }> = {};
  for (const key of ALLOWLIST) {
    const value = (Deno.env.get(key) || "").trim();
    present[key] = { inEnv: value.length > 0, length: value.length };
  }

  if (action === "probe") return json({ ok: true, env: present });

  if (action !== "bridge") return json({ ok: false, error: `Unknown action: ${action}` }, 400);

  const { data: existingRows } = await supabase
    .from("app_secrets")
    .select("key, value")
    .in("key", ALLOWLIST as unknown as string[]);
  const existing = new Map(
    ((existingRows || []) as { key: string; value: string | null }[]).map((r) => [
      r.key,
      String(r.value || "").trim(),
    ]),
  );

  const copied: string[] = [];
  const skipped: Record<string, string> = {};

  for (const key of ALLOWLIST) {
    const envValue = (Deno.env.get(key) || "").trim();
    if (!envValue) {
      skipped[key] = "not set in the function environment";
      continue;
    }
    if (existing.get(key)) {
      skipped[key] = "already set in app_secrets — left alone";
      continue;
    }
    const { error } = await supabase
      .from("app_secrets")
      .upsert(
        {
          key,
          value: envValue,
          description: `Mirrored from the Edge Function environment so the Next.js runtime can read it too. Rotate here and in Supabase function secrets together.`,
        },
        { onConflict: "key" },
      );
    if (error) skipped[key] = `write failed: ${error.message}`;
    else copied.push(key);
  }

  return json({ ok: true, copied, skipped, env: present });
});
