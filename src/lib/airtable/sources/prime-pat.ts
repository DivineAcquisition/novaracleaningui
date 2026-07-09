// ─── Airtable PAT primer ──────────────────────────────────────────────────
//
// The Airtable REST client (client.ts) reads the PAT from process.env at call
// time (AIRTABLE_PAT → AIRTABLE_API_KEY). To make Supabase's public.app_secrets
// a SINGLE source of truth for the token — so the same secret powers both the
// edge-function mirrors AND these Next.js sync routes — we resolve it from
// app_secrets on first use and stuff it into process.env when the env var is
// absent. Env still wins when present (Vercel override).
//
// Safe + idempotent: no-ops once a token is in process.env; never logs it.

import { getAdminSupabase } from "./admin-client";

let primed = false;

/** Ensure process.env.AIRTABLE_PAT is populated, pulling from app_secrets if needed. */
export async function primeAirtablePat(): Promise<boolean> {
  if (process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY) return true;
  if (primed) return !!process.env.AIRTABLE_PAT;
  primed = true;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase
      .from("app_secrets")
      .select("key, value")
      .in("key", ["AIRTABLE_PAT", "AIRTABLE_API_KEY"]);
    const byKey = new Map((data || []).map((r: { key: string; value: string | null }) => [r.key, (r.value || "").trim()]));
    const token = byKey.get("AIRTABLE_PAT") || byKey.get("AIRTABLE_API_KEY") || "";
    if (token) {
      process.env.AIRTABLE_PAT = token;
      // Also mirror the Ops base id if only stored in app_secrets.
      if (!process.env.AIRTABLE_REVENUE_OPS_BASE_ID) {
        const { data: baseRow } = await supabase
          .from("app_secrets")
          .select("value")
          .eq("key", "AIRTABLE_REVENUE_OPS_BASE_ID")
          .maybeSingle();
        const baseId = (baseRow?.value || "").trim();
        if (baseId) process.env.AIRTABLE_REVENUE_OPS_BASE_ID = baseId;
      }
      return true;
    }
  } catch {
    /* fall through — client.ts will surface the missing-PAT error */
  }
  return false;
}
