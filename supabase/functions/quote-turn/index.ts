// One quote for the call. Nova reports each new fact. This session
// updates the record, runs the check, and returns the single next move.
// The price stays hidden until the street is in. Then the quote email
// and checklist go out. A chosen day sends the deposit text.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Row = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function digits(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "");
}

function phoneKey(raw: unknown): string {
  const d = digits(raw);
  if (d.length >= 10) return d.slice(-10);
  return "";
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function money(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function serviceId(raw: unknown): string {
  const s = text(raw).toLowerCase();
  if (!s) return "";
  if (s.includes("move")) return "moveInOut";
  if (s.includes("combo")) return "combo";
  if (s.includes("deep")) return "deep";
  if (s.includes("standard") || s.includes("regular") || s.includes("basic") || s.includes("maintenance")) return "standard";
  return "";
}

function dwellingId(raw: unknown): string {
  const s = text(raw).toLowerCase();
  if (!s) return "";
  if (s.includes("town")) return "townhouse";
  if (s.includes("apt") || s.includes("apartment")) return "apartment";
  if (s.includes("condo")) return "condo";
  if (s.includes("house") || s.includes("home")) return "house";
  return text(raw);
}

function flag(value: unknown): boolean {
  const s = text(value).toLowerCase();
  return value === true || s === "true" || s === "yes" || s === "heavy";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: Row = {};
  try { body = await req.json(); } catch { body = {}; }
  const key = phoneKey(body.phone || body.caller_phone || body.text_phone);
  if (!key) return json({ say: "Pass the caller phone on every quote_turn.", price_ready: false }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: existing } = await supabase.from("quote_sessions").select("*").eq("phone", key).maybeSingle();
  const row: Row = { ...(existing || { phone: key }) };

  const set = (column: string, value: unknown) => {
    const next = text(value);
    if (next) row[column] = next;
  };
  set("first_name", body.first_name);
  set("email", body.email);
  set("dwelling_type", dwellingId(body.dwelling_type));
  set("pets", body.pets);
  set("home_condition", body.home_condition || body.condition);
  set("occupancy", body.occupancy);
  set("service_date", body.service_date);
  set("time_slot", body.time_slot);
  const service = serviceId(body.service_type);
  if (service) row.service_type = service;
  if (body.bedrooms != null && text(body.bedrooms)) row.bedrooms = Number(body.bedrooms);
  if (body.bathrooms != null && text(body.bathrooms)) row.bathrooms = Number(body.bathrooms);
  const sqft = Number(String(body.sqft || body.square_feet || "").replace(/[^\d.]/g, ""));
  if (sqft > 0) {
    row.sqft = sqft;
    row.sqft_unknown = false;
  }
  if (flag(body.sqft_unknown)) row.sqft_unknown = true;
  if (flag(body.pet_hair) || /heavy|shed|hair|everywhere|a lot|lots/.test(text(body.pets).toLowerCase())) {
    row.pet_hair = true;
  }
  if (flag(body.phone_confirmed)) row.phone_confirmed = true;
  const textPhone = phoneKey(body.text_phone);
  if (textPhone) row.text_phone = textPhone.length === 10 ? `+1${textPhone}` : text(body.text_phone);

  const incomingZip = digits(body.zip_code || body.zip).slice(0, 5);
  if (incomingZip.length === 5 && incomingZip !== row.zip_code) {
    row.zip_code = incomingZip;
    row.zip_serviced = null;
    row.coverage_city = null;
    row.coverage_state = null;
  }

  if (row.zip_code && row.zip_serviced == null) {
    const zip = String(row.zip_code);
    const { data: coverage, error } = await supabase
      .from("service_coverage_zones")
      .select("city, state, is_active")
      .eq("zip_code", zip)
      .maybeSingle();
    if (error) {
      row.zip_serviced = "unknown";
    } else {
      let closed = false;
      const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
      if (zoneZip?.zone_id) {
        const { data: zone } = await supabase.from("pricing_zones").select("status").eq("id", zoneZip.zone_id).maybeSingle();
        closed = zone?.status === "not_served";
      }
      row.zip_serviced = coverage?.is_active === true && !closed ? "yes" : coverage ? "no" : "unknown";
      row.coverage_city = coverage?.city || null;
      row.coverage_state = coverage?.state || null;
    }
  }

  const incomingStreet = text(body.address || body.street);
  if (incomingStreet && incomingStreet !== row.address) {
    row.address = incomingStreet;
    row.city = null;
    row.state = null;
  }
  if (row.address && row.zip_code && !row.city) {
    const looked = await lookupStreet(String(row.address), String(row.zip_code));
    if (looked.ok && looked.city && looked.state) {
      row.address = looked.street || row.address;
      row.city = looked.city;
      row.state = looked.state;
    } else {
      row.city = text(row.coverage_city) || "Unknown";
      row.state = text(row.coverage_state) || "MD";
    }
  }

  const gap = nextGap(row);
  if (gap === "waitlist") {
    await save(supabase, key, row);
    return json({
      price_ready: false,
      missing: "waitlist",
      zip_serviced: "no",
      say: `ZIP ${row.zip_code} is not served. Offer the waitlist. Do not give a price.`,
      known: known(row),
    });
  }
  if (gap) {
    await save(supabase, key, row);
    return json({
      price_ready: false,
      missing: gap,
      zip_serviced: row.zip_serviced || "",
      coverage_city: row.coverage_city || "",
      say: gapSay(gap, row),
      known: known(row),
    });
  }

  const inputs = [
    row.service_type, row.sqft || "", row.bedrooms || "", row.pet_hair ? "pet" : "",
    row.home_condition || "", row.occupancy || "", row.zip_code, row.address, row.dwelling_type || "",
  ].join("|");
  const pricedAlready = row.price_inputs === inputs && Number(row.total_cents) > 0;
  if (!pricedAlready) {
    const quote = await supabase.functions.invoke("voice-quote", {
      body: {
        first_name: row.first_name,
        email: row.email,
        phone: row.text_phone || `+1${key}`,
        address: row.address,
        zip_code: row.zip_code,
        sqft: row.sqft || "",
        bedrooms: row.bedrooms || "",
        bathrooms: row.bathrooms || "",
        dwelling_type: row.dwelling_type,
        service_type: row.service_type,
        home_condition: row.home_condition || "",
        occupancy: row.occupancy || "",
        pet_hair: row.pet_hair ? "true" : "",
        pets: row.pets || "",
      },
    });
    const data = quote.data as Row | null;
    if (quote.error || !data || !data.price_ready) {
      await save(supabase, key, row);
      return json({
        price_ready: false,
        say: text(data?.say) || "The price did not calculate. Do not invent a number.",
        known: known(row),
      });
    }
    row.total_cents = data.total_cents;
    row.deposit_cents = data.deposit_cents;
    row.other_total_cents = data.other_total_cents || null;
    row.other_deposit_cents = data.other_deposit_cents || null;
    row.recommended_service = data.recommended_service || row.service_type;
    row.quoted_service = data.quoted_service || row.service_type;
    row.home_size_id = data.resolved_home_size_id || null;
    row.quote_email_sent = Boolean(data.quote_email_sent);
    row.checklist_sent = Boolean(data.checklist_sent);
    row.price_inputs = inputs;
  }

  const requestedDate = text(body.service_date);
  const requestedSlot = text(body.time_slot);
  if (!requestedDate || !requestedSlot) {
    const openings = await liveOpenings(supabase, requestedDate);
    await save(supabase, key, row);
    return json({
      price_ready: true,
      missing: "day",
      total_cents: Number(row.total_cents || 0),
      deposit_cents: Number(row.deposit_cents || 0),
      openings,
      say: openings.length
        ? `Say the total ${money(Number(row.total_cents || 0))} and the deposit ${money(Number(row.deposit_cents || 0))} now. Then offer only these live openings: ${openings.map((item) => `${item.when} at ${item.times.join(", ")}`).join(". ")}. When they pick one, call quote_turn with that service_date and the matching time_slot. That sends the quote text and the quote email.`
        : "No opening in the next two weeks. Say the price, then say there is no opening and offer a person. Do not invent a time.",
      known: known(row),
    });
  }

  const dayOpen = await liveOpenings(supabase, requestedDate);
  const match = dayOpen[0]?.slots.find((slot) => slotMatches(slot, requestedSlot));
  if (!match) {
    await save(supabase, key, row);
    return json({
      price_ready: true,
      missing: "day",
      openings: dayOpen,
      say: dayOpen.length
        ? `That time is not open. Offer only these live openings: ${dayOpen.map((item) => `${item.when} at ${item.times.join(", ")}`).join(". ")}.`
        : "That day is not open. Ask for another day at least 3 days out, never Sunday.",
      known: known(row),
    });
  }

  if (!row.deposit_sms_sent) {
    const booked = await supabase.functions.invoke("voice-book", {
      body: {
        first_name: row.first_name,
        email: row.email,
        phone: row.text_phone || `+1${key}`,
        address: row.address,
        city: row.city,
        state: row.state,
        zip_code: row.zip_code,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        dwelling_type: row.dwelling_type,
        home_size_id: row.home_size_id,
        service_type: row.quoted_service || row.service_type,
        service_date: requestedDate,
        time_slot: match,
        occupancy: row.occupancy || "",
        pets: row.pets || "",
        pet_hair: row.pet_hair ? "true" : "",
      },
    });
    const data = booked.data as Row | null;
    if (!booked.error && data?.booking_id) {
      row.booking_id = data.booking_id;
      row.deposit_sms_sent = Boolean(data.sms_sent);
      row.service_date = requestedDate;
      row.time_slot = match;
      if (data.quote_email_sent) row.quote_email_sent = true;
      if (data.checklist_sent) row.checklist_sent = true;
      await save(supabase, key, row);
      return json({
        price_ready: true,
        booked: true,
        total_cents: row.total_cents,
        deposit_cents: row.deposit_cents,
        sms_sent: data.sms_sent,
        quote_email_sent: data.quote_email_sent,
        checklist_sent: data.checklist_sent,
        say: text(data.say),
        known: known(row),
      });
    }
    await save(supabase, key, row);
    return json({
      price_ready: true,
      booked: false,
      say: text(data?.say) || "The day did not book. Tell them and try another day. Do not invent a link.",
      known: known(row),
    });
  }

  await save(supabase, key, row);
  const total = Number(row.total_cents || 0);
  const deposit = Number(row.deposit_cents || 0);
  const other = Number(row.other_total_cents || 0);
  const otherBit = other > 0 && row.recommended_service !== row.service_type
    ? ` Recommend ${row.recommended_service} at ${money(other)}. If they insist on ${row.service_type}, the total is ${money(total)}.`
    : "";
  return json({
    price_ready: true,
    missing: row.deposit_sms_sent ? "none" : "day",
    total_cents: total,
    deposit_cents: deposit,
    other_total_cents: other || null,
    recommended_service: row.recommended_service,
    quote_email_sent: row.quote_email_sent,
    checklist_sent: row.checklist_sent,
    say: `Say the total ${money(total)} and the deposit ${money(deposit)} now.${otherBit}`,
    known: known(row),
  });
});

const WINDOWS = [
  "9:00 AM - 10:00 AM",
  "10:00 AM - 11:00 AM",
  "11:00 AM - 12:00 PM",
  "12:00 PM - 1:00 PM",
  "1:00 PM - 2:00 PM",
  "2:00 PM - 3:00 PM",
  "3:00 PM - 4:00 PM",
  "4:00 PM - 5:00 PM",
  "5:00 PM - 6:00 PM",
];

function describeDay(iso: string): { iso: string; weekday: string; label: string } {
  const atNoon = new Date(`${iso}T16:00:00Z`);
  return {
    iso,
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(atNoon),
    label: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" }).format(atNoon),
  };
}

function dayInfo(offset: number): { iso: string; weekday: string; label: string } {
  const stamp = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(stamp);
  return describeDay(iso);
}

async function liveOpenings(supabase: ReturnType<typeof createClient>, onlyDate: string): Promise<Array<{ date: string; when: string; times: string[]; slots: string[] }>> {
  const earliest = dayInfo(3).iso;
  const days = onlyDate && /^\d{4}-\d{2}-\d{2}$/.test(onlyDate)
    ? [describeDay(onlyDate)].filter((day) => day.weekday !== "Sun" && day.iso >= earliest)
    : Array.from({ length: 16 }, (_, index) => dayInfo(index + 3)).filter((day) => day.weekday !== "Sun").slice(0, 8);
  const dates = days.map((day) => day.iso);
  const { data: booked } = await supabase
    .from("bookings")
    .select("service_date, time_slot")
    .in("service_date", dates)
    .in("status", ["pending_payment", "confirmed", "assigned"]);
  const taken = new Set((booked || []).map((item: { service_date: string; time_slot: string }) => `${item.service_date}|${item.time_slot}`));
  const openings = [];
  for (const day of days) {
    if (day.weekday === "Sun") continue;
    const slots = WINDOWS.filter((window) => !taken.has(`${day.iso}|${window}`)).slice(0, 3);
    if (!slots.length) continue;
    openings.push({ date: day.iso, when: day.label, times: slots.map((slot) => slot.split(" - ")[0]), slots });
    if (!onlyDate && openings.length >= 2) break;
  }
  return openings;
}

function slotMatches(slot: string, requested: string): boolean {
  const clean = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  const full = clean(slot);
  const ask = clean(requested);
  const start = clean(slot.split(" - ")[0]);
  return full === ask || start === ask || full.startsWith(ask);
}

function readyToPrice(row: Row): boolean {
  const sized = Boolean(row.sqft) || Boolean(row.sqft_unknown && row.bedrooms) || Boolean(row.bedrooms);
  return Boolean(text(row.service_type) && text(row.zip_code) && row.zip_serviced === "yes" && sized && text(row.address));
}

function nextGap(row: Row): string | null {
  if (readyToPrice(row)) return null;
  if (!text(row.first_name)) return "name";
  if (!text(row.service_type)) return "service";
  if (!text(row.zip_code)) return "zip";
  if (row.zip_serviced === "unknown") return "zip_check";
  if (row.zip_serviced === "no") return "waitlist";
  if (!row.sqft && !row.bedrooms && !row.sqft_unknown) return "sqft";
  if (!text(row.address)) return "street";
  if (!text(row.dwelling_type)) return "dwelling";
  if (!row.bedrooms || !row.bathrooms) return "rooms";
  if (!text(row.pets)) return "pets";
  if (!text(row.email).includes("@")) return "email";
  if (!row.phone_confirmed) return "phone";
  return null;
}

async function lookupStreet(street: string, zip: string): Promise<{ ok: boolean; street?: string; city?: string; state?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch("https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/voice-address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ street, zip_code: zip }),
      signal: controller.signal,
    });
    const found = await response.json();
    if (found?.ok && found.city && found.state) return found;
    return { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function gapSay(gap: string, row: Row): string {
  const city = text(row.coverage_city);
  switch (gap) {
    case "name":
      return "Next is their name. One short reason, under seven words. The kind of clean comes right after the name.";
    case "service":
      return "Ask the kind of clean now, before the ZIP and long before the street: standard, deep, or move-in/out. If they describe a kept-up home and ask for deep, a standard clean may fit.";
    case "zip":
      return "Next is the ZIP. One short reason, under seven words.";
    case "zip_check":
      return "The ZIP check failed. Say you are still checking. Do not say it is outside the area.";
    case "dwelling":
      return city
        ? `ZIP ${row.zip_code} is served in ${city}. Say that, then ask house, apartment, townhouse, or condo.`
        : "Next is house, apartment, townhouse, or condo. One short reason.";
    case "rooms":
      return "Next is bedrooms and bathrooms. One short reason.";
    case "sqft":
      return "Next is square footage. If they do not know, call quote_turn with sqft_unknown true. One short reason.";
    case "pets":
      return "Next is pets. If the hair is heavy, pass pet_hair true on the next call. Otherwise pass pets as none or what they said.";
    case "email":
      return "Next is email, so the quote can be sent. One short reason.";
    case "phone":
      return "Next confirm this phone can take a text. If they say yes, call quote_turn with phone_confirmed true. If they give another number, pass it as text_phone.";
    case "street":
      return "Every other detail is in. Ask for the street now. Do not say a price yet. Do not ask for the city.";
    default:
      return "Ask for the one missing detail. Do not say a price yet.";
  }
}

function known(row: Row) {
  return {
    first_name: text(row.first_name),
    zip_code: text(row.zip_code),
    zip_serviced: text(row.zip_serviced),
    city: text(row.coverage_city || row.city),
    service_type: text(row.service_type),
    dwelling_type: text(row.dwelling_type),
    bedrooms: row.bedrooms || "",
    bathrooms: row.bathrooms || "",
    sqft: row.sqft || "",
    pets: text(row.pets),
    email: text(row.email),
    phone_confirmed: Boolean(row.phone_confirmed),
    address: text(row.address),
  };
}

async function save(supabase: ReturnType<typeof createClient>, phone: string, row: Row) {
  row.phone_confirmed = Boolean(row.phone_confirmed);
  row.sqft_unknown = Boolean(row.sqft_unknown);
  row.pet_hair = Boolean(row.pet_hair);
  row.quote_email_sent = Boolean(row.quote_email_sent);
  row.checklist_sent = Boolean(row.checklist_sent);
  row.deposit_sms_sent = Boolean(row.deposit_sms_sent);
  const payload: Row = { phone, updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(row)) {
    if (key === "id" || key === "created_at" || value == null || value === "") continue;
    payload[key] = value;
  }
  if (row.id) {
    await supabase.from("quote_sessions").update(payload).eq("id", row.id);
  } else {
    const { data } = await supabase.from("quote_sessions").insert(payload).select("id").single();
    if (data?.id) row.id = data.id;
  }
}
