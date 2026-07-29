// ─── admin-grant-credit ──────────────────────────────────────────────────
//
// Admin / VA endpoint to grant or remove dollar credit on a customer's
// customer_credits ledger. Grants go through the grant_customer_credit RPC;
// removals go through revoke_customer_credit_by_email, which marks the
// existing available rows revoked instead of stacking a negative offset row.
//
// Removals never email or text the customer. Grants notify by default; pass
// notify: false to grant quietly.
//
// POST body:
//   {
//     action: 'grant' | 'revoke',
//     customerId: uuid,                // customerId or email required
//     email?: string,
//     amountCents: integer,            // positive cents; ignored when all=true
//     all?: boolean,                   // revoke only — remove the whole balance
//     source?: 'referral'|'admin_grant'|'promo'|'refund_credit'|'perk'|'adjustment'
//                                       default: 'admin_grant' for grant,
//                                                'adjustment' for revoke
//     reason?: string,                 // mandatory for revoke
//     notify?: boolean,                // grant only, default true
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
  let customerId = body?.customerId as string | undefined;
  const customerEmail = body?.email ? String(body.email).trim() : "";
  const amountCentsRaw = Number(body?.amountCents);
  const revokeAll = action === "revoke" && body?.all === true;
  if (!["grant", "revoke"].includes(action)) return json({ error: "action must be grant|revoke" }, 400);
  // Accept a customerId OR an email (booking-tab grants pass the booking email,
  // which we resolve — or create — into a customers row below).
  if (!customerId && !customerEmail) return json({ error: "customerId or email required" }, 400);
  if (!revokeAll && (!Number.isFinite(amountCentsRaw) || amountCentsRaw <= 0)) {
    return json({ error: "amountCents must be a positive integer" }, 400);
  }
  if (action === "revoke" && !body?.reason) return json({ error: "reason required for revoke" }, 400);

  const amountCents = revokeAll ? 0 : Math.round(amountCentsRaw);

  // Normalize source to the set the grant_customer_credit RPC accepts. The admin
  // UI historically offered friendlier labels (service_recovery / goodwill /
  // referral_reward) that the RPC's CHECK rejected — silently failing every
  // grant. Map those to a valid source and fall back to admin_grant.
  const ALLOWED_SOURCES = ["referral", "admin_grant", "promo", "refund_credit", "perk", "adjustment"];
  const SOURCE_ALIASES: Record<string, string> = {
    service_recovery: "adjustment",
    goodwill: "perk",
    referral_reward: "referral",
    refund: "refund_credit",
    compensation: "adjustment",
  };
  let source = String(body?.source || (action === "grant" ? "admin_grant" : "adjustment"));
  if (!ALLOWED_SOURCES.includes(source)) {
    source = SOURCE_ALIASES[source] || (action === "grant" ? "admin_grant" : "adjustment");
  }

  try {
    // ─── Resolve (or create) the target customer ───────────────────────────
    let cust: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null = null;
    if (customerId) {
      const { data } = await adminClient
        .from("customers").select("id, first_name, last_name, email, phone").eq("id", customerId).maybeSingle();
      cust = data;
    }
    if (!cust && customerEmail) {
      const { data: byEmail } = await adminClient
        .from("customers").select("id, first_name, last_name, email, phone").ilike("email", customerEmail).limit(1);
      cust = byEmail?.[0] || null;
      // Create a minimal customer record if none exists for this email so the
      // credit has a home (credits are email-keyed, so this links cleanly).
      if (!cust && action === "grant") {
        const { data: created, error: createErr } = await adminClient
          .from("customers")
          .insert({
            email: customerEmail.toLowerCase(),
            first_name: body?.firstName || null,
            last_name: body?.lastName || null,
            phone: body?.phone || null,
          })
          .select("id, first_name, last_name, email, phone")
          .single();
        if (createErr) throw createErr;
        cust = created;
      }
    }
    if (!cust) return json({ error: "customer not found" }, 404);
    customerId = cust.id;
    const custName = `${cust.first_name || "customer"} ${cust.last_name || ""}`.trim();

    // Credits are email-keyed everywhere (balance, checkout spend), so the
    // wallet balance an admin sees is always the by-email one.
    const readBalance = async () => {
      if (cust!.email) {
        const { data } = await adminClient.rpc("get_customer_credit_balance_by_email", { _email: cust!.email });
        return data;
      }
      const { data } = await adminClient.rpc("get_customer_credit_balance", { _customer_id: customerId });
      return data;
    };

    // ─── Remove credit ─────────────────────────────────────────────────────
    // Marks the customer's available credit rows revoked (oldest expiry first,
    // splitting a row on a partial removal) rather than stacking a negative
    // offset row, which used to leave the balance negative once the credit it
    // offset expired. Silent by design: no email, no SMS.
    if (action === "revoke") {
      if (!cust.email) return json({ error: "customer has no email on file" }, 400);

      const { data: result, error: revokeErr } = await adminClient.rpc("revoke_customer_credit_by_email", {
        _email: cust.email,
        _amount_cents: revokeAll ? null : amountCents,
        _reason: String(body.reason),
        _revoked_by: uid,
      });
      if (revokeErr) throw revokeErr;

      const removedCents = Number((result as { revoked_cents?: number })?.revoked_cents || 0);
      const availableCents = Number((result as { balance_cents_before?: number })?.balance_cents_before || 0);
      if (removedCents === 0) {
        return json({
          error: availableCents <= 0
            ? "This customer has no credit left to remove."
            : `Could not remove credit — only $${(availableCents / 100).toFixed(2)} is available.`,
        }, 400);
      }

      const balance = await readBalance();
      await adminClient.from("events").insert({
        event_type: "credit.revoked",
        customer_id: customerId,
        source: "admin-grant-credit",
        summary: `Removed $${(removedCents / 100).toFixed(2)} credit — ${custName}`,
        data: { amount_cents: -removedCents, reason: body.reason, by: uid, balance, result },
      });

      return json({
        ok: true,
        removedCents,
        // Requesting more than the wallet holds removes what's there; say so.
        partial: !revokeAll && removedCents < amountCents,
        balance,
        emailSent: false,
        smsSent: false,
      });
    }

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

    const balance = await readBalance();

    await adminClient.from("events").insert({
      event_type: "credit.granted",
      customer_id: customerId,
      source: "admin-grant-credit",
      summary: `Granted $${(amountCents / 100).toFixed(2)} ${source} credit — ${custName}`,
      data: { amount_cents: amountCents, source, reason: body?.reason, by: uid, balance },
    });

    // ─── Notify the customer that credit was applied ───────────────────────
    // Best-effort email + SMS so the customer knows the credit is on their
    // account and will auto-apply at checkout. Removals never reach here.
    let emailSent = false;
    let smsSent = false;
    if (body?.notify !== false) {
      const first = cust.first_name || "there";
      const amountStr = `$${(amountCents / 100).toFixed(2)}`;
      const balanceCents = Number((balance as { balance_cents?: number })?.balance_cents || 0);
      const balanceStr = `$${(balanceCents / 100).toFixed(2)}`;
      const reasonLine = body?.reason ? String(body.reason) : "";

      if (cust.email) {
        try {
          const html = `
            <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
              <h2 style="margin:0 0 8px;font-size:20px">You've got Novara credit 🎉</h2>
              <p style="margin:0 0 16px;color:#475569">Hi ${first}, we've added account credit to your Novara Cleaning wallet.</p>
              <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">
                <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9">Credit added</div>
                <div style="font-size:32px;font-weight:800;color:#5b21b6;margin-top:4px">${amountStr}</div>
                <div style="font-size:12px;color:#6d28d9;margin-top:4px">Wallet balance: ${balanceStr}</div>
              </div>
              ${reasonLine ? `<p style="margin:0 0 12px;color:#475569;font-size:14px">${reasonLine}</p>` : ""}
              <p style="margin:0 0 16px;color:#475569;font-size:14px">It'll automatically apply at checkout on your next booking — nothing to do.</p>
              <a href="https://try.novaracleaning.com/book/zip" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Book your next clean</a>
              <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
            </div>`;
          const { error: emailErr } = await adminClient.functions.invoke("admin-send-email", {
            body: { to: cust.email, subject: `You've got ${amountStr} in Novara credit`, html },
          });
          emailSent = !emailErr;
        } catch (_) { /* best effort */ }
      }

      if (cust.phone) {
        try {
          const msg = `Novara Cleaning: Good news ${first}! We've added ${amountStr} credit to your account (balance ${balanceStr}). It'll auto-apply at checkout on your next booking.${reasonLine ? ` (${reasonLine})` : ""} Reply STOP to opt out.`;
          const { error: smsErr } = await adminClient.functions.invoke("send-ghl-sms", {
            body: { phone: cust.phone, email: cust.email || undefined, firstName: first, message: msg, type: "customer_credit_granted" },
          });
          smsSent = !smsErr;
        } catch (_) { /* best effort */ }
      }
    }

    return json({ ok: true, credit: inserted, balance, emailSent, smsSent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[admin-grant-credit]", message);
    return json({ error: message }, 500);
  }
});
