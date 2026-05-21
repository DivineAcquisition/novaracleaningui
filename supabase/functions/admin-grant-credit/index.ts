// ─── admin-grant-credit ──────────────────────────────────────────────────
//
// Admin / VA endpoint to grant (or revoke) a dollar credit on a
// customer's customer_credits ledger. Always writes via the
// grant_customer_credit RPC.
//
// POST body:
//   {
//     action: 'grant' | 'revoke',
//     customerId: uuid,
//     amountCents: integer,           // positive cents (revoke flips sign)
//     source?: 'referral'|'admin_grant'|'promo'|'refund_credit'|'perk'|'adjustment'
//                                       default: 'admin_grant' for grant,
//                                                'adjustment' for revoke
//     reason?: string,                 // mandatory for revoke
//     expiresAt?: ISO timestamp,       // grant only
//     bookingId?: uuid                 // optional link
//   }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function callerId(adminClient: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: user, error } = await userClient.auth.getUser();
  if (error || !user?.user) throw new Error("unauthorized");
  const { data: roles } = await adminClient.from("user_roles").select("role").eq("user_id", user.user.id);
  const allowed = (roles || []).some((r: any) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("forbidden");
  return user.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let uid: string;
  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing bearer" }, 401);
    uid = await callerId(adminClient, jwt);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  const action = body?.action;
  const customerId = body?.customerId;
  const amountCentsRaw = Number(body?.amountCents);
  if (!["grant", "revoke"].includes(action)) return json({ error: "action must be grant|revoke" }, 400);
  if (!customerId) return json({ error: "customerId required" }, 400);
  if (!Number.isFinite(amountCentsRaw) || amountCentsRaw <= 0) {
    return json({ error: "amountCents must be a positive integer" }, 400);
  }
  if (action === "revoke" && !body?.reason) return json({ error: "reason required for revoke" }, 400);

  const amountCents = action === "grant" ? Math.round(amountCentsRaw) : -Math.round(amountCentsRaw);
  const source = body?.source || (action === "grant" ? "admin_grant" : "adjustment");

  try {
    const { data: cust } = await adminClient
      .from("customers").select("id, first_name, last_name, email").eq("id", customerId).maybeSingle();
    if (!cust) return json({ error: "customer not found" }, 404);

    const { data: inserted, error } = await adminClient.rpc("grant_customer_credit", {
      _customer_id: customerId,
      _amount_cents: amountCents,
      _source: source,
      _reason: body?.reason || null,
      _granted_by: uid,
      _expires_at: body?.expiresAt || null,
      _referral_id: body?.referralId || null,
      _booking_id: body?.bookingId || null,
    });
    if (error) throw error;

    const { data: balance } = await adminClient.rpc("get_customer_credit_balance", { _customer_id: customerId });

    await adminClient.from("events").insert({
      event_type: action === "grant" ? "credit.granted" : "credit.revoked",
      customer_id: customerId,
      source: "admin-grant-credit",
      summary: `${action === "grant" ? "Granted" : "Revoked"} $${(Math.abs(amountCents) / 100).toFixed(2)} ${source} credit — ${cust.first_name || "customer"} ${cust.last_name || ""}`.trim(),
      data: { amount_cents: amountCents, source, reason: body?.reason, by: uid, balance },
    });

    return json({ ok: true, credit: inserted, balance });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin-grant-credit]", message);
    return json({ error: message }, 500);
  }
});
