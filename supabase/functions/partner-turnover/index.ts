import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms, formatServiceDate } from "../_shared/sms.ts";
import { notifyDiscord } from "../_shared/discord.ts";
import { syncTurnoverToGhl, upsertHostContact } from "../_shared/ghl-partner-sync.ts";
import { sendHostAgreement } from "../_shared/host-onboarding-ghl.ts";
import { finalizeBatch } from "../_shared/turnover-engine.ts";

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

// Recommended dispatch crew size (2–3) from a property's square footage.
// Larger homes get a 3-person crew so the turnover fits the checkout window.
function targetCrewSize(sqft: number | null): number | null {
  if (sqft == null || Number.isNaN(sqft) || sqft <= 0) return null;
  return sqft >= 2500 ? 3 : 2;
}

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
    // Invoice paid (stripe-webhook, service role) → mark paid + assign + notify.
    if (action === "turnover.finalizeByInvoice") {
      const tId = body.turnoverId as string | undefined;
      if (!tId) return json({ error: "turnoverId required" }, 400);
      const after = await markPaidAndAssign(admin, tId, (body.paymentIntentId as string) || null);
      return json({ ok: true, status: after?.status, assignment_type: after?.assignment_type });
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
      const sqftVal = body.sqft != null && body.sqft !== "" ? parseInt(String(body.sqft), 10) : null;
      const fields = {
        host_id: host.id,
        nickname: (body.nickname || "").trim() || null,
        address: (body.address || "").trim() || null,
        access_instructions: (body.access_instructions || "").trim() || null,
        bedrooms: body.bedrooms != null && body.bedrooms !== "" ? parseInt(String(body.bedrooms), 10) : null,
        bathrooms: body.bathrooms != null && body.bathrooms !== "" ? parseFloat(String(body.bathrooms)) : null,
        sqft: sqftVal,
        // Recommended dispatch crew size (2–3) derived from sqft. Larger homes
        // get a 3-person crew so turnovers finish inside the checkout window.
        target_crew_size: targetCrewSize(sqftVal),
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

    // --- host.cleaners — roster + per-property crew (NAMES ONLY) ---------
    //
    // Hosts see only first names of the cleaners on their properties (never
    // contact info). Crew per property = property-preferred turnover_crew rows
    // plus whoever is currently assigned on this property's turnovers. The
    // roster is the distinct set across all the host's properties, capped 10.
    if (action === "host.cleaners") {
      const { data: props } = await admin.from("properties").select("id, nickname, address, sqft, target_crew_size").eq("host_id", host.id);
      const propIds = (props || []).map((p: Record<string, unknown>) => p.id);
      const byProperty: Record<string, Array<{ id: string; firstName: string; source: string }>> = {};
      const rosterIds = new Set<string>();

      // Property-preferred crew.
      if (propIds.length) {
        const { data: crew } = await admin
          .from("turnover_crew")
          .select("cleaner_id, property_id, priority, active")
          .in("property_id", propIds)
          .eq("active", true)
          .eq("is_turnover_crew", true)
          .order("priority", { ascending: true });
        for (const c of crew || []) {
          (byProperty[c.property_id] ||= []).push({ id: c.cleaner_id, firstName: "", source: "preferred" });
          rosterIds.add(c.cleaner_id);
        }
      }
      // Currently/last assigned cleaners on this host's turnovers.
      const { data: trs } = await admin
        .from("turnover_requests")
        .select("property_id, assigned_cleaner_id, status, requested_date")
        .eq("host_id", host.id)
        .not("assigned_cleaner_id", "is", null)
        .order("requested_date", { ascending: false });
      for (const t of trs || []) {
        const list = (byProperty[t.property_id] ||= []);
        if (!list.find((x) => x.id === t.assigned_cleaner_id)) list.push({ id: t.assigned_cleaner_id, firstName: "", source: "assigned" });
        rosterIds.add(t.assigned_cleaner_id);
      }

      // Resolve first names (the only PII a host may see).
      const nameById = new Map<string, string>();
      if (rosterIds.size) {
        const { data: cs } = await admin.from("cleaners").select("id, first_name").in("id", Array.from(rosterIds));
        for (const c of cs || []) nameById.set(String(c.id), c.first_name || "Cleaner");
      }
      for (const pid of Object.keys(byProperty)) {
        byProperty[pid] = byProperty[pid].map((x) => ({ ...x, firstName: nameById.get(x.id) || "Cleaner" })).slice(0, 2);
      }
      const roster = Array.from(rosterIds).slice(0, 10).map((id) => ({ id, firstName: nameById.get(id) || "Cleaner" }));

      const { data: openReqs } = await admin
        .from("cleaner_change_requests")
        .select("id, property_id, current_cleaner_id, kind, reason, status, created_at")
        .eq("host_id", host.id)
        .eq("status", "open");

      return json({
        roster,
        rosterMax: 10,
        perPropertyMax: 2,
        byProperty,
        properties: props || [],
        openRequests: openReqs || [],
      });
    }

    // --- cleaner.requestChange — host asks ops to swap/add a cleaner ------
    if (action === "cleaner.requestChange") {
      const kind = ["replace", "additional", "remove"].includes(body.kind) ? body.kind : "replace";
      let propertyId: string | null = body.propertyId || null;
      if (propertyId) {
        const { data: prop } = await admin.from("properties").select("id, host_id").eq("id", propertyId).maybeSingle();
        if (!prop || prop.host_id !== host.id) return json({ error: "Property not found" }, 404);
      }
      // Guard the roster cap for "additional" requests.
      if (kind === "additional") {
        const { count } = await admin
          .from("turnover_crew")
          .select("id", { count: "exact", head: true })
          .eq("property_id", propertyId)
          .eq("active", true);
        if ((count || 0) >= 2) {
          return json({ error: "Each property can have up to 2 regular cleaners. Replace one instead." }, 409);
        }
      }
      const { data: reqRow, error: reqErr } = await admin.from("cleaner_change_requests").insert({
        host_id: host.id,
        property_id: propertyId,
        turnover_id: body.turnoverId || null,
        current_cleaner_id: body.currentCleanerId || null,
        kind,
        reason: (body.reason || "").trim() || null,
      }).select("id").single();
      if (reqErr) return json({ error: reqErr.message }, 500);

      // Notify ops (names only — never expose host↔cleaner contact wiring here).
      let propLabel = "a property";
      if (propertyId) {
        const { data: p } = await admin.from("properties").select("nickname, address").eq("id", propertyId).maybeSingle();
        propLabel = p?.nickname || p?.address || propLabel;
      }
      const kindLabel = kind === "replace" ? "REPLACE a cleaner" : kind === "additional" ? "ADD a cleaner" : "REMOVE a cleaner";
      await notifyDiscord(admin, {
        title: "Host cleaner-change request",
        color: 15844367,
        fields: [
          { name: "Host", value: host.name || host.email || "-", inline: true },
          { name: "Property", value: propLabel, inline: true },
          { name: "Request", value: kindLabel, inline: true },
          { name: "Reason", value: (body.reason || "—").toString().slice(0, 500), inline: false },
        ],
        description: "Action it in admin → Partnerships → crew, then mark the request resolved.",
      }).catch(() => undefined);

      return json({ ok: true, requestId: reqRow.id });
    }

    // --- turnover.request -----------------------------------------------
    if (action === "turnover.request") {
      const { data: property } = await admin.from("properties").select("*").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
        return json({ error: "This property isn't priced yet. Our team will set your per-turnover rate shortly." }, 409);
      }
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);

      // Payment option (spec): 'full' = charge 100% now; 'split' = 50% now +
      // 50% auto-charged on completion; 'pay_after' = $0 now, full charge on
      // completion (requires a card on file).
      const paymentOption = ["full", "split", "pay_after"].includes(body.paymentOption)
        ? (body.paymentOption as string)
        : "full";
      const priceCents = Math.round(Number(property.turnover_price) * 100);
      const depositCents =
        paymentOption === "split" ? Math.floor(priceCents / 2) : paymentOption === "pay_after" ? 0 : priceCents;
      const balanceCents = priceCents - depositCents;

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // pay_after charges nothing now — we just need a card on file to charge on
      // completion. No card → tell the client to run host.setupPaymentMethod.
      if (paymentOption === "pay_after") {
        const card = host.stripe_customer_id ? await getDefaultCard(stripe, host.stripe_customer_id) : null;
        if (!card) return json({ needsSetup: true });
        const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
          property_id: property.id, host_id: host.id,
          requested_date: body.requested_date,
          window_start: body.window_start || null, window_end: body.window_end || null,
          price: Number(property.turnover_price), status: "pending_payment",
          notes: (body.notes || "").trim() || null,
          payment_option: "pay_after", deposit_cents: 0, balance_cents: balanceCents, card_on_file: true,
        }).select("*").single();
        if (trErr) return json({ error: trErr.message }, 500);
        const after = await markPaidAndAssign(admin, tr.id, null);
        return json({ scheduled: true, turnoverId: tr.id, status: after?.status, assignment_type: after?.assignment_type });
      }

      // full / split → collect the deposit (50% or 100%) via Checkout, saving
      // the card so the balance can be charged off-session on completion.
      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: host.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
        payment_option: paymentOption, deposit_cents: depositCents, balance_cents: balanceCents,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

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

      const label =
        paymentOption === "split"
          ? `Turnover deposit (50%) - ${property.nickname || property.address || "Property"}`
          : `Turnover - ${property.nickname || property.address || "Property"}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : host.email,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: label },
            unit_amount: depositCents,
          },
          quantity: 1,
        }],
        success_url: `${origin}/partner/turnover/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/partner/dashboard`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover", turnover_id: tr.id, host_id: host.id, payment_option: paymentOption },
      });

      await admin.from("turnover_requests").update({ stripe_checkout_session_id: session.id }).eq("id", tr.id);
      return json({ url: session.url, turnoverId: tr.id });
    }

    // --- host.setupPaymentMethod (save a card on file, no charge) -------
    if (action === "host.setupPaymentMethod") {
      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      let customerId = host.stripe_customer_id || undefined;
      if (!customerId) {
        const list = host.email ? await stripe.customers.list({ email: host.email, limit: 1 }) : { data: [] };
        customerId = list.data[0]?.id ||
          (await stripe.customers.create({ email: host.email || undefined, name: host.name || undefined })).id;
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
      }
      // mode:"setup" collects + saves a card WITHOUT any charge.
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "setup",
        success_url: `${origin}/partner/dashboard?card=saved`,
        cancel_url: `${origin}/partner/dashboard`,
        metadata: { kind: "host_setup", host_id: host.id },
      });
      return json({ url: session.url });
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

      const paymentOption = ["full", "split", "pay_after"].includes(body.paymentOption)
        ? (body.paymentOption as string)
        : "full";
      const priceCents = Math.round(Number(property.turnover_price) * 100);
      const depositCents =
        paymentOption === "split" ? Math.floor(priceCents / 2) : paymentOption === "pay_after" ? 0 : priceCents;
      const balanceCents = priceCents - depositCents;
      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      // Need a saved card to charge off-session; otherwise tell the client to
      // fall back to Checkout (or the setup flow for pay_after).
      if (!host.stripe_customer_id) return json(paymentOption === "pay_after" ? { needsSetup: true } : { needsCheckout: true });
      const card = await getDefaultCard(stripe, host.stripe_customer_id);
      if (!card) return json(paymentOption === "pay_after" ? { needsSetup: true } : { needsCheckout: true });

      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: host.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
        payment_option: paymentOption, deposit_cents: depositCents, balance_cents: balanceCents,
        card_on_file: true,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

      // pay_after: no charge now — card is on file for completion.
      if (paymentOption === "pay_after") {
        const after = await markPaidAndAssign(admin, tr.id, null);
        return json({ scheduled: true, turnoverId: tr.id, status: after?.status, assignment_type: after?.assignment_type });
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount: depositCents,
          currency: "usd",
          customer: host.stripe_customer_id,
          payment_method: card.id,
          off_session: true,
          confirm: true,
          metadata: { kind: "turnover", turnover_id: tr.id, host_id: host.id, payment_option: paymentOption },
        });
        if (pi.status === "succeeded") {
          if (paymentOption === "split") {
            await admin.from("turnover_requests").update({ deposit_payment_intent_id: pi.id }).eq("id", tr.id);
          }
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
      if (rHost?.phone) {
        await sendSms(admin, {
          toPhone: rHost.phone,
          message: `Your turnover at ${rProp?.nickname || rProp?.address || "your property"} is moved to ${formatServiceDate(body.requested_date as string)}. We're re-assigning a vetted cleaner. - NovaraCleaning`,
          type: "confirmation",
        });
      }
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
      if (host.phone) {
        await sendSms(admin, {
          toPhone: host.phone,
          message: `Your turnover at ${cProp?.nickname || cProp?.address || "your property"} on ${formatServiceDate(tr.requested_date as string)} is cancelled. Rebook anytime in your portal. - NovaraCleaning`,
          type: "confirmation",
        });
      }
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

    // --- admin.sendHostAgreement (role-gated: send the Host Partnership ----
    // Agreement to a first-time host once all their properties are priced).
    // Triggers the GHL document e-sign (entity-aware tag), emails the host the
    // rate schedule (Resend), and texts them (GHL). Idempotent-ish: callable
    // again to re-send; refuses if any property is still unpriced.
    if (action === "admin.sendHostAgreement") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const isAdmin = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
      if (!isAdmin) return json({ error: "Admins or VAs only" }, 403);

      const hostId = body.hostId as string | undefined;
      if (!hostId) return json({ error: "hostId required" }, 400);
      const { data: targetHost } = await admin.from("hosts").select("*").eq("id", hostId).maybeSingle();
      if (!targetHost) return json({ error: "Host not found" }, 404);

      // Every property must be priced before we send a rate schedule to sign.
      const { data: props } = await admin.from("properties").select("*").eq("host_id", hostId);
      const propList = (props || []) as Array<Record<string, unknown>>;
      if (propList.length === 0) return json({ error: "Host has no properties yet." }, 409);
      const unpriced = propList.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
      if (unpriced.length > 0) {
        return json({
          error: "Set every property's rate before sending the agreement.",
          unpriced: unpriced.map((p) => (p.nickname as string) || (p.address as string) || "Property"),
        }, 409);
      }

      const rateSummary = propList
        .map((p) => `${(p.nickname as string) || (p.address as string) || "Property"}: ${money(Number(p.turnover_price))}/turnover`)
        .join("; ");

      // Pull the onboarding submission for entity type + GHL ids (best-effort).
      const { data: sub } = await admin
        .from("host_onboarding_submissions")
        .select("*")
        .eq("host_id", hostId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const entityType = (sub?.entity_type as "individual" | "entity") || "individual";

      // Ensure a GHL contact exists, then trigger the entity-aware document.
      const contactId = targetHost.ghl_contact_id
        || sub?.ghl_contact_id
        || (await upsertHostContact(admin, targetHost));
      let ghlOk = false;
      if (contactId) {
        ghlOk = await sendHostAgreement({
          contactId,
          email: targetHost.email,
          entityType,
          entityName: sub?.entity_name || undefined,
          rateSummary,
          opportunityId: sub?.ghl_opportunity_id || null,
        });
      }

      // Email (Resend) + SMS (GHL) the host that their agreement is ready.
      const firstName = (targetHost.name || "").split(" ")[0] || "there";
      await sendHostEmail(admin, "agreement_sent", targetHost.email, {
        name: firstName,
        rateSummary,
      });
      if (targetHost.phone) {
        await sendSms(admin, {
          toPhone: targetHost.phone,
          type: "confirmation",
          message: `${firstName}, your Novara Host Partnership Agreement (with your rates) is ready to e-sign. Please sign within 24 hours so we can activate your properties. Check your email. - NovaraCleaning`,
        });
      }

      // Advance the onboarding submission lifecycle.
      if (sub?.id) {
        await admin.from("host_onboarding_submissions")
          .update({ status: "agreement_sent" })
          .eq("id", sub.id);
      }

      return json({ ok: true, ghl: ghlOk, contactId, rateSummary });
    }

    // --- admin.sendPaymentLink (role-gated: after a rate is set, send the ---
    // host a Stripe Checkout link to pay for a turnover, by email + SMS).
    // Creates a pending turnover, a Checkout Session (charges now + saves the
    // card for future one-tap), and delivers the link. The existing
    // stripe-webhook → turnover.finalize path captures the payment, assigns a
    // cleaner, and fires the confirmation comms.
    if (action === "admin.sendPaymentLink") {
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
      const isAdmin = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
      if (!isAdmin) return json({ error: "Admins or VAs only" }, 403);

      const propertyId = body.propertyId as string | undefined;
      if (!propertyId) return json({ error: "propertyId required" }, 400);
      if (!body.requested_date) return json({ error: "requested_date required" }, 400);

      const { data: property } = await admin.from("properties").select("*").eq("id", propertyId).maybeSingle();
      if (!property) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
        return json({ error: "Set this property's rate before sending a payment link." }, 409);
      }
      const { data: payHost } = await admin.from("hosts").select("*").eq("id", property.host_id).maybeSingle();
      if (!payHost) return json({ error: "Host not found" }, 404);
      if (!payHost.email && !payHost.phone) {
        return json({ error: "Host has no email or phone to send the link to." }, 409);
      }

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ error: "Stripe is not configured (STRIPE_SECRET_KEY missing)." }, 500);
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

      const priceCents = Math.round(Number(property.turnover_price) * 100);

      const { data: tr, error: trErr } = await admin.from("turnover_requests").insert({
        property_id: property.id,
        host_id: payHost.id,
        requested_date: body.requested_date,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price: Number(property.turnover_price),
        status: "pending_payment",
        notes: (body.notes || "").trim() || null,
      }).select("*").single();
      if (trErr) return json({ error: trErr.message }, 500);

      // Reuse / create the host's Stripe customer so the card is saved for
      // future one-tap turnovers (spec §3.3).
      let customerId = payHost.stripe_customer_id || undefined;
      if (!customerId && payHost.email) {
        const list = await stripe.customers.list({ email: payHost.email, limit: 1 });
        customerId = list.data[0]?.id;
        if (!customerId) {
          const c = await stripe.customers.create({ email: payHost.email, name: payHost.name || undefined });
          customerId = c.id;
        }
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", payHost.id);
      }

      const partnerBase = "https://partner.novaracleaning.com";
      const propLabel = property.nickname || property.address || "Property";
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : (payHost.email || undefined),
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Turnover - ${propLabel}` },
            unit_amount: priceCents,
          },
          quantity: 1,
        }],
        success_url: `${partnerBase}/partner/turnover/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${partnerBase}/partner/dashboard`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover", turnover_id: tr.id, host_id: payHost.id },
      });
      await admin.from("turnover_requests").update({ stripe_checkout_session_id: session.id }).eq("id", tr.id);

      // Deliver the link: email (Resend) + SMS (GHL). Best-effort.
      const firstName = (payHost.name || "").split(" ")[0] || "there";
      const dateLabel = formatServiceDate(body.requested_date as string);
      const windowLabel = fmtWindow(body.window_start as string, body.window_end as string);
      await sendHostEmail(admin, "payment_link", payHost.email, {
        name: firstName,
        property: propLabel,
        address: property.address || "",
        date: dateLabel,
        window: windowLabel,
        price: money(Number(property.turnover_price)),
        checkoutUrl: session.url || "",
      });
      if (payHost.phone && session.url) {
        await sendSms(admin, {
          toPhone: payHost.phone,
          type: "confirmation",
          message: `${firstName}, your Novara turnover for ${propLabel} on ${dateLabel} is ready. Pay ${money(Number(property.turnover_price))} to confirm: ${session.url} - NovaraCleaning`,
        });
      }

      return json({ ok: true, url: session.url, turnoverId: tr.id });
    }

    // --- recurring.save (create/update a weekly OR monthly schedule) -----
    if (action === "recurring.save") {
      const { data: property } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", body.propertyId).maybeSingle();
      if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
      if (property.turnover_price == null || Number(property.turnover_price) <= 0) return json({ error: "Property isn't priced yet." }, 409);
      const frequency = body.frequency === "monthly" ? "monthly" : "weekly";
      if (frequency === "weekly" && !(Array.isArray(body.days_of_week) && body.days_of_week.length > 0)) {
        return json({ error: "Pick at least one day of the week." }, 400);
      }
      const dom = parseInt(String(body.day_of_month), 10);
      if (frequency === "monthly" && !(Number.isFinite(dom) && dom >= 1 && dom <= 31)) {
        return json({ error: "Pick a day of the month (1-31)." }, 400);
      }
      const fields = {
        host_id: host.id,
        property_id: body.propertyId,
        frequency,
        days_of_week: frequency === "weekly" ? body.days_of_week : [],
        day_of_month: frequency === "monthly" ? dom : null,
        window_start: body.window_start || null,
        window_end: body.window_end || null,
        price_snapshot: Number(property.turnover_price),
        active: true,
      };
      if (body.scheduleId) {
        const { data: ex } = await admin.from("recurring_schedules").select("id, host_id").eq("id", body.scheduleId).maybeSingle();
        if (!ex || ex.host_id !== host.id) return json({ error: "Schedule not found" }, 404);
        const { data, error } = await admin.from("recurring_schedules").update(fields).eq("id", body.scheduleId).select("*").single();
        if (error) return json({ error: error.message }, 500);
        return json({ schedule: data });
      }
      const { data, error } = await admin.from("recurring_schedules").insert(fields).select("*").single();
      if (error) return json({ error: error.message }, 500);
      return json({ schedule: data });
    }

    // --- recurring.update (pause / resume / cancel) ----------------------
    if (action === "recurring.update") {
      const { data: sch } = await admin.from("recurring_schedules").select("*").eq("id", body.scheduleId).maybeSingle();
      if (!sch || sch.host_id !== host.id) return json({ error: "Schedule not found" }, 404);
      const upd: Record<string, unknown> = {};
      if (body.op === "cancel") upd.active = false;
      else if (body.op === "resume") { upd.active = true; upd.paused_until = null; }
      else if (body.op === "pause") upd.paused_until = body.paused_until || null;
      else return json({ error: "Unknown op" }, 400);
      await admin.from("recurring_schedules").update(upd).eq("id", sch.id);
      return json({ ok: true });
    }

    // --- batch.checkout (book a whole week of turnovers, pay per clean) --
    if (action === "batch.checkout") {
      const lines: Array<{ propertyId: string; date: string; window_start?: string; window_end?: string }> = Array.isArray(body.lines) ? body.lines : [];
      if (!body.weekStart || lines.length === 0) return json({ error: "weekStart and at least one line required" }, 400);

      // Server-authoritative pricing: re-read each property's current price.
      const priced: Array<{ propertyId: string; date: string; ws: string | null; we: string | null; price: number }> = [];
      let total = 0;
      for (const ln of lines) {
        if (!ln.propertyId || !ln.date) return json({ error: "Each line needs propertyId and date" }, 400);
        const { data: property } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", ln.propertyId).maybeSingle();
        if (!property || property.host_id !== host.id) return json({ error: "Property not found" }, 404);
        if (property.turnover_price == null || Number(property.turnover_price) <= 0) {
          return json({ error: "One of your properties isn't priced yet." }, 409);
        }
        const price = Number(property.turnover_price);
        total += price;
        priced.push({ propertyId: ln.propertyId, date: ln.date, ws: ln.window_start || null, we: ln.window_end || null, price });
      }

      const { data: batch, error: bErr } = await admin.from("booking_batches").insert({
        host_id: host.id, week_start: body.weekStart, source: "manual",
        turnover_count: priced.length, total_amount: total, status: "pending_payment",
      }).select("*").single();
      if (bErr) return json({ error: bErr.message }, 500);

      const rows = priced.map((p) => ({
        property_id: p.propertyId, host_id: host.id, requested_date: p.date,
        window_start: p.ws, window_end: p.we, price: p.price, status: "pending_payment", batch_id: batch.id,
      }));
      const { error: trErr } = await admin.from("turnover_requests").insert(rows);
      if (trErr) return json({ error: trErr.message }, 500);

      // Optionally persist repeat patterns (weekly days or monthly day) from the UI.
      const repeat: Array<{ propertyId: string; frequency?: string; days_of_week?: number[]; day_of_month?: number; window_start?: string; window_end?: string }> = Array.isArray(body.repeat) ? body.repeat : [];
      for (const r of repeat) {
        const { data: rp } = await admin.from("properties").select("id, host_id, turnover_price").eq("id", r.propertyId).maybeSingle();
        if (rp && rp.host_id === host.id && rp.turnover_price != null) {
          const freq = r.frequency === "monthly" ? "monthly" : "weekly";
          await admin.from("recurring_schedules").insert({
            host_id: host.id, property_id: r.propertyId, frequency: freq,
            days_of_week: freq === "weekly" ? (r.days_of_week || []) : [],
            day_of_month: freq === "monthly" ? (r.day_of_month || null) : null,
            window_start: r.window_start || null, window_end: r.window_end || null,
            price_snapshot: Number(rp.turnover_price), active: true,
          });
        }
      }

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      let customerId = host.stripe_customer_id || undefined;
      if (!customerId && host.email) {
        const list = await stripe.customers.list({ email: host.email, limit: 1 });
        customerId = list.data[0]?.id || (await stripe.customers.create({ email: host.email, name: host.name || undefined })).id;
        await admin.from("hosts").update({ stripe_customer_id: customerId }).eq("id", host.id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        customer_email: customerId ? undefined : host.email,
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `Weekly turnovers (${priced.length}) - week of ${body.weekStart}` },
            unit_amount: Math.round(total * 100),
          },
          quantity: 1,
        }],
        success_url: `${origin}/partner/turnover/batch-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/partner/schedule`,
        payment_intent_data: { setup_future_usage: "off_session" },
        metadata: { kind: "turnover_batch", batch_id: batch.id, host_id: host.id },
      });
      await admin.from("booking_batches").update({ stripe_checkout_session_id: session.id }).eq("id", batch.id);
      return json({ url: session.url, batchId: batch.id });
    }

    // --- batch.finalize (verify payment, then assign every turnover) -----
    if (action === "batch.finalize") {
      if (!body.sessionId) return json({ error: "sessionId required" }, 400);
      const { data: batch } = await admin.from("booking_batches").select("*").eq("stripe_checkout_session_id", body.sessionId).maybeSingle();
      if (!batch) return json({ error: "Batch not found" }, 404);

      const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const session = await stripe.checkout.sessions.retrieve(body.sessionId as string);
      const paid = session.payment_status === "paid" || session.status === "complete";

      if (paid && batch.status === "pending_payment") {
        const { data: claimed } = await admin.from("booking_batches").update({
          status: "paid", stripe_payment_intent_id: (session.payment_intent as string) || null,
        }).eq("id", batch.id).eq("status", "pending_payment").select("id");
        if (claimed && claimed.length > 0) await finalizeBatch(admin, batch.id);
      }
      const { data: after } = await admin.from("booking_batches").select("status, turnover_count, total_amount, week_start").eq("id", batch.id).single();
      return json({ paid, status: after?.status, count: after?.turnover_count, total: after?.total_amount, weekStart: after?.week_start });
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

// Charge the outstanding amount when a turnover is completed:
//   • split     → the remaining 50% balance
//   • pay_after → the full price
//   • full      → no-op (already paid up front)
// Off-session against the host's saved card. Idempotent via balance_charged_at.
async function chargeOnCompletion(admin: SB, trId: string) {
  const { data: tr } = await admin.from("turnover_requests").select("*").eq("id", trId).maybeSingle();
  if (!tr) return;
  const option = (tr.payment_option as string) || "full";
  if (option === "full") return;
  if (tr.balance_charged_at) return; // already settled

  const priceCents = Math.round(Number(tr.price || 0) * 100);
  const balanceCents =
    tr.balance_cents != null
      ? Number(tr.balance_cents)
      : option === "split"
        ? priceCents - Number(tr.deposit_cents || 0)
        : priceCents;
  if (!(balanceCents > 0)) {
    await admin.from("turnover_requests").update({ balance_charged_at: new Date().toISOString() }).eq("id", trId);
    return;
  }

  const { data: host } = await admin.from("hosts").select("*").eq("id", tr.host_id).maybeSingle();
  if (!host?.stripe_customer_id) {
    console.warn("[partner-turnover] completion charge skipped — no Stripe customer", { trId });
    return;
  }
  const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const card = await getDefaultCard(stripe, host.stripe_customer_id);
  if (!card) {
    console.warn("[partner-turnover] completion charge skipped — no card on file", { trId });
    return;
  }
  try {
    const pi = await stripe.paymentIntents.create({
      amount: balanceCents,
      currency: "usd",
      customer: host.stripe_customer_id,
      payment_method: card.id,
      off_session: true,
      confirm: true,
      metadata: { kind: "turnover_balance", turnover_id: trId, host_id: tr.host_id },
    });
    if (pi.status === "succeeded") {
      await admin.from("turnover_requests").update({
        balance_payment_intent_id: pi.id,
        balance_charged_at: new Date().toISOString(),
      }).eq("id", trId);
    } else {
      console.warn("[partner-turnover] completion charge not succeeded", { trId, status: pi.status });
    }
  } catch (e) {
    // Leave balance_charged_at null so it can be retried / resolved by admin.
    console.warn("[partner-turnover] completion charge failed", e instanceof Error ? e.message : String(e));
  }
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
  if (paidHost?.phone) {
    await sendSms(admin, {
      toPhone: paidHost.phone,
      message: `Payment received — your ${formatServiceDate(tr.requested_date as string)} turnover at ${paidProp?.nickname || paidProp?.address || "your property"} is booked. We're assigning your cleaner now. - NovaraCleaning`,
      type: "confirmation",
    });
  }
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
    await sendHostEmail(admin, "turnover_in_progress", hostRow?.email, {
      name: (hostRow?.name || "").split(" ")[0] || "",
      property: property?.nickname || property?.address || "",
      address: property?.address || "",
      date: formatServiceDate(tr.requested_date as string),
    });
    return json({ ok: true, status: "in_progress" });
  }

  if (action === "cleaner.complete") {
    // STRICT (spec): cannot complete without photos. Merge any photos passed on
    // this call with what was already uploaded (check-in / "add photos"), and
    // refuse if there are still zero after-photos. This gate also blocks the
    // SMS "DONE" path, which never carries photos — forcing the app upload.
    const incoming = Array.isArray(body.after_photos) ? (body.after_photos as string[]) : [];
    const existing = Array.isArray(tr.after_photos) ? (tr.after_photos as string[]) : [];
    const afterPhotos = Array.from(new Set([...existing, ...incoming].filter(Boolean)));
    if (afterPhotos.length === 0) {
      return json(
        { error: "Photos required — upload at least one 'after' photo in the app before marking complete.", needsPhotos: true },
        422,
      );
    }
    await admin.from("turnover_requests").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      after_photos: afterPhotos,
    }).eq("id", tr.id);

    // Charge the balance (split) or full amount (pay_after) off-session now
    // that the service is verified complete. No-op for already-fully-paid.
    await chargeOnCompletion(admin, tr.id);

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
  // CRITICAL: every completion sends the proof photos to the host (SMS + email).
  const photos = Array.isArray(tr.after_photos) ? (tr.after_photos as string[]).filter(Boolean) : [];

  // Open before/after gallery — a single login-free link the host can view and
  // forward (e.g. to a co-host or guest). Mint once and reuse.
  let galleryUrl = "https://partner.novaracleaning.com/partner/dashboard";
  try {
    let viewToken = (tr.photo_view_token as string | null) || null;
    if (!viewToken) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      viewToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      await admin.from("turnover_requests").update({ photo_view_token: viewToken }).eq("id", tr.id);
    }
    galleryUrl = `https://try.novaracleaning.com/photos/${viewToken}`;
  } catch (e) {
    console.warn("[partner-turnover] view token mint failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }

  await notifyDiscord(admin, {
    title: "Turnover completed",
    color: 3066993,
    fields: [
      { name: "Property", value: nickname, inline: true },
      { name: "When", value: dateLabel, inline: true },
      { name: "Host", value: hostRow?.name || hostRow?.email || "-", inline: true },
      { name: "Photos", value: String(photos.length), inline: true },
    ],
  });
  if (hostRow?.phone) {
    const photoLine = photos.length
      ? ` View the ${photos.length} before/after photo${photos.length === 1 ? "" : "s"}: ${galleryUrl}`
      : "";
    await sendSms(admin, {
      toPhone: hostRow.phone, type: "confirmation",
      message: `${nickname} is guest-ready! Your ${dateLabel} turnover is complete.${photoLine} Rate your clean: https://partner.novaracleaning.com/partner/dashboard - NovaraCleaning`,
    });
  }
  await sendHostEmail(admin, "turnover_completed", hostRow?.email, {
    name: (hostRow?.name || "").split(" ")[0] || "",
    property: nickname,
    address: property?.address || "",
    date: dateLabel,
    photos,
    galleryUrl,
  });
  try {
    await syncTurnoverToGhl(admin, { host: hostRow, property, turnover: { ...tr, status: "completed" } });
  } catch (e) {
    console.warn("[partner-turnover] completion GHL sync failed (non-blocking)", e instanceof Error ? e.message : String(e));
  }
}
