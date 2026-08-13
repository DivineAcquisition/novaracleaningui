// ─── pay-cleaner-transfer ───────────────────────────────────────────────────
//
// Sends an EXACT-amount Stripe Connect transfer to a single cleaner. Unlike
// process-payout (which computes the amount from the booking revenue × tier),
// this pays precisely the cents you pass in — so the Custom Payout / Extra Pay
// amount an admin confirms is the amount the contractor actually receives.
//
// Actions:
//   • (default) transfer — create the Connect transfer if platform funds
//     are available, then email the contractor + confirming admin
//     (CC contact@ + dispatch@).
//   • balance — return the platform Stripe available/pending USD balance.
//
// Safety:
//   • admin/VA JWT or internal CRON_SECRET / service-role auth
//   • refreshes the cleaner's live Stripe status before paying
//   • STRIPE_ENV guard (never fire a live transfer from a test key or vice-versa)
//   • platform available-balance check (halt if short — no transfer)
//   • idempotency key so a double-click / retry never double-pays
//   • $20k per-transfer fat-finger cap

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

const MAX_CENTS = 2_000_000; // $20k per-transfer ceiling
const PAYOUT_OPS_CC = ["contact@novaracleaning.com", "dispatch@novaracleaning.com"];

// deno-lint-ignore no-explicit-any
type DB = any;

async function authorize(admin: DB, req: Request): Promise<void> {
  const cronHeader = req.headers.get("x-cron-secret") || "";
  if (cronHeader) {
    const cronSecret = await resolveSecret(admin, "CRON_SECRET");
    if (cronSecret && cronHeader === cronSecret) return;
  }
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!auth) throw new Error("Not signed in.");
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

function envGuard(stripeEnv: string, key: string): string | null {
  const isLiveKey = key.startsWith("sk_live");
  const wantLive = stripeEnv.toLowerCase() === "live";
  if (wantLive && !isLiveKey) return "STRIPE_ENV=live but STRIPE_SECRET_KEY is a test key — halted.";
  if (!wantLive && isLiveKey) return `STRIPE_ENV=${stripeEnv} but STRIPE_SECRET_KEY is a LIVE key — halted to prevent an unintended live payout.`;
  return null;
}

function usdAvailable(bal: Stripe.Balance): number {
  return ((bal.available || []) as Array<{ amount: number; currency: string }>)
    .filter((b) => b.currency === "usd")
    .reduce((a, b) => a + (b.amount || 0), 0);
}

function usdPending(bal: Stripe.Balance): number {
  return ((bal.pending || []) as Array<{ amount: number; currency: string }>)
    .filter((b) => b.currency === "usd")
    .reduce((a, b) => a + (b.amount || 0), 0);
}

async function stripeClient(admin: DB): Promise<{ stripe: Stripe; stripeEnv: string }> {
  const key = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!key) throw Object.assign(new Error("STRIPE_SECRET_KEY not configured"), { status: 500 });
  const stripeEnv = (await resolveSecret(admin, "STRIPE_ENV")) || "test";
  const guardErr = envGuard(stripeEnv, key);
  if (guardErr) throw Object.assign(new Error(guardErr), { status: 409 });
  return { stripe: new Stripe(key, { apiVersion: "2025-08-27.basil" }), stripeEnv };
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
    const action = String(body?.action || "transfer").toLowerCase();

    const { stripe } = await stripeClient(admin);

    if (action === "balance") {
      const bal = await stripe.balance.retrieve();
      return json({
        ok: true,
        availableUsd: usdAvailable(bal),
        pendingUsd: usdPending(bal),
      });
    }

    const cleanerId = String(body?.cleanerId || "");
    const amountCents = Math.round(Number(body?.amountCents));
    const bookingId = body?.bookingId ? String(body.bookingId) : null;
    const label = body?.label ? String(body.label) : null;
    const bookingLabel = body?.bookingLabel ? String(body.bookingLabel) : label;
    const source = body?.source ? String(body.source) : "custom_payout";
    const sourceLabel = body?.sourceLabel ? String(body.sourceLabel) : (source === "extra_pay" ? "Extra Pay" : "Custom Payout");
    const idemFromCaller = body?.idempotencyKey ? String(body.idempotencyKey) : null;
    const notifyAdminEmail = body?.notifyAdminEmail ? String(body.notifyAdminEmail).trim() : "";

    if (!cleanerId) return json({ error: "cleanerId required" }, 400);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return json({ error: "amountCents must be greater than 0" }, 400);
    if (amountCents > MAX_CENTS) return json({ error: `Amount exceeds the $${(MAX_CENTS / 100).toLocaleString()} per-transfer cap` }, 400);

    const { data: cleaner } = await admin
      .from("cleaners")
      .select("id, first_name, last_name, email, phone, stripe_account_id, payouts_enabled, onboarding_complete, total_earnings_cents")
      .eq("id", cleanerId)
      .maybeSingle();
    if (!cleaner) return json({ error: "Cleaner not found" }, 404);

    let stripeAccountId = cleaner.stripe_account_id as string | null;
    let payoutsEnabled = !!cleaner.payouts_enabled;

    // Refresh live so a stale flag never blocks (or mis-routes) a real payout.
    if (stripeAccountId) {
      try {
        const acct = await stripe.accounts.retrieve(stripeAccountId);
        payoutsEnabled = !!acct.payouts_enabled;
        await admin.from("cleaners").update({
          payouts_enabled: payoutsEnabled,
          onboarding_complete: !!acct.details_submitted,
          updated_at: new Date().toISOString(),
        }).eq("id", cleanerId);
      } catch (e) {
        return json({ error: `Stripe account inaccessible — cleaner must re-onboard. (${e instanceof Error ? e.message : String(e)})` }, 400);
      }
    }

    if (!stripeAccountId) return json({ error: "Cleaner has no Stripe Connect account." }, 400);
    if (!payoutsEnabled) return json({ error: "Payouts not enabled on this cleaner's Stripe account." }, 400);

    let availableUsd = 0;
    try {
      const bal = await stripe.balance.retrieve();
      availableUsd = usdAvailable(bal);
    } catch (e) {
      return json({
        error: `Could not verify Stripe balance: ${e instanceof Error ? e.message : String(e)}. No transfer was sent.`,
      }, 409);
    }
    if (availableUsd < amountCents) {
      return json({
        error: `Insufficient Stripe balance: $${(availableUsd / 100).toFixed(2)} available, $${(amountCents / 100).toFixed(2)} needed. No transfer was sent.`,
        availableUsd,
        neededCents: amountCents,
      }, 409);
    }

    const cleanerName = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || "Cleaner";
    const idempotencyKey = idemFromCaller ||
      `manualpay_${bookingId || "nobk"}_${cleanerId}_${amountCents}`;

    let transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: amountCents,
          currency: "usd",
          destination: stripeAccountId,
          description: label || `Novara ${sourceLabel} — ${cleanerName}`,
          metadata: {
            cleaner_id: cleanerId,
            booking_id: bookingId || "",
            source,
          },
        },
        { idempotencyKey },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 502);
    }

    // Roll the cleaner's lifetime earnings forward (best-effort).
    await admin.from("cleaners")
      .update({ total_earnings_cents: (Number(cleaner.total_earnings_cents) || 0) + amountCents, updated_at: new Date().toISOString() })
      .eq("id", cleanerId)
      .then(() => undefined, () => undefined);

    // Notify the cleaner the money is on its way (best-effort).
    if (cleaner.phone) {
      try {
        await admin.functions.invoke("send-ghl-sms", {
          body: {
            phone: cleaner.phone,
            firstName: cleaner.first_name,
            message: `💸 Novara payout: $${(amountCents / 100).toFixed(2)} sent to your Stripe account. Thanks for the great work!`,
          },
        });
      } catch (_) { /* non-blocking */ }
    }

    let emailSent = false;
    try {
      const { error: mailErr } = await admin.functions.invoke("send-cleaner-email", {
        body: {
          type: "payout",
          email: cleaner.email || notifyAdminEmail || PAYOUT_OPS_CC[0],
          to: [cleaner.email, notifyAdminEmail].filter(Boolean),
          cc: PAYOUT_OPS_CC,
          data: {
            cleanerFirstName: cleaner.first_name || cleanerName.split(" ")[0] || "there",
            cleanerFullName: cleanerName,
            bookingId: bookingId || "",
            bookingLabel: bookingLabel || label || "your recent job",
            amount: amountCents,
            transferId: transfer.id,
            transferDate: new Date().toISOString(),
            sourceLabel,
          },
        },
      });
      emailSent = !mailErr;
    } catch (_) { /* non-blocking */ }

    return json({
      success: true,
      transferId: transfer.id,
      amountCents,
      cleanerName,
      availableUsdAfter: availableUsd - amountCents,
      emailSent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number })?.status || (msg.includes("signed in") || msg.includes("only") ? 401 : 500);
    console.error("[pay-cleaner-transfer]", msg);
    return json({ error: msg }, status);
  }
});
