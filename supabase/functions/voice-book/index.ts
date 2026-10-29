// Create a pending visit from a Telnyx booking call.
// The deposit link uses the same ZIP zone as voice-quote.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
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
    "first_name", "email", "phone", "address", "city", "state",
    "zip_code", "bedrooms", "bathrooms", "dwelling_type", "home_size_id",
    "service_type", "service_date", "time_slot",
  ];
  for (const key of required) {
    if (!body[key] && body[key] !== 0) return json({ error: `missing_field: ${key}` });
  }
  if (!realPersonName(body.first_name) || !realEmail(body.email)) {
    return json({ error: "real_contact_required", say: "Ask for their real first name and email before creating the booking." });
  }
  if (!body.last_name) body.last_name = body.first_name;
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
  if (req.headers.get("x-price-preview") === "1") {
    return json({
      preview: true,
      total_cents: priced.totalCents,
      deposit_cents: priced.depositCents,
      zone,
      empty_move_out_discount: priced.emptyDiscount,
      say: "Preview only. No booking was created.",
    });
  }

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

  const { data: latestNumber } = await supabase
    .from("bookings")
    .select("booking_number")
    .order("booking_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  let booking: { id: string } | null = null;
  let insErr: { message?: string } | null = null;
  let bookingNumber = Number(latestNumber?.booking_number || 0) + 1;
  for (let attempt = 0; attempt < 3 && !booking; attempt++) {
    bookingNumber = Number(latestNumber?.booking_number || 0) + 1 + attempt;
    const inserted = await supabase.from("bookings").insert({
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
    booking = inserted.data;
    insErr = inserted.error;
    if (insErr && !/booking_number/i.test(String(insErr.message || ""))) break;
  }
  if (insErr || !booking) return json({ error: `booking_insert_failed: ${insErr?.message || "unknown"}` });

  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const payToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const payUrl = `https://try.novaracleaning.com/pay/${payToken}`;
  await supabase.from("bookings").update({
    pay_page_token: payToken,
    hosted_invoice_url: payUrl,
    pets: body.pets || null,
  }).eq("id", booking.id);
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const remainingCents = priced.totalCents - priced.depositCents;
  const emptyNote = priced.emptyDiscount ? " Empty move-out is 15 percent under a furnished move-out." : "";
  let smsSent = false;
  try {
    const sms = await supabase.functions.invoke("send-sms-notification", {
      body: {
        toPhone: phone,
        type: "confirmation",
        message: `Novara Cleaning: Hi ${body.first_name}! Your ${body.service_type} clean is pending for ${body.service_date} ${body.time_slot} at ${body.address}. Total ${fmt(priced.totalCents)}. Your booking stays pending until your deposit is received. Review and pay your ${fmt(priced.depositCents)} deposit here: ${payUrl} — we won't charge the remaining ${fmt(remainingCents)} until after we complete the clean.`,
      },
    });
    smsSent = !sms.error && (sms.data as { success?: boolean } | null)?.success !== false;
  } catch { /* the booking still exists */ }
  let emailSent = false;
  try {
    const mail = await supabase.functions.invoke("send-sales-quote-email", {
      body: {
        email: body.email,
        firstName: body.first_name,
        serviceName: String(body.service_type),
        homeSizeLabel: String(body.home_size_id),
        frequency: "One-Time",
        bedrooms: Number(body.bedrooms),
        bathrooms: Number(body.bathrooms),
        basePriceCents: priced.totalCents,
        serviceTierCost: 0,
        addOnsCents: 0,
        discountPct: 0,
        discountCents: 0,
        finalPriceCents: priced.totalCents,
        depositCents: priced.depositCents,
        balanceDueCents: remainingCents,
        monthlyTotalCents: priced.totalCents,
        isNewCustomer: false,
        addOns: Array.isArray(body.add_ons) ? body.add_ons : [],
      },
    });
    emailSent = !mail.error;
  } catch { /* booking still exists */ }
  let checklistSent = false;
  try {
    const list = await supabase.functions.invoke("send-cleaning-checklist", {
      body: { bookingId: booking.id, sendEmail: true, sendSms: true, force: true },
    });
    const data = list.data as { smsSent?: boolean; emailed?: boolean } | null;
    checklistSent = !list.error && Boolean(data?.smsSent || data?.emailed);
  } catch { /* booking still exists */ }
  const sent = [
    smsSent ? "the deposit text" : "",
    emailSent ? "the quote email" : "",
    checklistSent ? "the checklist" : "",
  ].filter(Boolean);
  const missed = [
    smsSent ? "" : "the deposit text",
    emailSent ? "" : "the quote email",
    checklistSent ? "" : "the checklist",
  ].filter(Boolean);
  return json({
    booking_id: booking.id,
    booking_number: bookingNumber,
    payment_link: payUrl,
    deposit_cents: priced.depositCents,
    total_cents: priced.totalCents,
    zone,
    sms_sent: smsSent,
    quote_email_sent: emailSent,
    checklist_sent: checklistSent,
    say: `Total ${fmt(priced.totalCents)}. Deposit ${fmt(priced.depositCents)}.${emptyNote} Sent: ${sent.join(", ") || "nothing"}. ${missed.length ? `Did not send: ${missed.join(", ")}. Say that plainly.` : "Tell them those are on the way. Do not read the link aloud."}`,
  });
});
