// airtable-sync
//
// Admin/VA-gated utility for the Airtable insight mirror:
//   • action: "test"             → validate credentials + table access
//   • action: "backfill_jobs"    → push recent bookings into the Jobs table
//   • action: "backfill_payroll" → push payouts into the Payroll table
//   • action: "backfill_all"     → both
//
// Day-to-day syncing is automatic (send-zapier-webhook mirrors job data on
// every booking lifecycle event; process-payout mirrors payroll). This
// function is for the initial seed + a connection check from the admin UI.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import {
  airtablePing,
  syncJobToAirtable,
  syncPayoutToAirtable,
} from "../_shared/airtable.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
}

// Run async tasks with a small concurrency cap to respect Airtable rate limits.
async function runPooled<T>(items: T[], worker: (item: T) => Promise<boolean>, size = 3): Promise<number> {
  let ok = 0;
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const results = await Promise.all(batch.map(worker));
    ok += results.filter(Boolean).length;
    // Gentle pacing: Airtable allows 5 req/s per base.
    await new Promise((r) => setTimeout(r, 250));
  }
  return ok;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "test");
    const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 1000);

    if (action === "test") {
      const ping = await airtablePing(admin);
      return json(ping, ping.ok ? 200 : 400);
    }

    const result: Record<string, unknown> = {};

    if (action === "backfill_jobs" || action === "backfill_all") {
      const { data: bookings } = await admin
        .from("bookings")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(limit);
      const ids = (bookings || []).map((b: { id: string }) => b.id);
      const ok = await runPooled(ids, (id) => syncJobToAirtable(admin, id));
      result.jobs = { attempted: ids.length, synced: ok };
    }

    if (action === "backfill_payroll" || action === "backfill_all") {
      const { data: payouts } = await admin
        .from("payouts")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(limit);
      const ids = (payouts || []).map((p: { id: string }) => p.id);
      const ok = await runPooled(ids, (id) => syncPayoutToAirtable(admin, id));
      result.payroll = { attempted: ids.length, synced: ok };
    }

    if (Object.keys(result).length === 0) {
      return json({ error: `Unknown action: ${action}` }, 400);
    }
    return json({ success: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[airtable-sync]", msg);
    return json({ error: msg }, 500);
  }
});
