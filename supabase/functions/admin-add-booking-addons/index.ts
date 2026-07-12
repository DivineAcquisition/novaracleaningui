// admin-add-booking-addons
//
// Admin/VA: add (or change) add-on services on a booking - works EVEN after
// the booking is completed. Recomputes the price delta server-side from the
// canonical pricing, persists the new add-ons + total, charges the delta to
// the card on file (off-session), and falls back to a hosted Stripe invoice
// when there's no saved card. Emails the customer either way. Writes an audit
// row to booking_addon_charges.
//
// Body: { bookingId: string, addOns: string[] (the NEW complete set), charge?: boolean, addOnPrices?: Record<string, number> (dollars) }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { resolveOffSessionPaymentMethod } from "../_shared/resolve-off-session-payment-method.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Add-on catalog (mirrors src/lib/pricing.ts ADD_ONS - price in dollars + label).
const ADD_ONS: Record<string, { price: number; label: string }> = {
  fridge: { price: 30, label: "Inside Fridge" },
  oven: { price: 30, label: "Inside Oven" },
  windows: { price: 40, label: "Interior Windows" },
  laundry: { price: 35, label: "Laundry - wash & fold" },
  changeLinens: { price: 15, label: "Change bed linens" },
  dishes: { price: 20, label: "Dishes & kitchen cleanup" },
  baseboards: { price: 35, label: "Baseboards" },
  blinds: { price: 30, label: "Blinds & shutters" },
  cabinets: { price: 35, label: "Inside cabinets" },
  walls: { price: 40, label: "Spot wall washing" },
  ceilingFans: { price: 15, label: "Ceiling fans" },
  microwave: { price: 10, label: "Inside microwave" },
  dishwasher: { price: 15, label: "Inside dishwasher" },
  garage: { price: 50, label: "Garage sweep-out" },
  basement: { price: 75, label: "Basement clean" },
  patio: { price: 35, label: "Patio / balcony" },
  petHair: { price: 35, label: "Heavy pet-hair removal" },
  closets: { price: 30, label: "Inside closets" },
  trashHaul: { price: 75, label: "Trash haul" },
  deepBathroomDetail: { price: 45, label: "Deep bathroom detail" },
};
const labelOf = (id: string) => ADD_ONS[id]?.label || id;
const priceOf = (id: string, overrides?: Record<string, number>) => {
  const raw = overrides?.[id];
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return ADD_ONS[id]?.price || 0;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
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

    const body = await req.json();
    const bookingId = String(body.bookingId || "");
    const charge = body.charge !== false;
    const newAddOns: string[] = Array.from(new Set((Array.isArray(body.addOns) ? body.addOns : []).map(String)));
    const addOnPrices: Record<string, number> = {};
    if (body.addOnPrices && typeof body.addOnPrices === "object") {
      for (const [k, v] of Object.entries(body.addOnPrices as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) addOnPrices[String(k)] = n;
      }
    }
    const retryChargeAuditId = body.retryChargeAuditId ? String(body.retryChargeAuditId) : null;
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const { data: booking } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!booking) return json({ error: "Booking not found" }, 404);

    const oldAddOns: string[] = Array.isArray(booking.add_ons) ? booking.add_ons.map(String) : [];
    let added = newAddOns.filter((a) => !oldAddOns.includes(a));
    let removed = oldAddOns.filter((a) => !newAddOns.includes(a));
    let retryMode = false;

    // Retry a prior no_charge audit (e.g. deploy lag left new add-on ids at $0).
    if (retryChargeAuditId) {
      const { data: prior } = await admin.from("booking_addon_charges")
        .select("*")
        .eq("id", retryChargeAuditId)
        .eq("booking_id", bookingId)
        .maybeSingle();
      if (!prior) return json({ error: "Retry audit row not found." }, 404);
      if (prior.status !== "no_charge" || Number(prior.amount_cents) !== 0) {
        return json({ error: "That add-on charge was already collected or is not retryable." }, 400);
      }
      added = Array.isArray(prior.added_addons) ? prior.added_addons.map(String) : [];
      removed = [];
      retryMode = true;
      if (added.length === 0) return json({ error: "Nothing to retry on that audit row." }, 400);
    } else if (added.length === 0 && removed.length === 0) {
      return json({ error: "No add-on changes." }, 400);
    }

    const unknown = [...new Set([...added, ...removed, ...newAddOns])].filter((id) => !ADD_ONS[id]);
    if (unknown.length) {
      return json({ error: `Unknown add-on id(s): ${unknown.join(", ")}. Deploy the latest admin-add-booking-addons function.` }, 400);
    }

    // Add-on price delta (server-authoritative). Move-In/Out already includes
    // fridge + oven, so those two are free there; everything else is billable.
    const st = String(booking.service_type || "standard");
    const chargeable = (a: string) => st === "moveInOut" ? (a !== "fridge" && a !== "oven") : true;
    const sumC = (ids: string[], useOverrides: boolean) =>
      ids.filter(chargeable).reduce((s, a) => {
        const dollars = useOverrides ? priceOf(a, addOnPrices) : priceOf(a);
        return s + Math.round(dollars * 100);
      }, 0);
    const deltaCents = sumC(added, true) - sumC(removed, false);
    const pricedAdded = added.map((id) => ({
      id,
      label: labelOf(id),
      price: chargeable(id) ? priceOf(id, addOnPrices) : 0,
    }));

    const oldTotalCents = Number(booking.total_estimate_cents || 0);
    const newTotalCents = Math.max(0, oldTotalCents + deltaCents);

    // Persist the new add-on set + total across the board.
    const noteLine = `Add-ons updated by admin ${new Date().toISOString().slice(0, 10)}: +[${pricedAdded.map((p) => `${p.label}${p.price ? ` $${p.price.toFixed(2)}` : ""}`).join(", ") || "none"}]${removed.length ? ` -[${removed.map(labelOf).join(", ")}]` : ""} (delta $${(deltaCents / 100).toFixed(2)}).`;
    const patch: Record<string, unknown> = {
      total_estimate_cents: newTotalCents,
      team_notes: [(booking.team_notes as string | null) || "", noteLine].filter(Boolean).join("\n"),
    };
    if (!retryMode) patch.add_ons = newAddOns;
    if (booking.final_charge_cents != null) {
      patch.final_charge_cents = Math.max(0, Number(booking.final_charge_cents) + deltaCents);
    }
    if (!retryMode) {
      await admin.from("bookings").update(patch).eq("id", bookingId);
    } else if (patch.total_estimate_cents !== oldTotalCents || patch.final_charge_cents != null) {
      await admin.from("bookings").update(patch).eq("id", bookingId);
    }

    let auditId: string | undefined;
    if (retryMode && retryChargeAuditId) {
      auditId = retryChargeAuditId;
      await admin.from("booking_addon_charges").update({
        amount_cents: Math.max(0, deltaCents),
        status: "pending",
        note: noteLine,
      }).eq("id", auditId);
    } else {
      const { data: auditRow } = await admin.from("booking_addon_charges").insert({
        booking_id: bookingId,
        added_addons: added,
        removed_addons: removed,
        amount_cents: Math.max(0, deltaCents),
        status: "pending",
        created_by: callerId,
        note: noteLine,
      }).select("id").single();
      auditId = auditRow?.id;
    }

    const bookingRef = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : `BK-${bookingId.slice(0, 8)}`;

    // Best-effort customer SMS (GHL primary). Never blocks the charge flow.
    const smsCustomer = async (message: string) => {
      const phone = String(booking.phone || "").trim();
      if (!phone) return;
      try {
        await admin.functions.invoke("send-ghl-sms", {
          body: { phone, email: booking.email || undefined, firstName: booking.first_name || undefined, message, type: "addon_update" },
        });
      } catch (smsErr) {
        console.warn("[admin-add-booking-addons] customer SMS failed (non-blocking)", smsErr instanceof Error ? smsErr.message : String(smsErr));
      }
    };
    const addOnListForSms = pricedAdded.map((p) => p.label).join(", ");
    const emailData = {
      name: booking.first_name || "",
      addOns: pricedAdded.map((p) => (p.price ? `${p.label} ($${p.price.toFixed(2)})` : p.label)),
      amount: `$${(Math.max(0, deltaCents) / 100).toFixed(2)}`,
      serviceDate: booking.service_date || "",
      bookingRef,
    };

    // Nothing to collect (only removals / zero delta).
    if (!charge || deltaCents <= 0) {
      if (charge && added.length > 0 && deltaCents <= 0) {
        return json({
          error: "Add-on charge would be $0.00 - the server may be missing this add-on in its catalog. Retry after deploy or contact support.",
          deltaCents,
          addedAddOns: added,
        }, 400);
      }
      if (auditId) await admin.from("booking_addon_charges").update({ status: "no_charge" }).eq("id", auditId);
      return json({ ok: true, charged: false, status: "no_charge", deltaCents, newTotalCents, addedAddOns: added, removedAddOns: removed });
    }

    const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Resolve / create the Stripe customer.
    let customerId: string | null = null;
    if (booking.customer_id && String(booking.customer_id).startsWith("cus_")) customerId = booking.customer_id;
    if (!customerId && booking.email) {
      const { data: custRow } = await admin.from("customers").select("stripe_customer_id").eq("email", booking.email).maybeSingle();
      if (custRow?.stripe_customer_id?.startsWith("cus_")) customerId = custRow.stripe_customer_id;
    }
    if (!customerId && booking.email) {
      const found = await stripe.customers.list({ email: booking.email, limit: 1 });
      customerId = found.data[0]?.id ?? null;
      if (!customerId) {
        const created = await stripe.customers.create({ email: booking.email, name: `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || undefined });
        customerId = created.id;
      }
    }
    if (!customerId) throw new Error("No customer email on booking to charge.");

    const description = `${bookingRef} - Add-on services: ${pricedAdded.map((p) => p.label).join(", ")}`;

    // AUTO-CHARGE ONLY (operator directive 2026-07-09): add-ons are charged
    // to the card on file off-session and the customer is simply NOTIFIED —
    // we never text/email a pay-me invoice link for add-ons.
    const pmId = await resolveOffSessionPaymentMethod(stripe, customerId).catch(() => null);
    if (pmId) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: deltaCents, currency: "usd", customer: customerId, payment_method: pmId,
          off_session: true, confirm: true, description,
          metadata: { booking_id: bookingId, chargeType: "addon_charge", added: added.join(",") },
        });
        if (pi.status === "succeeded") {
          if (auditId) await admin.from("booking_addon_charges").update({ status: "paid", stripe_payment_intent_id: pi.id }).eq("id", auditId);
          await admin.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
          if (booking.email) {
            await admin.functions.invoke("send-addon-email", { body: { type: "addon_charged", email: booking.email, data: emailData } }).catch(() => {});
          }
          await smsCustomer(
            `Novara Cleaning: We added ${addOnListForSms} to your cleaning${booking.service_date ? ` on ${booking.service_date}` : ""} and charged your card on file $${(deltaCents / 100).toFixed(2)}. A receipt was emailed to you. Questions? Call (844) 735-2070.`,
          );
          // NOTE: PostgrestBuilder is a thenable without .catch() — calling
          // .catch() on it throws a TypeError AFTER the charge succeeds.
          // Use .then(onOk, onErr) for fire-and-forget error swallowing.
          await admin.from("events").insert({ event_type: "booking.addon_charged", booking_id: bookingId, source: "admin", summary: `Add-ons charged $${(deltaCents / 100).toFixed(2)}`, data: { added, removed, pi: pi.id, by: callerId } }).then(() => undefined, () => undefined);
          return json({ ok: true, charged: true, status: "paid", deltaCents, newTotalCents, addedAddOns: added, removedAddOns: removed, paymentIntentId: pi.id });
        }
      } catch (e) {
        console.warn("[admin-add-booking-addons] off-session charge failed", e instanceof Error ? e.message : String(e));
      }
    }

    // Auto-charge unavailable (no saved card or declined). The add-ons stay
    // on the booking and the delta is already rolled into the booking total,
    // so the normal balance-collection flow picks it up. Customer gets an
    // informational note only; the ADMIN is told the auto-charge failed.
    if (auditId) await admin.from("booking_addon_charges").update({ status: "charge_failed" }).eq("id", auditId);
    await admin.from("bookings").update({ customer_id: customerId }).eq("id", bookingId);
    await smsCustomer(
      `Novara Cleaning: We added ${addOnListForSms} to your cleaning${booking.service_date ? ` on ${booking.service_date}` : ""}. Your updated total is $${(newTotalCents / 100).toFixed(2)} — no action needed. Questions? Call (844) 735-2070.`,
    );
    await admin.from("events").insert({ event_type: "booking.addon_charge_failed", booking_id: bookingId, source: "admin", summary: `Add-ons added ($${(deltaCents / 100).toFixed(2)}) but auto-charge failed — will collect with booking balance.`, data: { added, removed, by: callerId } }).then(() => undefined, () => undefined);

    return json({ ok: true, charged: false, status: "charge_failed", deltaCents, newTotalCents, addedAddOns: added, removedAddOns: removed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-add-booking-addons]", msg);
    return json({ error: msg }, 500);
  }
});
