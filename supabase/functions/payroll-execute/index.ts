// payroll-execute
//
// The "Approve & Pay" core. Admin/VA-gated. Two actions:
//   action: "preview"  → review data for a period (per-cleaner lines + flags +
//                        totals). No money moves.
//   action: "execute"  → re-validate server-side, balance/env/payouts checks,
//                        then auto-fire every payable Stripe transfer in the
//                        period from this ONE call (idempotency key per line).
//
// All money math + Stripe calls happen server-side in the shared payroll
// engine; the client only sends the period and renders the per-line result.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { notifyDiscord } from "../_shared/discord.ts";
import { executePeriod, mondayOf, sundayOf } from "../_shared/payroll-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

// deno-lint-ignore no-explicit-any
type DB = any;

async function ensureAdminOrVa(admin: DB, jwt: string): Promise<string> {
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
  return u.user.id;
}

interface PreviewLine {
  runId: string;
  cleanerId: string;
  cleanerName: string;
  totalJobs: number;
  grossCents: number;
  bonusCents: number;
  deductionCents: number;
  netCents: number;
  status: string;
  paymentMethod: string;
  connectReady: boolean;
  flag: "payable" | "blocked" | "skip" | "done";
  flagReason?: string;
}

async function preview(admin: DB, period: string) {
  const { data: runs } = await admin
    .from("payroll_runs")
    .select("*")
    .eq("pay_period_start", period)
    .order("net_cents", { ascending: false });

  const cleanerIds = Array.from(new Set((runs || []).map((r: Record<string, unknown>) => String(r.cleaner_id))));
  const cmap = new Map<string, Record<string, unknown>>();
  if (cleanerIds.length > 0) {
    const { data: cs } = await admin
      .from("cleaners")
      .select("id, first_name, last_name, payment_method, stripe_account_id, payouts_enabled")
      .in("id", cleanerIds);
    for (const c of cs || []) cmap.set(String(c.id), c);
  }

  const lines: PreviewLine[] = (runs || []).map((r: Record<string, unknown>) => {
    const cid = String(r.cleaner_id);
    const c = cmap.get(cid) || {};
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner";
    const method = String(r.payment_method || c.payment_method || "stripe_connect");
    const stripeId = (r.stripe_connect_id as string) || (c.stripe_account_id as string) || null;
    const payoutsEnabled = !!c.payouts_enabled;
    const net = Number(r.net_cents) || 0;
    const status = String(r.status);
    const connectReady = method !== "stripe_connect" ? true : (!!stripeId && payoutsEnabled);

    let flag: PreviewLine["flag"] = "payable";
    let flagReason: string | undefined;
    if (["processing", "sent", "paid", "cleared"].includes(status)) {
      flag = "done";
    } else if (method === "stripe_connect" && !stripeId) {
      flag = "blocked"; flagReason = "No Stripe Connect account";
    } else if (method === "stripe_connect" && !payoutsEnabled) {
      flag = "blocked"; flagReason = "Payouts not enabled";
    } else if (net <= 0) {
      flag = "skip"; flagReason = "Net ≤ 0";
    }

    return {
      runId: String(r.id), cleanerId: cid, cleanerName: name,
      totalJobs: Number(r.total_jobs) || 0,
      grossCents: Number(r.gross_cents) || 0,
      bonusCents: Number(r.bonus_cents) || 0,
      deductionCents: Number(r.deduction_cents) || 0,
      netCents: net, status, paymentMethod: method, connectReady, flag, flagReason,
    };
  });

  const totals = lines.reduce(
    (a, l) => {
      if (l.flag === "payable") { a.payable += 1; a.netPayable += l.netCents; }
      else if (l.flag === "blocked") a.blocked += 1;
      else if (l.flag === "done") { a.done += 1; a.netDone += l.netCents; }
      return a;
    },
    { payable: 0, blocked: 0, done: 0, netPayable: 0, netDone: 0 },
  );

  return { period, periodEnd: sundayOf(period), lines, totals };
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
    const actor = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "preview");
    const period = mondayOf(String(body?.period || new Date().toISOString()));

    if (action === "preview") {
      return json({ success: true, ...(await preview(admin, period)) });
    }

    if (action === "execute") {
      const result = await executePeriod(admin, { period, actor });

      if (result.halted) {
        await notifyDiscord(admin, {
          title: "Payroll execution HALTED",
          color: 15158332,
          fields: [{ name: "Pay period", value: period, inline: true }],
          description: result.reason || "Halted before sending any transfers.",
        }).catch(() => undefined);
        return json({ success: false, ...result }, 409);
      }

      const t = result.totals;
      const failures = result.results.filter((r) => r.status === "failed");
      await notifyDiscord(admin, {
        title: "Payroll executed",
        color: t.failedCount > 0 ? 15844367 : 3066993,
        fields: [
          { name: "Pay period", value: period, inline: true },
          { name: "Paid", value: `${t.paidCount} (${usd(t.netPaidCents)})`, inline: true },
          { name: "Failed", value: String(t.failedCount), inline: true },
          { name: "Blocked", value: String(t.blocked), inline: true },
        ],
        description: failures.length
          ? "Failures:\n" + failures.map((f) => `• ${f.cleanerName}: ${f.reason || "error"}`).join("\n").slice(0, 1500)
          : "All payable cleaners paid.",
      }).catch(() => undefined);

      return json({ success: true, ...result });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[payroll-execute]", msg);
    return json({ error: msg }, 500);
  }
});
