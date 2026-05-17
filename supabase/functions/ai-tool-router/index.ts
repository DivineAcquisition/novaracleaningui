// ─── Telnyx AI Assistant tool router ─────────────────────────────────────
// Single endpoint that backs every tool the AI ("Glow") can call. Telnyx
// passes ?tool=<name> in the query string + a JSON body matching the
// tool's schema. We dispatch on `tool`, run the right work, and return
// the JSON the assistant uses to write its next reply.
//
// Tools:
//   lookup_customer      — phone → full contact + outstanding + payment link
//   check_service_area   — zip → serviced + city/state/zone
//   get_price_estimate   — home_size_id + service_type + add_ons → $$$
//   get_available_slots  — date → 5 nearest open slots
//   create_booking       — full booking → pending_payment row + Stripe Payment Link
//   handle_keyword       — R/C/YES/NO/STOP/HELP → existing sms-inbound function
//   add_to_waitlist      — out-of-area → waitlist row
//   escalate_to_human    — flag conversation for human takeover
//
// Every call is logged to public.ai_tool_calls for monitoring.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details?: unknown) => {
  console.log(`[AI-TOOL] ${step}`, details === undefined ? "" : JSON.stringify(details));
};

// ─── Pricing (mirrors src/lib/pricing-system.ts v3.4) ─────────────────────
const HOME_SIZE_PRICE: Record<string, number> = {
  "0_999": 270,
  "1000_1500": 342,
  "1501_2000": 432,
  "2001_2500": 504,
  "2501_3000": 612,
  "3001_3500": 684,
  "3501_4000": 792,
  "4001_4500": 882,
  "4501_5000": 972,
  "5000_plus": 0, // requires custom quote
};
const HOME_SIZE_HOURS: Record<string, number> = {
  "0_999": 2.0, "1000_1500": 2.5, "1501_2000": 3.0, "2001_2500": 3.5,
  "2501_3000": 4.0, "3001_3500": 4.5, "3501_4000": 5.0, "4001_4500": 5.5,
  "4501_5000": 6.0, "5000_plus": 8.0,
};
const SERVICE_MULT: Record<string, number> = {
  standard: 1.0, deep: 1.5, combo: 2.5, moveInOut: 2.0,
};
const ADD_ON_PRICE: Record<string, number> = { fridge: 30, oven: 30, windows: 40 };
const MEMBERSHIP_DISCOUNT: Record<string, number> = { none: 0, monthly: 0.20, biweekly: 0.25, weekly: 0.30 };
const NEW_CUSTOMER_DISCOUNT_PCT = 0.5;
const DEPOSIT_PCT = 0.5;
const ACCOUNT_PORTAL_URL = "https://try.novaracleaning.com/account";

function calcPrice(args: {
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
  membershipPlan: string;
  isNewCustomer: boolean;
}): { subtotalCents: number; promoCents: number; totalCents: number; depositCents: number } {
  const base = HOME_SIZE_PRICE[args.homeSizeId] || 0;
  const mult = SERVICE_MULT[args.serviceType] ?? 1.0;
  const serviceCost = base * mult;
  // Move-In/Out bundles fridge + oven; ignore those add-ons.
  const filteredAddOns = args.serviceType === "moveInOut"
    ? args.addOns.filter((a) => !["fridge", "oven"].includes(a))
    : args.addOns;
  const addOnTotal = filteredAddOns.reduce((s, a) => s + (ADD_ON_PRICE[a] || 0), 0);
  const subtotal = serviceCost + addOnTotal;
  // Promo eligibility: new customers OR all customers on standard/deep/combo
  // (membership has its own per-clean savings; promo doesn't stack)
  const promoEligible = args.membershipPlan === "none"
    && ["standard", "deep", "combo"].includes(args.serviceType);
  const promo = promoEligible ? subtotal * NEW_CUSTOMER_DISCOUNT_PCT : 0;
  // Membership discount on extras only
  const membershipDiscount = (MEMBERSHIP_DISCOUNT[args.membershipPlan] || 0) * (serviceCost - base + addOnTotal);
  const total = Math.round((subtotal - promo - membershipDiscount) * 100);
  const deposit = Math.round(total * DEPOSIT_PCT);
  return {
    subtotalCents: Math.round(subtotal * 100),
    promoCents: Math.round(promo * 100),
    totalCents: total,
    depositCents: deposit,
  };
}

// ─── E.164 helper ─────────────────────────────────────────────────────────
function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("+")) return String(raw);
  return `+${digits}`;
}

// ─── Tools ────────────────────────────────────────────────────────────────

async function toolLookupCustomer(supabase: any, body: any): Promise<unknown> {
  const phone = toE164(body.phone);
  const lastTen = phone.replace(/\D/g, "").slice(-10);
  if (!lastTen) return { found: false };

  // Most recent booking on this phone (fuzzy match across stored formats)
  const { data: rows } = await supabase
    .from("bookings")
    .select("id, status, first_name, last_name, email, phone, address, city, state, zip_code, service_date, time_slot, service_type, total_estimate_cents, final_charge_cents, deposit_cents, cancel_fee_cents, reschedule_fee_cents, membership_plan, ghl_synced_at, booking_number")
    .ilike("phone", `%${lastTen}%`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!rows || rows.length === 0) return { found: false };

  const newest = rows[0];
  const completed = rows.filter((r: any) => r.status === "completed");
  const lifetimeCents = completed.reduce(
    (s: number, r: any) => s + (r.final_charge_cents || r.total_estimate_cents || 0),
    0,
  );
  const next = rows.find((r: any) =>
    ["pending_payment", "confirmed", "assigned"].includes(r.status)
    && r.service_date && new Date(`${r.service_date}T12:00:00`).getTime() > Date.now()
  );
  // Outstanding = sum of remaining + fees across active bookings
  const active = rows.filter((r: any) => !["cancelled", "completed"].includes(r.status));
  const outstandingCents = active.reduce((s: number, r: any) => {
    const total = r.final_charge_cents || r.total_estimate_cents || 0;
    const remaining = Math.max(0, total - (r.deposit_cents || 0));
    return s + remaining + (r.cancel_fee_cents || 0) + (r.reschedule_fee_cents || 0);
  }, 0);

  // Payment Link for outstanding balance (Stripe)
  let paymentLinkForBalance: string | null = null;
  if (outstandingCents > 0) {
    try {
      const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" as any });
      const price: any = await stripe.prices.create({
        currency: "usd",
        unit_amount: outstandingCents,
        product_data: { name: `Outstanding balance — ${newest.first_name || ""} ${newest.last_name || ""}`.trim() },
      });
      const link: any = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { phone, kind: "outstanding_balance" },
        after_completion: { type: "redirect", redirect: { url: `${ACCOUNT_PORTAL_URL}?payment=success` } },
      });
      paymentLinkForBalance = link.url;
    } catch (e) { log("paymentLink create failed", e); }
  }

  const isMember = !!(newest.membership_plan && newest.membership_plan !== "none");
  const paymentStatus = outstandingCents > 0
    ? (next?.service_date && Date.parse(`${next.service_date}T12:00:00`) < Date.now() ? "Past Due" : "Current")
    : "Current";

  return {
    found: true,
    first_name: newest.first_name,
    last_name: newest.last_name,
    email: newest.email,
    address1: newest.address,
    city: newest.city,
    state: newest.state,
    zip_code: newest.zip_code,
    is_member: isMember,
    novara_glow_plan: isMember ? newest.membership_plan : null,
    lifetime_revenue_cents: lifetimeCents,
    total_bookings: rows.length,
    completed_bookings: completed.length,
    outstanding_balance_cents: outstandingCents,
    payment_status: paymentStatus,
    next_booking: next ? {
      id: next.id,
      service_date: next.service_date,
      time_slot: next.time_slot,
      service_type: next.service_type,
      status: next.status,
    } : null,
    payment_link_for_balance: paymentLinkForBalance,
  };
}

async function toolCheckServiceArea(supabase: any, body: any): Promise<unknown> {
  const zip = String(body.zip_code || "").replace(/\D/g, "").slice(0, 5);
  if (!zip) return { serviced: false, zip_code: "" };
  const { data } = await supabase
    .from("service_coverage_zones")
    .select("city, state, zone")
    .eq("zip_code", zip)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return { serviced: false, zip_code: zip };
  return { serviced: true, zip_code: zip, city: data.city, state: data.state, zone: data.zone };
}

function toolGetPriceEstimate(body: any): unknown {
  const homeSizeId = String(body.home_size_id || "");
  const serviceType = String(body.service_type || "standard");
  const addOns = Array.isArray(body.add_ons) ? body.add_ons.map(String) : [];
  const membershipPlan = String(body.membership_plan || "none");
  const isNewCustomer = body.is_new_customer !== false; // default true
  if (homeSizeId === "5000_plus") {
    return {
      subtotal_cents: 0,
      promo_discount_cents: 0,
      total_cents: 0,
      deposit_cents: 0,
      remaining_cents: 0,
      human_summary: "5,000+ sqft homes need a custom quote — escalating to a human.",
      requires_custom_quote: true,
    };
  }
  const p = calcPrice({ homeSizeId, serviceType, addOns, membershipPlan, isNewCustomer });
  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  const summary = `Total ${fmt(p.totalCents)} (${fmt(p.promoCents)} off thanks to the 50% NEW promo). Deposit today ${fmt(p.depositCents)}, balance ${fmt(p.totalCents - p.depositCents)} after we finish.`;
  return {
    subtotal_cents: p.subtotalCents,
    promo_discount_cents: p.promoCents,
    total_cents: p.totalCents,
    deposit_cents: p.depositCents,
    remaining_cents: p.totalCents - p.depositCents,
    human_summary: summary,
  };
}

async function toolGetAvailableSlots(supabase: any, body: any): Promise<unknown> {
  const serviceDate = String(body.service_date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return { service_date: serviceDate, available_slots: [], fully_booked: false, error: "invalid_date" };
  }
  // Disallow Sundays + < 3 days out
  const dt = new Date(`${serviceDate}T12:00:00`);
  const minDt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  if (dt < minDt || dt.getDay() === 0) {
    return { service_date: serviceDate, available_slots: [], fully_booked: true, error: "date_not_bookable" };
  }
  const CANDIDATE_SLOTS = [
    { id: "9:00 AM - 10:00 AM",  label: "9:00 AM",  start_time: "09:00", end_time: "10:00" },
    { id: "10:00 AM - 11:00 AM", label: "10:00 AM", start_time: "10:00", end_time: "11:00" },
    { id: "11:00 AM - 12:00 PM", label: "11:00 AM", start_time: "11:00", end_time: "12:00" },
    { id: "12:00 PM - 1:00 PM",  label: "12:00 PM", start_time: "12:00", end_time: "13:00" },
    { id: "1:00 PM - 2:00 PM",   label: "1:00 PM",  start_time: "13:00", end_time: "14:00" },
    { id: "2:00 PM - 3:00 PM",   label: "2:00 PM",  start_time: "14:00", end_time: "15:00" },
    { id: "3:00 PM - 4:00 PM",   label: "3:00 PM",  start_time: "15:00", end_time: "16:00" },
    { id: "4:00 PM - 5:00 PM",   label: "4:00 PM",  start_time: "16:00", end_time: "17:00" },
    { id: "5:00 PM - 6:00 PM",   label: "5:00 PM",  start_time: "17:00", end_time: "18:00" },
  ];
  // Booked time_slots for that date — remove from candidates.
  const { data: booked } = await supabase
    .from("bookings")
    .select("time_slot")
    .eq("service_date", serviceDate)
    .in("status", ["pending_payment", "confirmed", "assigned"]);
  const bookedSet = new Set((booked || []).map((b: any) => b.time_slot));
  const remaining = CANDIDATE_SLOTS.filter((s) => !bookedSet.has(s.id));
  return {
    service_date: serviceDate,
    available_slots: remaining.slice(0, 5),
    fully_booked: remaining.length === 0,
  };
}

async function toolCreateBooking(supabase: any, body: any): Promise<unknown> {
  // Required field guard
  const required = [
    "first_name", "last_name", "email", "phone", "address", "city", "state",
    "zip_code", "bedrooms", "bathrooms", "dwelling_type", "home_size_id",
    "service_type", "service_date", "time_slot",
  ];
  for (const k of required) {
    if (!body[k] && body[k] !== 0) return { error: `missing_field: ${k}` };
  }
  const homeSizeId = String(body.home_size_id);
  const serviceType = String(body.service_type);
  const addOns: string[] = Array.isArray(body.add_ons) ? body.add_ons : [];
  const membershipPlan = String(body.membership_plan || "none");
  const p = calcPrice({ homeSizeId, serviceType, addOns, membershipPlan, isNewCustomer: true });

  // Next booking number
  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true });
  const bookingNumber = (count || 0) + 1;

  // Insert provisional booking
  const { data: booking, error: insErr } = await supabase
    .from("bookings")
    .insert({
      email: body.email,
      first_name: body.first_name,
      last_name: body.last_name,
      phone: toE164(body.phone),
      address: body.address,
      city: body.city,
      state: body.state,
      zip_code: body.zip_code,
      bedrooms: Number(body.bedrooms),
      bathrooms: Number(body.bathrooms),
      dwelling_type: body.dwelling_type,
      home_size_id: homeSizeId,
      service_type: serviceType,
      offer_type: serviceType,
      add_ons: addOns,
      service_date: body.service_date,
      time_slot: body.time_slot,
      membership_plan: membershipPlan,
      base_price_cents: HOME_SIZE_PRICE[homeSizeId] * SERVICE_MULT[serviceType] * 100,
      total_estimate_cents: p.totalCents,
      deposit_cents: p.depositCents,
      payment_option: "deposit",
      status: "pending_payment",
      booking_number: bookingNumber,
      booking_channel: "SMS Assistant",
      booker_source: "Glow AI Assistant",
      access_notes: body.access_notes || null,
    })
    .select()
    .single();
  if (insErr) return { error: `booking_insert_failed: ${insErr.message}` };

  // Stripe Payment Link for the deposit
  let paymentLinkUrl = "";
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" as any });
    const price: any = await stripe.prices.create({
      currency: "usd",
      unit_amount: p.depositCents,
      product_data: { name: `NOV-${String(bookingNumber).padStart(5, "0")} — 50% deposit` },
    });
    const link: any = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: booking.id, kind: "deposit", source: "ai_assistant" },
      after_completion: { type: "redirect", redirect: { url: `https://try.novaracleaning.com/account?payment=success` } },
    });
    paymentLinkUrl = link.url;
  } catch (e) {
    log("payment link create failed", e);
    return { error: `payment_link_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  return {
    booking_id: booking.id,
    booking_number: bookingNumber,
    payment_link: paymentLinkUrl,
    deposit_cents: p.depositCents,
    total_cents: p.totalCents,
    service_date: body.service_date,
    time_slot: body.time_slot,
  };
}

async function toolHandleKeyword(supabase: any, body: any): Promise<unknown> {
  // Hand off to the existing sms-inbound function — it owns the
  // R/C/YES/NO/STOP/HELP flows + fee disclosures + LeadConnector mirror.
  // We pass through Telnyx's standard inbound shape.
  const phone = toE164(body.phone);
  const keyword = String(body.keyword || "").toUpperCase();
  try {
    const { data } = await supabase.functions.invoke("sms-inbound", {
      body: {
        data: {
          event_type: "message.received",
          payload: {
            from: { phone_number: phone },
            to: [{ phone_number: "+18334432004" }],
            text: keyword,
            id: `ai-tool-${Date.now()}`,
          },
        },
      },
    });
    return { reply_text: "(Handled by sms-inbound — see ack on the wire.)", action_taken: data?.action || "unknown" };
  } catch (e) {
    return { reply_text: "Sorry, something went wrong. Call (844) 735-2070 and we'll take care of it.", action_taken: "error" };
  }
}

async function toolAddToWaitlist(supabase: any, body: any): Promise<unknown> {
  try {
    const { data } = await supabase.functions.invoke("add-to-waitlist", {
      body: {
        email: body.email,
        firstName: body.first_name,
        lastName: body.last_name,
        phone: toE164(body.phone),
        zipCode: body.zip_code,
        source: "AI Assistant",
      },
    });
    return { ok: true, waitlist_id: (data as any)?.id || null };
  } catch (e) {
    return { ok: false, waitlist_id: null };
  }
}

async function toolEscalateToHuman(supabase: any, body: any): Promise<unknown> {
  const phone = toE164(body.phone);
  // Match to the most recent booking on this phone (for context).
  let matchedBookingId: string | null = null;
  try {
    const lastTen = phone.replace(/\D/g, "").slice(-10);
    if (lastTen) {
      const { data: b } = await supabase
        .from("bookings")
        .select("id")
        .ilike("phone", `%${lastTen}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      matchedBookingId = b?.id || null;
    }
  } catch (_) { /* ignore */ }

  const { data: row, error } = await supabase
    .from("ai_escalations")
    .insert({
      phone,
      reason: String(body.reason || "other"),
      summary: String(body.summary || "").slice(0, 1000),
      matched_booking_id: matchedBookingId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, ticket_id: null };

  // Lock down AI auto-replies for 4 hrs by stamping the booking row.
  if (matchedBookingId) {
    try {
      await supabase
        .from("bookings")
        .update({ ai_human_takeover_until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() })
        .eq("id", matchedBookingId);
    } catch (_) { /* ignore */ }
  }

  // Best-effort SMS to ops on-call (no-op if env var not set)
  const opsPhone = Deno.env.get("AI_ESCALATION_NOTIFY_PHONE");
  if (opsPhone) {
    try {
      await supabase.functions.invoke("send-sms-notification", {
        body: {
          toPhone: opsPhone,
          message: `Novara AI escalation [${body.reason}]: ${phone} — ${body.summary}`,
          type: "confirmation",
        },
      });
    } catch (_) { /* ignore */ }
  }
  return { ok: true, ticket_id: row.id };
}

// ─── Server ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const url = new URL(req.url);
  const tool = url.searchParams.get("tool") || body.tool;
  if (!tool) {
    return new Response(JSON.stringify({ error: "missing ?tool= query param" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let result: unknown;
  let httpStatus = 200;
  let errMsg: string | null = null;

  try {
    switch (tool) {
      case "lookup_customer":    result = await toolLookupCustomer(supabase, body); break;
      case "check_service_area": result = await toolCheckServiceArea(supabase, body); break;
      case "get_price_estimate": result = toolGetPriceEstimate(body); break;
      case "get_available_slots": result = await toolGetAvailableSlots(supabase, body); break;
      case "create_booking":     result = await toolCreateBooking(supabase, body); break;
      case "handle_keyword":     result = await toolHandleKeyword(supabase, body); break;
      case "add_to_waitlist":    result = await toolAddToWaitlist(supabase, body); break;
      case "escalate_to_human":  result = await toolEscalateToHuman(supabase, body); break;
      default:
        result = { error: `unknown_tool: ${tool}` };
        httpStatus = 400;
    }
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    result = { error: errMsg };
    httpStatus = 500;
    log("tool error", { tool, error: errMsg });
  }

  // Log every call for monitoring / debugging
  try {
    await supabase.from("ai_tool_calls").insert({
      tool,
      phone: toE164(body.phone) || null,
      request_payload: body,
      response_payload: result,
      http_status: httpStatus,
      duration_ms: Date.now() - startedAt,
      error: errMsg,
    });
  } catch (_) { /* best effort */ }

  return new Response(JSON.stringify(result), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
