import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import { notifyDiscord } from "../_shared/discord.ts";
import { syncTurnoverToGhl, upsertHostContact } from "../_shared/ghl-partner-sync.ts";

// --- Partner Turnover Portal - server engine -----------------------------
//
// All pricing, payment, and assignment runs here (never trust the client).
// Host writes go through this function (service role); hosts can only READ
// their own rows via RLS. Reuses the existing cleaners table, SMS sender
// (Telnyx), Discord notifier, and Stripe account.
//
// Actions:
//   host.ensure        -> upsert the host row for the signed-in user
//   property.save      -> create/update a property (NEVER sets price)
//   turnover.request   -> lock price, create request, return Stripe Checkout URL
//   turnover.finalize  -> verify payment server-side, then auto-assign + notify
//   turnover.cancel    -> host cancellation (24h cutoff)
//   admin.assign       -> admin manual (re)assign + re-notify (role-gated)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cleaner's share of a turnover used in the assignment SMS (informational).
const CLEANER_SHARE = 0.70;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

// Fire a branded host email (best-effort).
async function sendHostEmail(admin: SB, type: string, email: string | null | undefined, data: Record<string, unknown>) {
  if (!email) return;
  try {
    await admin.functions.invoke("send-partner-email", { body: { type, email, data } });
  } catch (e) {
    console.warn("[partner-turnover] email failed", type, e instanceof Error ? e.message : String(e));
  }
}
function fmtWindow(start?: string | null, end?: string | null): string {
  const t = (s?: string | null) => {
    if (!s) return "";
    const [h, m] = s.split(":");
    const hh = parseInt(h, 10);
    const ap = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${m ?? "00"} ${ap}`;
  };
  const a = t(start), b = t(end);
  if (a && b) return `${a} - ${b}`;
  return a || b || "";
}

// deno-lint-ignore no-explicit-any
type SB = any;

// Resolve a Stripe customer's default (or most recent) card for one-tap
// off-session turnover charges. Returns null when no card is on file.
// deno-lint-ignore no-explicit-any
async function getDefaultCard(stripe: any, customerId: string): Promise<{ id: string; brand: string; last4: string } | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || customer.deleted) return null;
    const pmRef = customer.invoice_settings?.default_payment_method;
    if (pmRef && typeof pmRef === "object" && pmRef.card) {
      return { id: pmRef.id, brand: pmRef.card.brand || "card", last4: pmRef.card.last4 || "????" };
    }
    if (typeof pmRef === "string") {
      const pm = await stripe.paymentMethods.retrieve(pmRef);
      if (pm?.card) return { id: pm.id, brand: pm.card.brand || "card", last4: pm.card.last4 || "????" };
    }
    const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
    const pm = list.data?.[0];
    if (pm?.card) return { id: pm.id, brand: pm.card.brand || "card", last4: pm.card.last4 || "????" };
    return null;
  } catch (_) {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    ) as SB;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Calls from other Edge Functions (stripe-webhook, sms-inbound)
    // authenticate with the service-role key, not a user JWT. Treat those as
    // trusted internal callers for the server-to-server actions below
    // (turnover.finalize, cleaner.confirm, cleaner.checkin, cleaner.complete).
    const isInternal = !!jwt && jwt === serviceRoleKey;
    const { data: u } = isInternal
      ? { data: { user: null } }
      : await admin.auth.getUser(jwt);
    const userId: string | undefined = u?.user?.id;
    const userEmail: string | undefined = u?.user?.email?.toLowerCase();
    const userMeta = (u?.user?.user_metadata || {}) as Record<string, unknown>;
    const metaName = (userMeta.full_name as string) || (userMeta.name as string) ||
      [userMeta.first_name, userMeta.last_name].filter(Boolean).join(" ") || "";
    const metaPhone = (userMeta.phone as string) || "";

    const body = await req.json();
    const action: string = body.action;
    const origin = req.headers.get("origin") || "https://partner.novaracleaning.com";

    // ── Internal / payment-verified actions (no host session required) ──
    // These are reached before the auth gate below because they are either
    // independently verified (turnover.finalize re-checks Stripe) or only
    // ever invoked server-to-server with the service-role key.
    if (action === "turnover.finalize") {
      return await handleFinalize(admin, body, origin);
    }
    if (action === "cleaner.confirm" || action === "cleaner.checkin" || action === "cleaner.complete") {
      // Internal callers (sms-inbound) pass cleanerId explicitly. Cleaner-app
      // callers are identified by their auth user → cleaners.user_id, and can
      // only act on their own assignment (enforced in handleCleanerLifecycle).
      let actingCleanerId = body.cleanerId as string | undefined;
      if (!isInternal) {
        if (!userId) return json({ error: "Not signed in" }, 401);
        const { data: c } = await admin.from("cleaners").select("id").eq("user_id", userId).maybeSingle();
        if (!c) return json({ error: "Cleaner profile not found" }, 403);
        actingCleanerId = c.id;
      }
      return await handleCleanerLifecycle(admin, action, { ...body, cleanerId: actingCleanerId });
    }

    if (!userId) return json({ error: "Not signed in" }, 401);

    const getHost = async () => {
      const { data } = await admin.from("hosts").select("*").eq("user_id", userId).maybeSingle();
      return data;
    };

    // --- host.ensure ---------------------------------------------------
    if (action === "host.ensure") {
      let host = await getHost();
      if (!host) {
        const resolvedName = (body.name || metaName || "").trim() || null;
        const resolvedPhone = (body.phone || metaPhone || "").replace(/\D/g, "") || null;
        const { data, error } = await admin.from("hosts").insert({
          user_id: userId,
          email: userEmail,
          name: resolvedName,
          phone: resolvedPhone,
        }).select("*").single();
        if (error) return json({ error: error.message }, 500);
        host = data;
        // First-time host -> welcome email.
        await sendHostEmail(admin, "welcome", userEmail, {
          name: (resolvedName || "").split(" ")[0] || "",
        });
      } else if (body.name || body.phone || (!host.name && metaName) || (!host.phone && metaPhone)) {
        await admin.from("hosts").update({
          name: body.name?.trim() || host.name || metaName || null,
          phone: body.phone ? body.phone.replace(/\D/g, "") : (host.phone || (metaPhone ? metaPhone.replace(/\D/g, "") : null)),
        }).eq("id", host.id);
      }
      // Mirror the host into GoHighLevel as a "partner host" contact so the
      // team has CRM visibility + automation for the turnover portal.
      try {
        const { data: freshHost } = await admin.from("hosts").select("*").eq("id", host.id).maybeSingle();
        await upsertHostContact(admin, freshHost || host);
      } catch (e) {
        console.warn("[partner-turnover] host GHL upsert failed (non-blocking)", e instanceof Error ? e.message : String(e));
      }
      return json({ host });
    }

    const host = await getHost();
    if (!host && action !== "admin.assign") {
      return json({ error: "No host profile - call host.ensure first" }, 400);
    }

    // --- property.save (never accepts turnover_price) -------------------
    if (action === "property.save") {
      const fields = {
        host_id: host.id,
        nickname: (body.nickname || "").trim() || null,
        address: (body.address || "").trim() || null,
        access_instructions: (body.access_instructions || "").trim() || null,
        bedrooms: body.bedrooms != null && body.bedrooms !== "" ? parseInt(String(body.bedrooms), 10) : null,
        bathrooms: body.bathrooms != null && body.bathrooms !== "" ? parseFloat(String(body.bathrooms)) : null,
        sqft: body.sqft != null && body.sqft !== "" ? parseInt(String(body.sqft), 10) : null,
        laundry_included: !!body.laundry_included,
        restock_included: !!body.restock_included,
        special_notes: (body.special_notes || "").trim() || null,
      };
      if (body.propertyId) {
        // Ensure the property belongs to this host before updating.
        const { data: existing } = await admin.from("properties").select("id, host_id").eq("id", body.propertyId).maybeSingle();
        if (!existing || existing.host_id !== host.id) return json({ error: "Property not found" }, 404);
        const { data, error } = await admin.from("properties").update(fields).eq("id", body.propertyId).select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ property: data });
      }
      const { data, error } = await admin.from("properties").insert(fields).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ property: data });
    }

    // --- turnover.request -----------------------------------------------
    if (action === "turnover.request") {
      const { data: property } = await admin.from("properties").select("*").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
        return json({ error: "This property isn't priced yet. Our team will set your per-turnover rate shortly." }, 409);
      }
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);

      const priceCents = Math.round(Number(property.turnover_price) * 100);

      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: host.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // Reuse / create the host's Stripe customer for one-tap repeat booking.
      let customerId = host.stripe_customer_id || undefined;
      if (!customerId && host.email) {
        const list = await stripe.customers.list({ email: host.email, limit: 1 });
        customerId = list.data[0]?.id;
        if (!customerId) {
          const c = await stripe.customers.create({ email: host.email, name: host.name || undefined });
          customerId = c.id;
        }
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : host.email,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Turnover - ${property.nickname || property.address || "Property"}` },
            unit_amount: priceCents,
          },
          quantity: 1,
        }],
        success_url: `${origin}/partner/turnover/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/partner/dashboard`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover", turnover_id: tr.id, host_id: host.id },
      });

      await admin.from("turnover_requests").update({ stripe_checkout_session_id: session.id }).eq("id", tr.id);
      return json({ url: session.url, turnoverId: tr.id });
    }

    // --- turnover.paymentInfo (does the host have a card on file?) -------
    if (action === "turnover.paymentInfo") {
      if (!host.stripe_customer_id) return json({ hasSavedCard: false });
      try {
        const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const pm = await getDefaultCard(stripe, host.stripe_customer_id);
        if (!pm) return json({ hasSavedCard: false });
        return json({ hasSavedCard: true, brand: pm.brand, last4: pm.last4 });
      } catch (_) {
        return json({ hasSavedCard: false });
      }
    }

    // --- turnover.requestSaved (one-tap: charge saved card off-session) --
    if (action === "turnover.requestSaved") {
      const { data: property } = await admin.from("properties").select("*").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
        return json({ error: "This property isn't priced yet. Our team will set your per-turnover rate shortly." }, 409);
      }
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);

      const priceCents = Math.round(Number(property.turnover_price) * 100);
      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // Need a saved card to charge off-session; otherwise tell the client
      // to fall back to the hosted Checkout flow.
      if (!host.stripe_customer_id) return json({ needsCheckout: true });
      const card = await getDefaultCard(stripe, host.stripe_customer_id);
      if (!card) return json({ needsCheckout: true });

      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: host.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

      try {
        const pi = await stripe.paymentIntents.create({
          amount: priceCents,
          currency: "usd",
          customer: host.stripe_customer_id,
          payment_method: card.id,
          off_session: true,
          confirm: true,
          metadata: { kind: "turnover", turnover_id: tr.id, host_id: host.id },
        });
        if (pi.status === "succeeded") {
          const after = await markPaidAndAssign(admin, tr.id, pi.id);
          return json({ paid: true, turnoverId: tr.id, status: after?.status, assignment_type: after?.assignment_type });
        }
        // Needs SCA / further action → discard the row and use Checkout.
        await admin.from("turnover_requests").delete().eq("id", tr.id).eq("status", "pending_payment");
        return json({ needsCheckout: true });
      } catch (e) {
        // Card declined / authentication_required → fall back to Checkout.
        await admin.from("turnover_requests").delete().eq("id", tr.id).eq("status", "pending_payment");
        console.warn("[partner-turnover] off-session charge failed, falling back to checkout", e instanceof Error ? e.message : String(e));
        return json({ needsCheckout: true });
      }
    }

    // --- turnover.reschedule (host, 24h cutoff) -------------------------
    if (action === "turnover.reschedule") {
      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr || tr.host_id !== host.id) return json({ error: "Turnover not found" }, 404);
      if (!["paid", "assigned", "cleaner_confirmed", "unassigned_alert"].includes(tr.status)) {
        return json({ error: "This turnover can't be rescheduled." }, 409);
      }
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);
      // No self-reschedule inside the 24h window of the CURRENT service date.
      const svc = new Date(`${tr.requested_date}T12:00:00`);
      if (svc.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        return json({ error: "Within 24 hours of service - contact support to reschedule." }, 409);
      }
      // Moving the date invalidates the existing assignment → re-dispatch.
      await admin.from("turnover_requests").update({
        requested_date: body.requested_date,
        window_start: body.window_start || tr.window_start,
        window_end: body.window_end || tr.window_end,
        status: "paid",
        assigned_cleaner_id: null,
        assignment_type: null,
        assigned_at: null,
        cleaner_confirmed_at: null,
        reschedule_count: (Number(tr.reschedule_count) || 0) + 1,
        last_rescheduled_at: new Date().toISOString(),
      }).eq("id", tr.id);
      const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
      await runAssignment(admin, fresh, "auto");
      const { property: rProp, hostRow: rHost } = await loadContext(admin, fresh);
      await sendHostEmail(admin, "turnover_rescheduled", rHost?.email, {
        name: (rHost?.name || "").split(" ")[0] || "",
        property: rProp?.nickname || rProp?.address || "",
        address: rProp?.address || "",
        date: formatServiceDate(body.requested_date as string),
        window: fmtWindow(body.window_start || fresh.window_start, body.window_end || fresh.window_end),
      });
      const { data: after } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", tr.id).single();
      return json({ ok: true, status: after?.status, assignment_type: after?.assignment_type });
    }

    // --- turnover.rate (host post-clean feedback) ----------------------
    if (action === "turnover.rate") {
      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr || tr.host_id !== host.id) return json({ error: "Turnover not found" }, 404);
      if (tr.status !== "completed") return json({ error: "You can rate a turnover once it's completed." }, 409);
      const rating = parseInt(String(body.rating), 10);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) return json({ error: "Rating must be 1-5." }, 400);
      await admin.from("turnover_requests").update({
        host_rating: rating,
        host_review: (body.review || "").trim() || null,
        rated_at: new Date().toISOString(),
      }).eq("id", tr.id);
      // Feed the cleaner's rolling performance score (best-effort).
      try {
        if (tr.assigned_cleaner_id) {
          await admin.functions.invoke("update-cleaner-performance", {
            body: { cleanerId: tr.assigned_cleaner_id, rating, source: "turnover" },
          });
        }
      } catch (_) { /* non-blocking */ }
      return json({ ok: true });
    }

    // --- turnover.cancel (host) -----------------------------------------
    if (action === "turnover.cancel") {
      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr || tr.host_id !== host.id) return json({ error: "Turnover not found" }, 404);
      if (["completed", "cancelled"].includes(tr.status)) return json({ error: "Already closed" }, 409);
      // Cancellation cutoff: no self-cancel within 24h of the service date.
      const svc = new Date(`${tr.requested_date}T12:00:00`);
      if (svc.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
        return json({ error: "Within 24 hours of service - contact support to cancel." }, 409);
      }
      await admin.from("turnover_requests").update({ status: "cancelled" }).eq("id", tr.id);
      const { property: cProp } = await loadContext(admin, tr);
      await sendHostEmail(admin, "turnover_cancelled", host.email, {
        name: (host.name || "").split(" ")[0] || "",
        property: cProp?.nickname || cProp?.address || "",
        date: formatServiceDate(tr.requested_date as string),
      });
      // Reflect the cancellation in GHL (opportunity → lost).
      try {
        await syncTurnoverToGhl(admin, { host, property: cProp, turnover: { ...tr, status: "cancelled" } });
      } catch (e) {
        console.warn("[partner-turnover] cancel GHL sync failed (non-blocking)", e instanceof Error ? e.message : String(e));
      }
      return json({ ok: true });
    }

    // --- admin.assign (role-gated manual override) ----------------------
    if (action === "admin.assign") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const isAdmin = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
      if (!isAdmin) return json({ error: "Admins or VAs only" }, 403);

      const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", body.turnoverId).maybeSingle();
      if (!tr) return json({ error: "Turnover not found" }, 404);

      if (body.cleanerId) {
        await admin.from("turnover_requests").update({
          assigned_cleaner_id: body.cleanerId,
          assignment_type: "manual",
          status: "assigned",
          assigned_at: new Date().toISOString(),
          assigned_by: userId,
        }).eq("id", tr.id);
        const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
        await notifyAssignment(admin, fresh);
        return json({ status: "assigned", assignment_type: "manual" });
      }
      // No cleaner specified -> re-run the auto engine.
      await admin.from("turnover_requests").update({ assigned_by: userId }).eq("id", tr.id);
      await runAssignment(admin, tr, "auto");
      const { data: after } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", tr.id).single();
      return json({ status: after?.status, assignment_type: after?.assignment_type });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// --- turnover.finalize (verify payment server-side -> assign + notify) ---
//
// Safe to call without a user session: payment is re-verified against Stripe
// by checkout session id. Invoked by BOTH the success page (with the host's
// JWT) and stripe-webhook (service role) so a closed browser tab can never
// strand a paid turnover in pending_payment. Idempotent on the status guard.
async function handleFinalize(admin: SB, body: Record<string, unknown>, _origin: string) {
  if (!body.sessionId) return json({ error: "sessionId required" }, 400);
  const { data: tr } = await admin.from("turnover_requests").select("*").eq("stripe_checkout_session_id", body.sessionId).maybeSingle();
  if (!tr) return json({ error: "Turnover not found" }, 404);

  const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const session = await stripe.checkout.sessions.retrieve(body.sessionId as string);
  const paid = session.payment_status === "paid" || session.status === "complete";

  if (paid && tr.status === "pending_payment") {
    const after = await markPaidAndAssign(admin, tr.id as string, (session.payment_intent as string) || null);
    return json({ paid: true, status: after?.status, assignment_type: after?.assignment_type });
  }
  return json({ paid, status: tr.status });
}

// Shared: claim a pending_payment turnover → paid, then confirm + assign +
// notify. Idempotent via the optimistic status guard, so concurrent callers
// (webhook, success page, off-session one-tap) never double-fan-out.
async function markPaidAndAssign(admin: SB, trId: string, paymentIntentId: string | null) {
  const { data: claimed } = await admin.from("turnover_requests").update({
    status: "paid",
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: paymentIntentId,
  }).eq("id", trId).eq("status", "pending_payment").select("*");
  if (!claimed || claimed.length === 0) {
    const { data: cur } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", trId).single();
    return cur;
  }
  const tr = claimed[0];
  const { property: paidProp, hostRow: paidHost } = await loadContext(admin, tr);
  await sendHostEmail(admin, "turnover_confirmed", paidHost?.email, {
    name: (paidHost?.name || "").split(" ")[0] || "",
    property: paidProp?.nickname || paidProp?.address || "",
    address: paidProp?.address || "",
    date: formatServiceDate(tr.requested_date as string),
    window: fmtWindow(tr.window_start as string, tr.window_end as string),
    price: money(Number(tr.price || 0)),
  });
  try {
    await syncTurnoverToGhl(admin, { host: paidHost, property: paidProp, turnover: { ...tr, status: "paid" } });
  } catch (e) {
    console.warn("[partner-turnover] turnover GHL sync failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
  const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", trId).single();
  await runAssignment(admin, fresh, "auto");
  const { data: after } = await admin.from("turnover_requests").select("status, assignment_type").eq("id", trId).single();
  return after;
}

// --- Cleaner lifecycle (confirm / check-in / complete) -----------------
//
// Invoked server-to-server (service role) from sms-inbound when a cleaner
// replies to the assignment texts, and from the cleaner app. Each step
// advances status and fans out the right host notifications.
async function handleCleanerLifecycle(admin: SB, action: string, body: Record<string, unknown>) {
  const turnoverId = body.turnoverId as string | undefined;
  const cleanerId = body.cleanerId as string | undefined;
  if (!turnoverId) return json({ error: "turnoverId required" }, 400);
  const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", turnoverId).maybeSingle();
  if (!tr) return json({ error: "Turnover not found" }, 404);
  // When a cleanerId is supplied (SMS / app), it must own the assignment.
  if (cleanerId && tr.assigned_cleaner_id && tr.assigned_cleaner_id !== cleanerId) {
    return json({ error: "Not your turnover" }, 403);
  }

  if (action === "cleaner.confirm") {
    if (!["assigned", "cleaner_confirmed"].includes(tr.status)) {
      return json({ error: "Nothing to confirm" }, 409);
    }
    if (tr.status !== "cleaner_confirmed") {
      await admin.from("turnover_requests").update({
        status: "cleaner_confirmed",
        cleaner_confirmed_at: new Date().toISOString(),
      }).eq("id", tr.id).eq("status", "assigned");
      const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
      await notifyCleanerConfirmed(admin, fresh);
    }
    return json({ ok: true, status: "cleaner_confirmed" });
  }

  if (action === "cleaner.checkin") {
    if (!["cleaner_confirmed", "assigned"].includes(tr.status)) {
      return json({ error: "Can't check in yet" }, 409);
    }
    await admin.from("turnover_requests").update({
      status: "in_progress",
      started_at: new Date().toISOString(),
    }).eq("id", tr.id);
    if (Array.isArray(body.before_photos) && body.before_photos.length) {
      await admin.from("turnover_requests").update({ before_photos: body.before_photos }).eq("id", tr.id);
    }
    const { property, hostRow } = await loadContext(admin, tr);
    if (hostRow?.phone) {
      await sendSms(admin, {
        toPhone: hostRow.phone, type: "confirmation",
        message: `Your cleaner has started the turnover at ${property?.nickname || property?.address || "your property"}. We'll let you know the moment it's guest-ready. - NovaraCleaning`,
      });
    }
    return json({ ok: true, status: "in_progress" });
  }

  if (action === "cleaner.complete") {
    await admin.from("turnover_requests").update({
      status: "completed",
      completed_at: new Date().toISOString(),
    }).eq("id", tr.id);
    if (Array.isArray(body.after_photos) && body.after_photos.length) {
      await admin.from("turnover_requests").update({ after_photos: body.after_photos }).eq("id", tr.id);
    }
    const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
    await notifyTurnoverCompleted(admin, fresh);
    return json({ ok: true, status: "completed" });
  }

  return json({ error: `Unknown lifecycle action: ${action}` }, 400);
}

// --- Assignment engine -------------------------------------------------
async function runAssignment(admin: SB, tr: Record<string, unknown>, defaultType: "auto" | "preferred") {
  const propertyId = tr.property_id as string;
  const date = tr.requested_date as string;

  // Candidate crew: property-preferred first (priority), then global crew.
  const { data: preferred } = await admin
    .from("turnover_crew")
    .select("cleaner_id, priority")
    .eq("active", true).eq("is_turnover_crew", true).eq("property_id", propertyId)
    .order("priority", { ascending: true });
  const { data: pool } = await admin
    .from("turnover_crew")
    .select("cleaner_id, priority")
    .eq("active", true).eq("is_turnover_crew", true).is("property_id", null)
    .order("priority", { ascending: true });

  const ordered = [
    ...(preferred || []).map((c: { cleaner_id: string }) => ({ id: c.cleaner_id, type: "preferred" as const })),
    ...(pool || []).map((c: { cleaner_id: string }) => ({ id: c.cleaner_id, type: "auto" as const })),
  ];

  // Cleaners already booked on this date for an active turnover (conflict).
  const { data: sameDay } = await admin
    .from("turnover_requests")
    .select("assigned_cleaner_id, window_start, window_end")
    .eq("requested_date", date)
    .in("status", ["assigned", "cleaner_confirmed", "in_progress"]);
  const overlaps = (s1?: string | null, e1?: string | null, s2?: string | null, e2?: string | null) => {
    if (!s1 || !e1 || !s2 || !e2) return true; // unknown windows -> treat as conflict (same day)
    return s1 < e2 && s2 < e1;
  };
  const busy = new Set<string>();
  for (const r of sameDay || []) {
    if (r.assigned_cleaner_id && overlaps(tr.window_start as string, tr.window_end as string, r.window_start, r.window_end)) {
      busy.add(r.assigned_cleaner_id);
    }
  }

  const pick = ordered.find((c) => !busy.has(c.id));

  if (pick) {
    await admin.from("turnover_requests").update({
      assigned_cleaner_id: pick.id,
      assignment_type: pick.type,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    }).eq("id", tr.id);
    const { data: fresh } = await admin.from("turnover_requests").select("*").eq("id", tr.id).single();
    await notifyAssignment(admin, fresh);
    return;
  }

  // No one available -> escalate (never silently leave unassigned).
  await admin.from("turnover_requests").update({ status: "unassigned_alert" }).eq("id", tr.id);
  const { property, hostRow } = await loadContext(admin, tr);
  await notifyDiscord(admin, {
    title: "UNASSIGNED turnover needs manual assignment",
    color: 15158332,
    fields: [
      { name: "Property", value: property?.nickname || property?.address || "-", inline: true },
      { name: "Date", value: `${formatServiceDate(date)} ${fmtWindow(tr.window_start as string, tr.window_end as string)}`, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
      { name: "Why", value: "No turnover crew available for this date/window.", inline: false },
    ],
  });
  const opsPhone = (await resolveSecret(admin, "OPS_ALERT_PHONE")).trim();
  if (opsPhone) {
    await sendSms(admin, {
      toPhone: opsPhone,
      type: "reminder",
      message: `Novara: UNASSIGNED turnover ${property?.nickname || property?.address || ""} on ${formatServiceDate(date)} - no crew free. Assign manually in admin.`,
    });
  }
}

async function loadContext(admin: SB, tr: Record<string, unknown>) {
  const { data: property } = await admin.from("properties").select("*").eq("id", tr.property_id).maybeSingle();
  const { data: hostRow } = await admin.from("hosts").select("*").eq("id", tr.host_id).maybeSingle();
  return { property, hostRow };
}

async function notifyAssignment(admin: SB, tr: Record<string, unknown>) {
  const { property, hostRow } = await loadContext(admin, tr);
  const cleanerId = tr.assigned_cleaner_id as string | null;
  if (!cleanerId) return;
  const { data: cleaner } = await admin.from("cleaners").select("first_name, phone, email").eq("id", cleanerId).maybeSingle();
  const dateLabel = formatServiceDate(tr.requested_date as string);
  const windowLabel = fmtWindow(tr.window_start as string, tr.window_end as string);
  const priceNum = Number(tr.price || 0);
  const share = money(priceNum * CLEANER_SHARE);
  const nickname = property?.nickname || property?.address || "Property";
  const assignmentType = (tr.assignment_type as string) || "auto";

  // 1. Cleaner SMS - reply YES to confirm. Access codes are NOT included in
  // the text; the cleaner sees them in the authenticated app once assigned.
  if (cleaner?.phone) {
    await sendSms(admin, {
      toPhone: cleaner.phone,
      type: "job_offer",
      message: `New turnover: ${nickname}, ${property?.address || ""}. ${dateLabel}${windowLabel ? ` between ${windowLabel}` : ""}. Pay: ${share}. Reply YES to confirm. Access details + checklist: https://app.novaracleaning.com/cleaner/turnovers`,
    });
  }

  // 2. Discord ops.
  await notifyDiscord(admin, {
    title: "Turnover assigned",
    color: 3066993,
    fields: [
      { name: "Property", value: nickname, inline: true },
      { name: "When", value: `${dateLabel} ${windowLabel}`, inline: true },
      { name: "Cleaner", value: `${cleaner?.first_name || "Cleaner"} (${assignmentType})`, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
      { name: "Price", value: money(priceNum), inline: true },
    ],
  });

  // 3. Host SMS + email.
  if (hostRow?.phone) {
    await sendSms(admin, {
      toPhone: hostRow.phone,
      type: "confirmation",
      message: `Your turnover for ${nickname} on ${dateLabel} is confirmed and assigned. We'll have it guest-ready${windowLabel ? ` by the end of your ${windowLabel} window` : ""}. - NovaraCleaning`,
    });
  }
  await sendHostEmail(admin, "turnover_assigned", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: nickname,
    address: property?.address || "",
    date: dateLabel,
    window: windowLabel,
    cleaner: cleaner?.first_name || "Your cleaner",
  });

  // 4. Cleaner email (if on file) - SMS already sent above.
  if (cleaner?.email) {
    await sendHostEmail(admin, "turnover_assigned", cleaner.email, {
      name: cleaner.first_name || "",
      property: nickname,
      address: property?.address || "",
      date: dateLabel,
      window: windowLabel,
      cleaner: cleaner.first_name || "you",
    });
  }

  // 5. Patch the GHL opportunity with the assigned cleaner + assigned status.
  try {
    await syncTurnoverToGhl(admin, { host: hostRow, property, turnover: tr, cleaner });
  } catch (e) {
    console.warn("[partner-turnover] assignment GHL sync failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
}

// Cleaner replied YES → reassure the host their crew is locked in.
async function notifyCleanerConfirmed(admin: SB, tr: Record<string, unknown>) {
  const { property, hostRow } = await loadContext(admin, tr);
  const cleanerId = tr.assigned_cleaner_id as string | null;
  const { data: cleaner } = cleanerId
    ? await admin.from("cleaners").select("first_name").eq("id", cleanerId).maybeSingle()
    : { data: null };
  const nickname = property?.nickname || property?.address || "your property";
  const dateLabel = formatServiceDate(tr.requested_date as string);

  await notifyDiscord(admin, {
    title: "Turnover confirmed by cleaner",
    color: 3066993,
    fields: [
      { name: "Property", value: nickname, inline: true },
      { name: "When", value: dateLabel, inline: true },
      { name: "Cleaner", value: cleaner?.first_name || "Cleaner", inline: true },
    ],
  });
  if (hostRow?.phone) {
    await sendSms(admin, {
      toPhone: hostRow.phone, type: "confirmation",
      message: `Good news — ${cleaner?.first_name || "your cleaner"} confirmed your ${dateLabel} turnover at ${nickname}. - NovaraCleaning`,
    });
  }
  await sendHostEmail(admin, "turnover_cleaner_confirmed", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: nickname,
    address: property?.address || "",
    date: dateLabel,
    window: fmtWindow(tr.window_start as string, tr.window_end as string),
    cleaner: cleaner?.first_name || "Your cleaner",
  });
}

// Turnover marked complete → tell the host it's guest-ready + invite a rating.
async function notifyTurnoverCompleted(admin: SB, tr: Record<string, unknown>) {
  const { property, hostRow } = await loadContext(admin, tr);
  const nickname = property?.nickname || property?.address || "your property";
  const dateLabel = formatServiceDate(tr.requested_date as string);

  await notifyDiscord(admin, {
    title: "Turnover completed",
    color: 3066993,
    fields: [
      { name: "Property", value: nickname, inline: true },
      { name: "When", value: dateLabel, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
    ],
  });
  if (hostRow?.phone) {
    await sendSms(admin, {
      toPhone: hostRow.phone, type: "confirmation",
      message: `${nickname} is guest-ready! Your ${dateLabel} turnover is complete. Rate your clean in the portal: https://partner.novaracleaning.com/partner/dashboard - NovaraCleaning`,
    });
  }
  await sendHostEmail(admin, "turnover_completed", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: nickname,
    address: property?.address || "",
    date: dateLabel,
  });
  try {
    await syncTurnoverToGhl(admin, { host: hostRow, property, turnover: { ...tr, status: "completed" } });
  } catch (e) {
    console.warn("[partner-turnover] completion GHL sync failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
}
