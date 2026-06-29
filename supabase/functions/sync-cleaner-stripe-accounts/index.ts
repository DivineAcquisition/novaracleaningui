// ─── sync-cleaner-stripe-accounts ───────────────────────────────────────────
//
// The "true sync" between Stripe Connect and payroll. For each cleaner with a
// Stripe Connect account this retrieves the LIVE account from Stripe and writes
// the real readiness back onto the cleaners row:
//   • payouts_enabled    ← account.payouts_enabled
//   • onboarding_complete ← account.details_submitted
//   • status             → 'active' once details are submitted
//   • activated_at       → stamped on first completion
//
// Why this exists: payroll-execute / payroll-engine decide who is payable from
// cleaners.payouts_enabled + stripe_account_id. Those flags only updated via
// the per-cleaner dashboard check or a Connect `account.updated` webhook, so
// they drift — a cleaner finishes Stripe onboarding but the DB still says
// payouts_enabled=false, and "Run payroll" wrongly blocks them. The Auto
// Payroll screen calls this on load (and on demand) so the run always reflects
// Stripe reality.
//
// Accounts the platform key can no longer access (deleted / disconnected /
// created under a different platform) are reported as `accessible:false` and
// forced to not-payable so we never try to transfer into a dead account — the
// cleaner needs to re-onboard.
//
// Auth: admin/VA JWT, or an internal service-role call (Authorization = the
// service-role key) so other functions can refresh before paying.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type DB = any;

async function authorize(admin: DB, req: Request): Promise<void> {
  // Internal callers (cron / other edge functions) may present the shared
  // CRON_SECRET instead of a user JWT.
  const cronHeader = req.headers.get("x-cron-secret") || "";
  if (cronHeader) {
    const cronSecret = await resolveSecret(admin, "CRON_SECRET");
    if (cronSecret && cronHeader === cronSecret) return;
  }

  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) throw new Error("Not signed in.");
  // Internal service-role caller (other edge functions) — allow.
  if (auth === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "")) return;
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${auth}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  if (!(roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role))) {
    throw new Error("Admins or VAs only.");
  }
}

// A Stripe error that means "this account is gone / not ours anymore".
function isInaccessible(msg: string): boolean {
  return /no such account|does not exist|does not have access|application access|revoked|permitted to act/i.test(msg);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await authorize(admin, req);

    const body = await req.json().catch(() => ({}));
    const cleanerIds: string[] | undefined = Array.isArray(body?.cleanerIds) ? body.cleanerIds.map(String) : undefined;
    const includeInactive = body?.includeInactive === true;

    // Resolve which cleaners to sync.
    let q = admin
      .from("cleaners")
      .select("id, first_name, last_name, stripe_account_id, payouts_enabled, onboarding_complete, status, activated_at, payment_method");
    if (cleanerIds && cleanerIds.length > 0) {
      q = q.in("id", cleanerIds);
    } else {
      q = q.not("stripe_account_id", "is", null);
      if (!includeInactive) q = q.eq("status", "active");
    }
    const { data: cleaners, error: cErr } = await q;
    if (cErr) throw cErr;

    const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
    if (!key) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
    const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

    const results: Array<Record<string, unknown>> = [];
    let readyCount = 0, changedCount = 0;

    for (const c of cleaners || []) {
      const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner";
      const acct = c.stripe_account_id as string | null;

      if (!acct) {
        if (c.payouts_enabled) {
          await admin.from("cleaners").update({ payouts_enabled: false, updated_at: new Date().toISOString() }).eq("id", c.id);
          changedCount++;
        }
        results.push({ cleanerId: c.id, name, accessible: false, ready: false, payouts_enabled: false, onboarding_complete: !!c.onboarding_complete, reason: "No Stripe Connect account" });
        continue;
      }

      try {
        const a = await stripe.accounts.retrieve(acct);
        const payouts = !!a.payouts_enabled;
        const submitted = !!a.details_submitted;
        const chargesEnabled = !!a.charges_enabled;
        const reqDue = (a.requirements?.currently_due || []) as string[];

        const upd: Record<string, unknown> = {
          payouts_enabled: payouts,
          onboarding_complete: submitted,
          updated_at: new Date().toISOString(),
        };
        if (submitted && c.status !== "active") upd.status = "active";
        if (submitted && !c.activated_at) upd.activated_at = new Date().toISOString();

        const changed = payouts !== !!c.payouts_enabled || submitted !== !!c.onboarding_complete;
        await admin.from("cleaners").update(upd).eq("id", c.id);
        if (changed) changedCount++;
        if (payouts) readyCount++;

        results.push({
          cleanerId: c.id, name, stripeAccountId: acct, accessible: true,
          payouts_enabled: payouts, onboarding_complete: submitted, charges_enabled: chargesEnabled,
          ready: payouts, requirementsDue: reqDue.slice(0, 8),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const gone = isInaccessible(msg);
        // Force not-payable so payroll never tries to transfer into a dead
        // account. Only clear onboarding_complete when the account is truly
        // gone (so a transient Stripe blip doesn't flip a good cleaner).
        const upd: Record<string, unknown> = { payouts_enabled: false, updated_at: new Date().toISOString() };
        if (gone) upd.onboarding_complete = false;
        await admin.from("cleaners").update(upd).eq("id", c.id);
        if (c.payouts_enabled) changedCount++;
        results.push({
          cleanerId: c.id, name, stripeAccountId: acct, accessible: false, ready: false,
          payouts_enabled: false, onboarding_complete: gone ? false : !!c.onboarding_complete,
          reason: gone ? "Stripe account inaccessible — cleaner must re-onboard" : `Stripe error: ${msg}`,
        });
      }
    }

    return json({
      success: true,
      synced: results.length,
      readyCount,
      changedCount,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sync-cleaner-stripe-accounts]", msg);
    return json({ error: msg }, 500);
  }
});
