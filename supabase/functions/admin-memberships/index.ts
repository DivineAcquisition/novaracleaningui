// admin-memberships
//
// Admin/VA membership management hub API (powers /admin/recurring).
//
// Actions:
//   { }                                → list members (membership_credits
//     joined with customer contact info + linked recurring schedule)
//   { action:'pause',  subscriptionId, resumeAt? } → pause Stripe billing
//   { action:'resume', subscriptionId }            → resume Stripe billing
//   { action:'cancel', subscriptionId }            → cancel at period end
//
// All actions are audited to public.events (internal Discord routing
// ignores unknown event types unless routed).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list").toLowerCase();

    // ─── Stripe subscription controls ────────────────────────────────────
    if (action === "pause" || action === "resume" || action === "cancel") {
      const subscriptionId = String(body?.subscriptionId || "");
      if (!subscriptionId) return json({ error: "subscriptionId required" }, 400);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      let summary = "";
      if (action === "pause") {
        // deno-lint-ignore no-explicit-any
        const pauseConfig: any = { behavior: "mark_uncollectible" };
        if (body?.resumeAt) {
          pauseConfig.resumes_at = Math.floor(new Date(String(body.resumeAt)).getTime() / 1000);
        }
        await stripe.subscriptions.update(subscriptionId, { pause_collection: pauseConfig });
        summary = `Membership ${subscriptionId} paused by admin${body?.resumeAt ? ` until ${body.resumeAt}` : ""}`;
      } else if (action === "resume") {
        await stripe.subscriptions.update(subscriptionId, { pause_collection: null });
        summary = `Membership ${subscriptionId} resumed by admin`;
      } else {
        await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
        summary = `Membership ${subscriptionId} set to cancel at period end by admin`;
      }

      await admin.from("events").insert({
        event_type: "membership.admin_action",
        source: "admin-memberships",
        summary,
        data: { action, subscription_id: subscriptionId, by: callerId },
      }).catch(() => {});

      return json({ ok: true, action, subscriptionId });
    }

    // ─── List members ─────────────────────────────────────────────────────
    const { data: credits } = await admin
      .from("membership_credits")
      .select("*")
      .order("current_period_end", { ascending: false })
      .limit(500);

    const rows = (credits || []) as Record<string, unknown>[];
    const emails = Array.from(new Set(rows.map((r) => String(r.email || "").toLowerCase()).filter(Boolean)));

    const customersByEmail = new Map<string, Record<string, unknown>>();
    if (emails.length > 0) {
      const { data: customers } = await admin
        .from("customers")
        .select("email, first_name, last_name, phone, city, state")
        .in("email", emails);
      for (const c of customers || []) {
        customersByEmail.set(String(c.email).toLowerCase(), c);
      }
    }

    const schedulesByEmail = new Map<string, Record<string, unknown>[]>();
    if (emails.length > 0) {
      const { data: schedules } = await admin
        .from("customer_recurring_schedules")
        .select("id, email, cadence, active, next_service_date, preferred_cleaner_id, price_cents")
        .in("email", emails);
      for (const s of schedules || []) {
        const key = String(s.email).toLowerCase();
        const list = schedulesByEmail.get(key) || [];
        list.push(s);
        schedulesByEmail.set(key, list);
      }
    }

    const lastBookingByEmail = new Map<string, Record<string, unknown>>();
    if (emails.length > 0) {
      const { data: recentBookings } = await admin
        .from("bookings")
        .select("email, service_date, status")
        .in("email", emails)
        .order("service_date", { ascending: false })
        .limit(1000);
      for (const b of recentBookings || []) {
        const key = String(b.email || "").toLowerCase();
        if (!lastBookingByEmail.has(key)) lastBookingByEmail.set(key, b);
      }
    }

    const members = rows.map((r) => {
      const email = String(r.email || "").toLowerCase();
      const customer = customersByEmail.get(email) || null;
      return {
        ...r,
        customer,
        schedules: schedulesByEmail.get(email) || [],
        last_booking: lastBookingByEmail.get(email) || null,
        period_active: r.current_period_end ? new Date(String(r.current_period_end)).getTime() > Date.now() : false,
      };
    });

    return json({ ok: true, members });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-memberships]", msg);
    return json({ error: msg }, 500);
  }
});
