// ─── commercial-proposal-sweep ─────────────────────────────────────────────
//
// Hourly (:40). Four passes, each closing a way a commercial deal quietly
// stops moving:
//
//   1. EXPIRE       proposals past their window. A proposal that never lapses
//                   is a price we are still honouring a year later, and a live
//                   link nobody is tracking.
//   2. REMIND       proposals about to lapse — once, a few days out, to the
//                   recipient and the owner. An unopened proposal and an
//                   unanswered one need different follow-ups, so the reminder
//                   says which it is.
//   3. STALLED      accounts that signed but never finished billing setup.
//                   These are the expensive ones: the client believes they are
//                   a customer and nothing can be dispatched.
//   4. COMPANY COI  our own certificate approaching expiry, and any client
//                   holding a copy that is about to go stale.
//
// Everything lands on the events bus, which routes to Discord. Nothing here
// writes a status a human then has to interpret.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (s: string, d?: unknown) =>
  console.log(`[commercial-proposal-sweep] ${s}${d ? " " + JSON.stringify(d) : ""}`);

type SB = SupabaseClient;

const money = (cents: number) =>
  `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dayList = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
};

async function setting(admin: SB, key: string, fallback: number): Promise<number> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "commercial_proposal_settings")
    .maybeSingle();
  const raw = (data?.value || {}) as Record<string, unknown>;
  const n = Number(raw[key]);
  return Number.isFinite(n) ? n : fallback;
}

async function emailOut(admin: SB, to: string, subject: string, html: string): Promise<boolean> {
  const { error } = await admin.functions.invoke("admin-send-email", { body: { to, subject, html } });
  if (error) log("email failed", { to, error: error.message });
  return !error;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const result = { expired: 0, reminded: 0, stalled: 0, coiWarnings: 0 };

  try {
    // ── 1. Expire ────────────────────────────────────────────────────────
    // The rule lives in SQL so it is one statement and stays true whether or
    // not this function is deployed.
    const { data: expiredCount, error: expireErr } = await admin.rpc(
      "expire_stale_commercial_proposals",
    );
    if (expireErr) log("expire failed", { error: expireErr.message });
    else result.expired = Number(expiredCount) || 0;

    // ── 2. Remind before it lapses ───────────────────────────────────────
    const reminderDays = await setting(admin, "proposal_reminder_days", 3);
    const horizon = new Date(Date.now() + reminderDays * 86_400_000).toISOString();

    const { data: expiring } = await admin
      .from("commercial_proposals")
      .select(
        "id, business_account_id, version, recipient_name, recipient_email, sent_to, " +
          "expires_at, first_viewed_at, total_per_visit_cents, assigned_to_email, token",
      )
      .eq("status", "sent")
      .not("expires_at", "is", null)
      .lt("expires_at", horizon)
      .gt("expires_at", new Date().toISOString());

    for (const raw of expiring || []) {
      const p = raw as unknown as Record<string, unknown>;
      // Once per proposal. A daily nudge on a commercial proposal reads as
      // desperation and is the fastest way to have the thread muted.
      const { count } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "commercial.proposal.expiring")
        .contains("data", { proposal_id: p.id });
      if ((count || 0) > 0) continue;

      const { data: account } = await admin
        .from("business_accounts")
        .select("business_name, assigned_va_email")
        .eq("id", p.business_account_id as string)
        .maybeSingle();
      const business = (account as { business_name?: string } | null)?.business_name || "the account";
      const days = dayList(p.expires_at as string);
      const opened = Boolean(p.first_viewed_at);

      const to = (p.sent_to as string) || (p.recipient_email as string) || "";
      if (to && p.token) {
        await emailOut(
          admin,
          to,
          `Your cleaning proposal for ${business} expires soon`,
          [
            `<p>Hi ${(p.recipient_name as string) || "there"},</p>`,
            `<p>Your proposal for <strong>${business}</strong> is open for ${days} more day${days === 1 ? "" : "s"}.</p>`,
            `<p><a href="https://commercial.novaracleaning.com/proposal/${String(p.token)}">Review the proposal</a></p>`,
            `<p>If the pricing or scope needs adjusting, use "Request changes" on the page and we'll send a revised version — no need to start over.</p>`,
            `<p>— Novara Cleaning</p>`,
          ].join(""),
        );
      }

      const owner =
        (p.assigned_to_email as string) ||
        (account as { assigned_va_email?: string } | null)?.assigned_va_email ||
        "";
      if (owner) {
        await emailOut(
          admin,
          owner,
          `Proposal expiring — ${business} (v${p.version})`,
          [
            `<p>Proposal v${p.version} for <strong>${business}</strong> (${money(Number(p.total_per_visit_cents || 0))} per visit) expires in ${days} day${days === 1 ? "" : "s"}.</p>`,
            opened
              ? `<p>They've opened it but haven't responded. That's usually a question they haven't asked — worth a call.</p>`
              : `<p><strong>They've never opened it.</strong> Check the address, or reach them another way before it lapses.</p>`,
          ].join(""),
        );
      }

      await admin.from("events").insert({
        event_type: "commercial.proposal.expiring",
        source: "commercial-proposal-sweep",
        summary:
          `Proposal v${p.version} for ${business} expires in ${days} day(s) — ` +
          (opened ? "opened, no response yet." : "never opened."),
        data: {
          proposal_id: p.id,
          account_id: p.business_account_id,
          version: p.version,
          days_remaining: days,
          opened,
        },
      });
      result.reminded += 1;
    }

    // ── 3. Signed but not billable ───────────────────────────────────────
    // The client thinks they're a customer. Nothing can be dispatched.
    const { data: stalled } = await admin
      .from("commercial_deal_pipeline_v1")
      .select("account_id, business_name, agreement_signed_at, assigned_va_email, billing_method")
      .eq("stage", "billing_pending")
      .limit(200);

    for (const raw of stalled || []) {
      const d = raw as unknown as Record<string, unknown>;
      const signedDaysAgo = d.agreement_signed_at
        ? Math.floor((Date.now() - new Date(String(d.agreement_signed_at)).getTime()) / 86_400_000)
        : 0;
      // Give it a day before shouting — most signers finish billing in the
      // same session, and an alert fired minutes after signature is noise.
      if (signedDaysAgo < 1) continue;

      const { count } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "commercial.billing.stalled")
        .contains("data", { account_id: d.account_id })
        .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
      if ((count || 0) > 0) continue;

      await admin.from("events").insert({
        event_type: "commercial.billing.stalled",
        source: "commercial-proposal-sweep",
        summary:
          `${String(d.business_name)} signed ${signedDaysAgo} day(s) ago but billing is still not configured — ` +
          `nothing can be dispatched for them until it is.`,
        data: {
          account_id: d.account_id,
          signed_days_ago: signedDaysAgo,
          billing_method: d.billing_method,
        },
      });
      result.stalled += 1;
    }

    // ── 4. Our own certificate ───────────────────────────────────────────
    const warnDays = await setting(admin, "company_coi_warn_days", 30);
    const { data: certs } = await admin
      .from("company_coi_documents")
      .select("id, expiration_date, carrier, policy_number, business_account_id")
      .eq("lifecycle", "current");

    for (const raw of certs || []) {
      const c = raw as unknown as Record<string, unknown>;
      const days = c.expiration_date
        ? Math.ceil(
          (new Date(`${String(c.expiration_date)}T23:59:59Z`).getTime() - Date.now()) / 86_400_000,
        )
        : null;
      if (days == null || days > warnDays) continue;

      const { count } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "company_coi.expiring")
        .contains("data", { document_id: c.id })
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
      if ((count || 0) > 0) continue;

      // Who is holding a copy that is about to be stale. Renewing without
      // re-sending leaves every one of them with an out-of-date certificate
      // in their vendor file.
      const { count: holders } = await admin
        .from("company_coi_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("company_coi_document_id", c.id)
        .eq("status", "sent");

      await admin.from("events").insert({
        event_type: "company_coi.expiring",
        source: "commercial-proposal-sweep",
        summary:
          days < 0
            ? `OUR certificate of insurance EXPIRED ${Math.abs(days)} day(s) ago (${String(c.carrier || "carrier unknown")}). ` +
              `${holders || 0} client(s) are holding an expired copy and new signings cannot be sent one.`
            : `OUR certificate of insurance expires in ${days} day(s) (${String(c.carrier || "carrier unknown")}). ` +
              `${holders || 0} client(s) will need the renewal once it's issued.`,
        data: {
          document_id: c.id,
          days_remaining: days,
          carrier: c.carrier,
          policy_number: c.policy_number,
          clients_holding: holders || 0,
          account_specific: c.business_account_id || null,
        },
      });
      result.coiWarnings += 1;
    }

    log("done", result);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    log("unhandled", { error: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
