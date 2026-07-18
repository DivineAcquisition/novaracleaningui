// admin-memberships
//
// Admin/VA membership management hub API (powers /admin/recurring).
//
// The member list is a UNION of every signal that someone is a recurring
// client — NOT just Stripe subscriptions — so clients on a bi-weekly plan
// without a Stripe membership (e.g. schedules created by admins) still
// show up:
//   1. membership_credits           (Stripe Glow subscriptions)
//   2. customer_recurring_schedules (recurring clean plans)
//   3. recent bookings with a membership_plan stamped
//
// Actions:
//   { }                                → list members
//   { action:'pause',  subscriptionId, resumeAt? } → pause Stripe billing
//   { action:'resume', subscriptionId }            → resume Stripe billing
//   { action:'cancel', subscriptionId }            → cancel at period end
//   { action:'adjust_price', subscriptionId, monthlyPriceCents }
//                                      → set Glow monthly price on Stripe + membership_credits
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

    // ─── Cancel (notify customer) / Delete (silent) ─────────────────────
    // Cancel  → stop the recurring plan, cancel Stripe billing at period end,
    //           and NOTIFY the customer (email + SMS).
    // Delete  → remove the plan entirely (schedules + Stripe now + credit
    //           ledger) with NO customer notification. Mirrors the
    //           adjust/control actions on the bookings tab.
    if (action === "cancel" || action === "delete") {
      const email = String(body?.email || "").toLowerCase().trim();
      const subscriptionId = String(body?.subscriptionId || "");
      const scheduleIds: string[] = Array.isArray(body?.scheduleIds)
        ? (body.scheduleIds as unknown[]).map((s) => String(s))
        : [];
      if (!email && !subscriptionId && scheduleIds.length === 0) {
        return json({ error: "email, subscriptionId, or scheduleIds required" }, 400);
      }
      const notify = action === "cancel";
      const phone = body?.phone ? String(body.phone) : "";
      const name = body?.name ? String(body.name) : "";
      const plan = body?.plan ? String(body.plan) : "membership";

      // Stripe: cancel-at-period-end for a notified cancel; cancel-now for delete.
      let stripeResult: string | null = null;
      if (subscriptionId) {
        const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
        if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        try {
          if (action === "delete") {
            await stripe.subscriptions.cancel(subscriptionId);
            stripeResult = "cancelled_now";
          } else {
            await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
            stripeResult = "cancel_at_period_end";
          }
        } catch (e) {
          console.error("[admin-memberships] stripe cancel failed", e);
          stripeResult = "stripe_error";
        }
      }

      // Recurring schedules: deactivate (cancel) or hard-delete (delete).
      let schedulesAffected = 0;
      const applyToSchedules = async (builder: any) => {
        if (scheduleIds.length > 0) return builder.in("id", scheduleIds);
        if (email) return builder.eq("email", email);
        return null;
      };
      if (email || scheduleIds.length > 0) {
        if (action === "delete") {
          const q = await applyToSchedules(
            admin.from("customer_recurring_schedules").delete(),
          );
          if (q) {
            const { data: del } = await q.select("id");
            schedulesAffected = (del || []).length;
          }
        } else {
          const q = await applyToSchedules(
            admin.from("customer_recurring_schedules").update({
              active: false,
              next_service_date: null,
              updated_at: new Date().toISOString(),
            }),
          );
          if (q) {
            const { data: upd } = await q.select("id");
            schedulesAffected = (upd || []).length;
          }
        }
      }

      // Delete also purges the Stripe credit ledger AND clears the membership
      // tag on the customer's bookings so the member fully disappears from the
      // hub. The member list unions plan-stamped bookings, so without this a
      // "deleted" member kept reappearing. Booking history is preserved — only
      // the membership_plan tag is cleared. Cancel keeps history intact.
      if (action === "delete") {
        if (subscriptionId) {
          await admin.from("membership_credits").delete().eq("subscription_id", subscriptionId);
        }
        if (email) {
          await admin.from("membership_credits").delete().eq("email", email);
          await admin
            .from("bookings")
            .update({ membership_plan: null })
            .eq("email", email)
            .not("membership_plan", "is", null);
        }
      }

      // Notify the customer on Cancel only.
      let emailed = false;
      let smsSent = false;
      if (notify && email) {
        try {
          await admin.functions.invoke("send-membership-email", {
            body: { type: "subscription_cancelled", email, data: { name: name || "there", plan } },
          });
          emailed = true;
        } catch (e) {
          console.error("[admin-memberships] cancel email failed", e);
        }
        if (phone) {
          try {
            const firstName = name ? name.split(/\s+/)[0] : "there";
            const { error } = await admin.functions.invoke("send-ghl-sms", {
              body: {
                phone,
                type: "confirmation",
                message:
                  `Hi ${firstName}, your Novara ${plan} membership has been cancelled and no further ` +
                  `recurring cleans will be scheduled. Questions? Call (844) 735-2070.`,
              },
            });
            smsSent = !error;
          } catch (e) {
            console.error("[admin-memberships] cancel sms failed", e);
          }
        }
      }

      await admin.from("events").insert({
        event_type: action === "delete" ? "membership.deleted" : "membership.cancelled",
        source: "admin-memberships",
        summary:
          action === "delete"
            ? `Membership deleted (silent) for ${email || subscriptionId} by admin`
            : `Membership cancelled + customer notified for ${email || subscriptionId} by admin`,
        data: {
          action,
          email: email || null,
          subscription_id: subscriptionId || null,
          by: callerId,
          stripe_result: stripeResult,
          schedules_affected: schedulesAffected,
          emailed,
          sms_sent: smsSent,
        },
      }).then(() => undefined, () => undefined);

      return json({
        ok: true,
        action,
        email: email || null,
        subscriptionId: subscriptionId || null,
        stripeResult,
        schedulesAffected,
        emailed,
        smsSent,
      });
    }

    // ─── Stripe subscription controls ────────────────────────────────────
    if (action === "pause" || action === "resume" || action === "adjust_price") {
      const subscriptionId = String(body?.subscriptionId || "");
      if (!subscriptionId) return json({ error: "subscriptionId required" }, 400);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      let summary = "";
      let responseExtra: Record<string, unknown> = {};

      if (action === "adjust_price") {
        const monthlyPriceCents = Math.round(Number(body?.monthlyPriceCents));
        if (!Number.isFinite(monthlyPriceCents) || monthlyPriceCents < 100) {
          return json({ error: "monthlyPriceCents must be at least 100 ($1.00)" }, 400);
        }

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const item = sub.items?.data?.[0];
        if (!item?.id || !item.price?.product) {
          return json({ error: "Subscription has no billable item to reprice" }, 400);
        }
        const productId = typeof item.price.product === "string"
          ? item.price.product
          : item.price.product.id;

        const newPrice = await stripe.prices.create({
          product: productId,
          unit_amount: monthlyPriceCents,
          currency: item.price.currency || "usd",
          recurring: {
            interval: item.price.recurring?.interval || "month",
            interval_count: item.price.recurring?.interval_count || 1,
          },
          nickname: `Novara Glow override $${(monthlyPriceCents / 100).toFixed(2)}/mo`,
          metadata: {
            source: "admin-memberships.adjust_price",
            previous_price: item.price.id,
            subscription_id: subscriptionId,
          },
        });

        await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: item.id, price: newPrice.id }],
          proration_behavior: body?.prorate === false ? "none" : "create_prorations",
          metadata: {
            ...(sub.metadata || {}),
            monthly_price_cents: String(monthlyPriceCents),
            price_override_applied: "true",
          },
        });

        await admin
          .from("membership_credits")
          .update({ monthly_price_cents: monthlyPriceCents })
          .eq("subscription_id", subscriptionId);

        summary = `Membership ${subscriptionId} monthly price set to $${(monthlyPriceCents / 100).toFixed(2)} by admin`;
        responseExtra = { monthlyPriceCents, priceId: newPrice.id };
      } else if (action === "pause") {
        // deno-lint-ignore no-explicit-any
        const pauseConfig: any = { behavior: "mark_uncollectible" };
        if (body?.resumeAt) {
          pauseConfig.resumes_at = Math.floor(new Date(String(body.resumeAt)).getTime() / 1000);
        }
        await stripe.subscriptions.update(subscriptionId, { pause_collection: pauseConfig });
        summary = `Membership ${subscriptionId} paused by admin${body?.resumeAt ? ` until ${body.resumeAt}` : ""}`;
      } else {
        // resume
        await stripe.subscriptions.update(subscriptionId, { pause_collection: null });
        summary = `Membership ${subscriptionId} resumed by admin`;
      }

      await admin.from("events").insert({
        event_type: "membership.admin_action",
        source: "admin-memberships",
        summary,
        data: {
          action,
          subscription_id: subscriptionId,
          by: callerId,
          ...responseExtra,
        },
      }).then(() => undefined, () => undefined);

      return json({ ok: true, action, subscriptionId, ...responseExtra });
    }

    // ─── List members (union of every recurring-client signal) ───────────
    const [{ data: credits }, { data: allSchedules }, { data: planBookings }] = await Promise.all([
      admin.from("membership_credits").select("*").order("current_period_end", { ascending: false }).limit(500),
      admin.from("customer_recurring_schedules").select("*").order("created_at", { ascending: false }).limit(500),
      admin.from("bookings")
        .select("email, first_name, last_name, phone, membership_plan, service_date, status")
        .not("membership_plan", "is", null)
        .neq("membership_plan", "none")
        .order("service_date", { ascending: false })
        .limit(500),
    ]);

    // Group by email. Stripe rows win as the base record; schedule-only and
    // plan-booking-only clients are synthesized so nobody is invisible.
    type MemberEntry = Record<string, unknown> & {
      email: string;
      sources: string[];
      schedules: Record<string, unknown>[];
    };
    const byEmail = new Map<string, MemberEntry>();
    const keyOf = (e: unknown) => String(e || "").toLowerCase().trim();

    for (const r of (credits || []) as Record<string, unknown>[]) {
      const email = keyOf(r.email);
      if (!email) continue;
      byEmail.set(email, {
        ...r,
        email,
        sources: ["stripe"],
        schedules: [],
        period_active: r.current_period_end ? new Date(String(r.current_period_end)).getTime() > Date.now() : false,
      });
    }

    for (const s of (allSchedules || []) as Record<string, unknown>[]) {
      const email = keyOf(s.email);
      if (!email) continue;
      let entry = byEmail.get(email);
      if (!entry) {
        entry = {
          id: `sched-${s.id}`,
          email,
          subscription_id: null,
          customer_id: null,
          membership_plan: (s.membership_plan as string) || (s.cadence as string) || "recurring",
          credits_per_month: null,
          credits_remaining: null,
          credits_used: null,
          current_period_start: null,
          current_period_end: null,
          period_active: s.active === true,
          sources: [],
          schedules: [],
          schedule_first_name: s.first_name,
          schedule_last_name: s.last_name,
          schedule_phone: s.phone,
        };
        byEmail.set(email, entry);
      }
      if (!entry.sources.includes("recurring")) entry.sources.push("recurring");
      entry.schedules.push({
        id: s.id,
        cadence: s.cadence,
        active: s.active,
        next_service_date: s.next_service_date,
        preferred_cleaner_id: s.preferred_cleaner_id,
        preferred_time_slot: s.preferred_time_slot,
        price_cents: s.price_cents,
        manage_token: s.manage_token || null,
      });
      if (s.active === true) entry.period_active = true;
    }

    for (const b of (planBookings || []) as Record<string, unknown>[]) {
      const email = keyOf(b.email);
      if (!email) continue;
      let entry = byEmail.get(email);
      if (!entry) {
        entry = {
          id: `plan-${email}`,
          email,
          subscription_id: null,
          customer_id: null,
          membership_plan: (b.membership_plan as string) || "member",
          credits_per_month: null,
          credits_remaining: null,
          credits_used: null,
          current_period_start: null,
          current_period_end: null,
          period_active: true,
          sources: [],
          schedules: [],
          schedule_first_name: b.first_name,
          schedule_last_name: b.last_name,
          schedule_phone: b.phone,
        };
        byEmail.set(email, entry);
      }
      if (!entry.sources.includes("plan_booking")) entry.sources.push("plan_booking");
    }

    const emails = Array.from(byEmail.keys());

    const customersByEmail = new Map<string, Record<string, unknown>>();
    if (emails.length > 0) {
      const { data: customers } = await admin
        .from("customers")
        .select("email, first_name, last_name, phone, city, state")
        .in("email", emails);
      for (const c of customers || []) {
        customersByEmail.set(keyOf(c.email), c);
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
        const key = keyOf(b.email);
        if (!lastBookingByEmail.has(key)) lastBookingByEmail.set(key, b);
      }
    }

    const members = Array.from(byEmail.values())
      .map((entry) => ({
        ...entry,
        customer: customersByEmail.get(entry.email) || {
          first_name: entry.schedule_first_name || null,
          last_name: entry.schedule_last_name || null,
          phone: entry.schedule_phone || null,
        },
        last_booking: lastBookingByEmail.get(entry.email) || null,
      }))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(b.period_active === true) - Number(a.period_active === true));

    return json({ ok: true, members });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-memberships]", msg);
    return json({ error: msg }, 500);
  }
});
