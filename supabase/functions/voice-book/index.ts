// Create a pending visit from a Telnyx booking call.
// The deposit link uses the same ZIP zone as voice-quote.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { calculatePriceCents } from "./pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLACEHOLDER_NAMES = new Set(["there", "unknown", "customer", "lead", "friend", "test", "user", "caller", "guest", "na", "n/a", "none"]);

type ZoneLetter = "A" | "B" | "C";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function realPersonName(value: unknown): boolean {
  const name = String(value || "").trim().toLowerCase();
  return name.length >= 2 && !PLACEHOLDER_NAMES.has(name);
}

function realEmail(value: unknown): boolean {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") && email.includes(".") && !email.startsWith("unknown@") && email !== "unknown";
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const required = [
    "first_name", "last_name", "email", "phone", "address", "city", "state",
    "zip_code", "bedrooms", "bathrooms", "dwelling_type", "home_size_id",
    "service_type", "service_date", "time_slot",
  ];
  for (const key of required) {
    if (!body[key] && body[key] !== 0) return json({ error: `missing_field: ${key}` });
  }
  if (!realPersonName(body.first_name) || !realPersonName(body.last_name) || !realEmail(body.email)) {
    return json({ error: "real_contact_required", say: "Ask for their real first name, last name, and email before creating the booking." });
  }
  const zip = String(body.zip_code || "").replace(/\D/g, "").slice(0, 5);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: coverage, error: coverageError } = await supabase
    .from("service_coverage_zones")
    .select("city, is_active")
    .eq("zip_code", zip)
    .maybeSingle();
  if (coverageError) return json({ error: "coverage_lookup_failed", say: "The coverage lookup failed. Do not create the booking and do not say the ZIP is outside the area." });
  let closed = false;
  let zone: ZoneLetter = "B";
  const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
  if (zoneZip?.zone_id) {
    const { data: zoneRow } = await supabase.from("pricing_zones").select("code, name, multiplier, status").eq("id", zoneZip.zone_id).maybeSingle();
    closed = zoneRow?.status === "not_served";
    zone = zoneLetterFrom(zoneRow);
  }
  if (!(coverage?.is_active === true && !closed)) {
    return json({ error: "zip_not_served", say: "That ZIP is not served. Offer the waitlist instead of a booking." });
  }
  const raw = calculatePriceCents(String(body.home_size_id), String(body.service_type), Array.isArray(body.add_ons) ? body.add_ons : [], String(body.membership_plan || "none"), false, zone);
  const occupancy = String(body.occupancy || "");
  const moveOut = String(body.service_type) === "moveInOut";
  const empty = /empty|vacant|unoccupied|unfurnished/i.test(occupancy);
  const totalCents = moveOut && empty ? Math.round(raw.totalCents * 0.85) : raw.totalCents;
  const depositCents = Math.round(totalCents / 2);
  const priced = { totalCents, depositCents, subtotalCents: raw.subtotalCents, emptyDiscount: moveOut && empty };
  if (!priced.totalCents) return json({ error: "could_not_price", say: "The price did not calculate. Do not invent one." });

  const phone = toE164(body.phone);
  const ten = phone.replace(/\D/g, "").slice(-10);
  const { data: sameDay } = await supabase
    .from("bookings")
    .select("id, booking_number, phone")
    .eq("service_date", body.service_date)
    .in("status", ["pending_payment", "confirmed", "assigned"])
    .ilike("phone", `%${ten}%`);
  const duplicate = (sameDay || []).find((row: { phone?: string }) => String(row.phone || "").replace(/\D/g, "").slice(-10) === ten);
  if (duplicate) {
    return json({ error: "already_booked_that_day", booking_id: duplicate.id, say: "They already have a visit that day. Do not create another one." });
  }

  const { count } = await supabase.from("bookings").select("id", { count: "exact", head: true });
  const bookingNumber = (count || 0) + 1;
  const { data: booking, error: insErr } = await supabase.from("bookings").insert({
    email: body.email,
    first_name: body.first_name,
    last_name: body.last_name,
    phone,
    address: body.address,
    city: body.city,
    state: body.state,
    zip_code: zip,
    bedrooms: Number(body.bedrooms),
    bathrooms: Number(body.bathrooms),
    dwelling_type: body.dwelling_type,
    home_size_id: body.home_size_id,
    service_type: body.service_type,
    offer_type: body.service_type,
    add_ons: Array.isArray(body.add_ons) ? body.add_ons : [],
    service_date: body.service_date,
    time_slot: body.time_slot,
    membership_plan: body.membership_plan || "none",
    base_price_cents: priced.subtotalCents,
    total_estimate_cents: priced.totalCents,
    deposit_cents: priced.depositCents,
    payment_option: "deposit",
    status: "pending_payment",
    booking_number: bookingNumber,
    booking_channel: "SMS Assistant",
    booker_source: "Glow AI Assistant",
    access_notes: body.access_notes || null,
  }).select("id").single();
  if (insErr || !booking) return json({ error: `booking_insert_failed: ${insErr?.message || "unknown"}` });

  let paymentLinkUrl = "";
  try {
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" as any });
    const price: any = await stripe.prices.create({
      currency: "usd",
      unit_amount: priced.depositCents,
      product_data: { name: `NVC-${String(bookingNumber).padStart(4, "0")} deposit` },
    });
    const link: any = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { booking_id: booking.id, kind: "deposit", source: "ai_assistant" },
      after_completion: { type: "redirect", redirect: { url: "https://app.novaracleaning.com/account?payment=success" } },
    });
    paymentLinkUrl = link.url;
  } catch (e) {
    return json({ error: `payment_link_failed: ${e instanceof Error ? e.message : String(e)}` });
  }
  await supabase.from("bookings").update({ hosted_invoice_url: paymentLinkUrl }).eq("id", booking.id);
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const emptyNote = priced.emptyDiscount ? " Empty move-out is 15 percent under a furnished move-out." : "";
  let smsSent = false;
  try {
    const sms = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        type: "confirmation",
        message: `Novara Cleaning: your clean on ${body.service_date} at ${body.time_slot} is saved. Total ${fmt(priced.totalCents)}. Deposit ${fmt(priced.depositCents)} confirms it: ${paymentLinkUrl} This price holds 48 hours.${emptyNote}`,
      },
    });
    smsSent = !sms.error && (sms.data as { success?: boolean } | null)?.success !== false;
  } catch { /* the booking still exists */ }
  return json({
    booking_id: booking.id,
    booking_number: bookingNumber,
    payment_link: paymentLinkUrl,
    deposit_cents: priced.depositCents,
    total_cents: priced.totalCents,
    zone,
    sms_sent: smsSent,
    say: smsSent
      ? `I texted the deposit link for ${fmt(priced.depositCents)}. The visit is confirmed once that deposit is paid. The total is ${fmt(priced.totalCents)}, and this price holds for 48 hours.${emptyNote}`
      : `The visit is saved and the deposit is ${fmt(priced.depositCents)}. The text did not go through. Tell them the office will text the payment link. Do not read a URL aloud.${emptyNote}`,
  });
});
