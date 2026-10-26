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

// ─── Pricing (delegates to _shared/pricing.ts — v4 single SOT) ────────────
import { calculatePriceCents } from "../_shared/pricing.ts";

const ACCOUNT_PORTAL_URL = "https://app.novaracleaning.com/account";

type ZoneLetter = "A" | "B" | "C";

function calcPrice(args: {
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
  membershipPlan: string;
  isNewCustomer: boolean;
  zone?: ZoneLetter;
}): { subtotalCents: number; promoCents: number; totalCents: number; depositCents: number } {
  // isNewCustomer is intentionally ignored — v4 discounts depend on
  // service tier only (15% std, 25% deep, 50% off std portion of combo).
  void args.isNewCustomer;
  const c = calculatePriceCents(
    args.homeSizeId,
    args.serviceType,
    args.addOns || [],
    args.membershipPlan || "none",
    false,
    args.zone || "B",
  );
  return {
    subtotalCents: c.subtotalCents,
    promoCents: c.discountCents,
    totalCents: c.totalCents,
    depositCents: c.depositCents,
  };
}

function priceSummary(totalCents: number, depositCents: number): string {
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const balance = Math.max(0, totalCents - depositCents);
  return `Total ${fmt(totalCents)}. Deposit today ${fmt(depositCents)}. Balance ${fmt(balance)} after the clean. This price holds for 48 hours. Say these amounts only. Do not add a discount, a courtesy, or a 50 percent new-customer promo.`;
}

function zoneLetterFrom(zone: { code?: string; name?: string; multiplier?: number | string } | null): ZoneLetter {
  const code = String(zone?.code || "").trim().toUpperCase();
  if (code === "A" || code === "B" || code === "C") return code;
  const name = String(zone?.name || "").toUpperCase();
  if (name.includes("ZONE A")) return "A";
  if (name.includes("ZONE C")) return "C";
  const multiplier = Number(zone?.multiplier);
  if (multiplier >= 1.1) return "A";
  if (multiplier > 0 && multiplier < 1) return "C";
  return "B";
}

async function pricingZoneForZip(supabase: any, zip: string): Promise<ZoneLetter> {
  if (!/^\d{5}$/.test(zip)) return "B";
  const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
  if (!zoneZip?.zone_id) return "B";
  const { data: zone } = await supabase.from("pricing_zones").select("code, name, multiplier").eq("id", zoneZip.zone_id).maybeSingle();
  return zoneLetterFrom(zone);
}

const PLACEHOLDER_NAMES = new Set(["there", "unknown", "customer", "lead", "friend", "test", "user", "caller", "guest", "na", "n/a", "none"]);

function realPersonName(value: unknown): boolean {
  const name = String(value || "").trim().toLowerCase();
  return name.length >= 2 && !PLACEHOLDER_NAMES.has(name);
}

function realEmail(value: unknown): boolean {
  const email = String(value || "").trim().toLowerCase();
  if (!email.includes("@") || !email.includes(".")) return false;
  if (email.startsWith("unknown@") || email.endsWith("@unknown.com") || email === "unknown") return false;
  return true;
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
    .select("id, status, first_name, last_name, email, phone, address, city, state, zip_code, service_date, time_slot, service_type, total_estimate_cents, final_charge_cents, deposit_cents, cancel_fee_cents, reschedule_fee_cents, membership_plan, ghl_synced_at, booking_number, hosted_invoice_url")
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

  // Use the link already stored on the booking. Lookup must not mint a
  // new Stripe payment link on every call.
  const paymentLinkForBalance: string | null = newest.hosted_invoice_url || null;

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
    account_url: ACCOUNT_PORTAL_URL,
    say: outstandingCents > 0
      ? "Money is still due on this account. Point them to the account page. Do not read a payment link aloud, and do not create another booking from this lookup."
      : "No balance is due right now.",
  };
}

async function toolCheckServiceArea(supabase: any, body: any): Promise<unknown> {
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  if (!zip) return { serviced: false, zip_code: "", lookup_failed: false, say: "Ask for a 5-digit ZIP before deciding coverage." };
  const { data: coverage, error } = await supabase
    .from("service_coverage_zones")
    .select("city, state, county, tier, tier_label, is_active, pricing_multiplier")
    .eq("zip_code", zip)
    .maybeSingle();
  if (error) {
    return {
      serviced: false,
      lookup_failed: true,
      zip_code: zip,
      say: "The coverage lookup failed. Do not tell the caller this ZIP is outside the service area.",
    };
  }
  const { data: zoneZip } = await supabase
    .from("pricing_zone_zips")
    .select("zone_id")
    .eq("zip", zip)
    .maybeSingle();
  let zone: { name?: string; code?: string; status?: string; multiplier?: number } | null = null;
  if (zoneZip?.zone_id) {
    const { data: zoneRow } = await supabase
      .from("pricing_zones")
      .select("name, code, status, multiplier")
      .eq("id", zoneZip.zone_id)
      .maybeSingle();
    zone = zoneRow;
  }
  const explicitlyClosed = zone?.status === "not_served";
  const serviced = coverage?.is_active === true && !explicitlyClosed;
  return {
    serviced,
    lookup_failed: false,
    zip_code: zip,
    city: coverage?.city || null,
    state: coverage?.state || null,
    county: coverage?.county || null,
    tier: coverage?.tier || null,
    tier_label: coverage?.tier_label || null,
    zone: zone?.name || zone?.code || null,
    say: serviced
      ? `Yes, we clean in ${coverage?.city || "that ZIP"}, ${coverage?.state || ""}. Continue the booking. Do not add a waitlist.`
      : "That ZIP is not in the active service area. Offer the waitlist and do not quote a price.",
  };
}

async function toolGetPriceEstimate(supabase: any, body: any): Promise<unknown> {
  const homeSizeId = String(body.home_size_id || "");
  const serviceType = String(body.service_type || "standard");
  const addOns = Array.isArray(body.add_ons) ? body.add_ons.map(String) : [];
  const membershipPlan = String(body.membership_plan || "none");
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  if (homeSizeId === "5000_plus") {
    return {
      subtotal_cents: 0,
      promo_discount_cents: 0,
      total_cents: 0,
      deposit_cents: 0,
      remaining_cents: 0,
      human_summary: "Homes over 5,000 square feet need a person to quote. Call escalate_to_human with reason custom_quote.",
      requires_custom_quote: true,
    };
  }
  const zone = await pricingZoneForZip(supabase, zip);
  const p = calcPrice({ homeSizeId, serviceType, addOns, membershipPlan, isNewCustomer: false, zone });
  if (!p.totalCents) {
    return {
      error: "could_not_price",
      human_summary: "I could not price that home from the size given. Ask for the square footage again.",
    };
  }
  return {
    subtotal_cents: p.subtotalCents,
    promo_discount_cents: p.promoCents,
    total_cents: p.totalCents,
    deposit_cents: p.depositCents,
    remaining_cents: p.totalCents - p.depositCents,
    zone,
    zip_code: zip || null,
    human_summary: priceSummary(p.totalCents, p.depositCents),
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
  if (!realPersonName(body.first_name) || !realPersonName(body.last_name) || !realEmail(body.email)) {
    return {
      error: "real_contact_required",
      say: "Ask for their real first name, last name, and email before creating the booking.",
    };
  }
  const coverage = await toolCheckServiceArea(supabase, body) as { serviced?: boolean; lookup_failed?: boolean; say?: string };
  if (coverage.lookup_failed) {
    return { error: "coverage_lookup_failed", say: "The coverage lookup failed. Do not create the booking and do not say the ZIP is outside the area." };
  }
  if (!coverage.serviced) {
    return { error: "zip_not_served", say: coverage.say || "That ZIP is not served. Offer the waitlist instead of a booking." };
  }
  const homeSizeId = String(body.home_size_id);
  const serviceType = String(body.service_type);
  const addOns: string[] = Array.isArray(body.add_ons) ? body.add_ons : [];
  const membershipPlan = String(body.membership_plan || "none");
  const zip = String(body.zip_code || "").replace(/\D/g, "").slice(0, 5);
  const zone = await pricingZoneForZip(supabase, zip);
  const p = calcPrice({ homeSizeId, serviceType, addOns, membershipPlan, isNewCustomer: false, zone });
  if (!p.totalCents) return { error: "could_not_price", say: "The price did not calculate. Do not invent one." };

  const phone = toE164(body.phone);
  const ten = phone.replace(/\D/g, "").slice(-10);
  const { data: sameDay } = await supabase
    .from("bookings")
    .select("id, booking_number, status, phone")
    .eq("service_date", body.service_date)
    .in("status", ["pending_payment", "confirmed", "assigned"])
    .ilike("phone", `%${ten}%`);
  const duplicate = (sameDay || []).find((row: any) => String(row.phone || "").replace(/\D/g, "").slice(-10) === ten);
  if (duplicate) {
    return {
      error: "already_booked_that_day",
      booking_id: duplicate.id,
      booking_number: duplicate.booking_number,
      say: "They already have a visit that day. Do not create another one. Help with the existing visit.",
    };
  }

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
      base_price_cents: p.subtotalCents,
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
      product_data: { name: `NVC-${String(bookingNumber).padStart(4, "0")} — 50% deposit` },
    });
    const link: any = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: booking.id, kind: "deposit", source: "ai_assistant" },
      after_completion: { type: "redirect", redirect: { url: `https://app.novaracleaning.com/account?payment=success` } },
    });
    paymentLinkUrl = link.url;
  } catch (e) {
    log("payment link create failed", e);
    return { error: `payment_link_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  await supabase.from("bookings").update({ hosted_invoice_url: paymentLinkUrl }).eq("id", booking.id);

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  let smsSent = false;
  try {
    const sms = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        type: "confirmation",
        message: `Novara Cleaning: your clean on ${body.service_date} at ${body.time_slot} is saved. Total ${fmt(p.totalCents)}. Deposit ${fmt(p.depositCents)} confirms it: ${paymentLinkUrl} This price holds 48 hours.`,
      },
    });
    smsSent = !sms.error && (sms.data as { success?: boolean } | null)?.success !== false;
  } catch (e) {
    log("deposit sms failed", e);
  }

  return {
    booking_id: booking.id,
    booking_number: bookingNumber,
    payment_link: paymentLinkUrl,
    deposit_cents: p.depositCents,
    total_cents: p.totalCents,
    zone,
    service_date: body.service_date,
    time_slot: body.time_slot,
    sms_sent: smsSent,
    say: smsSent
      ? `I texted the deposit link for ${fmt(p.depositCents)}. The visit is confirmed once that deposit is paid. The total is ${fmt(p.totalCents)}, and this price holds for 48 hours.`
      : `The visit is saved and the deposit is ${fmt(p.depositCents)}. The text did not go through. Tell them the office will text the payment link. Do not read a URL aloud.`,
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
  const coverage = await toolCheckServiceArea(supabase, body) as {
    serviced?: boolean;
    lookup_failed?: boolean;
    city?: string | null;
    say?: string;
  };
  if (coverage.lookup_failed) {
    return { ok: false, reason: "coverage_lookup_failed", say: "Coverage did not load. Do not add a waitlist and do not say the ZIP is outside the area." };
  }
  if (coverage.serviced) {
    const city = coverage.city ? ` in ${coverage.city}` : "";
    return { ok: false, reason: "zip_is_served", say: `This ZIP is served${city}. Continue the booking. Do not add a waitlist.` };
  }
  if (!realPersonName(body.first_name) || !realEmail(body.email) || toE164(body.phone).replace(/\D/g, "").length < 10) {
    return {
      ok: false,
      reason: "real_contact_required",
      say: "Ask for a real first name, a real email, and the mobile they are calling from before adding the waitlist.",
    };
  }
  try {
    const { data, error } = await supabase.functions.invoke("add-to-waitlist", {
      body: {
        email: body.email,
        firstName: body.first_name,
        lastName: body.last_name,
        phone: toE164(body.phone),
        zipCode: body.zip_code,
        source: "AI Assistant",
      },
    });
    if (error) return { ok: false, waitlist_id: null, say: "The waitlist did not save. Offer a person instead of pretending it did." };
    return {
      ok: true,
      waitlist_id: (data as any)?.id || null,
      say: "You're on the waitlist. We'll reach out when we start cleaning that ZIP.",
    };
  } catch (_e) {
    return { ok: false, waitlist_id: null, say: "The waitlist did not save. Offer a person instead of pretending it did." };
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
      case "get_price_estimate": result = await toolGetPriceEstimate(supabase, body); break;
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
