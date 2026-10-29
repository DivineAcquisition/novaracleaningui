// Live caller context for Telnyx assistants.
//
// Telnyx POSTs assistant.initialization when a call or text starts.
// The response is { dynamic_variables: { string: string } }. Those values
// are already substituted into the assistant prompt, so the first thing
// the agent says can use the real booking, lead, and ZIP on file.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, telnyx-signature-ed25519, telnyx-timestamp",
};

const ASSISTANT_ROLES: Record<string, "booking" | "service" | "outbound"> = {
  "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d": "booking",
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f": "service",
  "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e": "outbound",
};

const SIZE_BANDS: Array<[number, number, string, string]> = [
  [0, 999, "0_999", "under 1,000 square feet"],
  [1000, 1500, "1000_1500", "about 1,000 to 1,500 square feet"],
  [1501, 2000, "1501_2000", "about 1,500 to 2,000 square feet"],
  [2001, 2500, "2001_2500", "about 2,000 to 2,500 square feet"],
  [2501, 3000, "2501_3000", "about 2,500 to 3,000 square feet"],
  [3001, 3500, "3001_3500", "about 3,000 to 3,500 square feet"],
  [3501, 4000, "3501_4000", "about 3,500 to 4,000 square feet"],
  [4001, 4500, "4001_4500", "about 4,000 to 4,500 square feet"],
  [4501, 5000, "4501_5000", "about 4,500 to 5,000 square feet"],
];

const PLACEHOLDER_NAMES = new Set(["there", "unknown", "customer", "lead", "friend", "test", "user", "caller", "guest", "na", "n/a", "none"]);

function toE164(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function last10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function clip(value: string, max = 700): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function money(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function realName(value: string): string {
  const clean = value.trim();
  if (clean.length < 2) return "";
  if (PLACEHOLDER_NAMES.has(clean.toLowerCase())) return "";
  return clean;
}

function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function spokenDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const dt = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dt);
}

function serviceId(raw: string): string {
  const s = raw.toLowerCase();
  if (!s) return "";
  if (s.includes("move")) return "moveInOut";
  if (s.includes("combo") || (s.includes("deep") && s.includes("standard"))) return "combo";
  if (s.includes("deep")) return "deep";
  if (s.includes("standard") || s.includes("regular") || s.includes("basic") || s.includes("maintenance")) return "standard";
  return "";
}

function serviceLabel(raw: string): string {
  const id = serviceId(raw);
  if (id === "moveInOut") return "move-in/out clean";
  if (id === "combo") return "deep and standard combo";
  if (id === "deep") return "deep clean";
  if (id === "standard") return "standard clean";
  return raw.trim();
}

function sizeFromSqft(sqft: number): { id: string; label: string } {
  if (!Number.isFinite(sqft) || sqft <= 0) return { id: "", label: "" };
  if (sqft > 5000) return { id: "5000_plus", label: "over 5,000 square feet" };
  for (const [min, max, id, label] of SIZE_BANDS) {
    if (sqft >= min && sqft <= max) return { id, label };
  }
  return { id: "", label: "" };
}

function roleFor(req: Request, payload: Record<string, unknown>): "booking" | "service" | "outbound" {
  const requested = new URL(req.url).searchParams.get("role") || text(payload.role);
  if (requested === "booking" || requested === "service" || requested === "outbound") return requested;
  const assistantId = text(payload.assistant_id || payload.telnyx_assistant_id);
  return ASSISTANT_ROLES[assistantId] || "booking";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* manual test */ }
  const data = (body.data || {}) as Record<string, unknown>;
  const payload = (data.payload || body.payload || body || {}) as Record<string, unknown>;
  const hinted = {
    ...((payload.dynamic_variables || {}) as Record<string, unknown>),
    ...((payload.ai_assistant_dynamic_variables || {}) as Record<string, unknown>),
  };
  const role = roleFor(req, payload);
  const phone = toE164(text(payload.telnyx_end_user_target || payload.phone || hinted.phone));
  const ten = last10(phone);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let bookings: Record<string, unknown>[] = [];
  let lead: Record<string, unknown> | null = null;
  if (ten.length === 10) {
    const [bookingRes, leadRes] = await Promise.all([
      supabase
        .from("bookings")
        .select("id, booking_number, status, first_name, last_name, email, phone, address, city, state, zip_code, service_date, time_slot, service_type, bedrooms, bathrooms, home_size_id, dwelling_type, total_estimate_cents, final_charge_cents, deposit_cents, payment_received_at, hosted_invoice_url, created_at")
        .ilike("phone", `%${ten}%`)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("leads")
        .select("first_name, last_name, email, phone, source, zip_code, service_type, bedrooms, bathrooms, sqft, preferred_date, do_not_call, created_at")
        .ilike("phone", `%${ten}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    bookings = ((bookingRes.data || []) as Record<string, unknown>[]).filter((row) => last10(String(row.phone || "")) === ten);
    if (leadRes.data && last10(String(leadRes.data.phone || "")) === ten) lead = leadRes.data as Record<string, unknown>;
  }
  let quoteSession: Record<string, unknown> | null = null;
  if (ten.length === 10) {
    const { data: session } = await supabase.from("quote_sessions").select("*").eq("phone", ten).maybeSingle();
    quoteSession = (session || null) as Record<string, unknown> | null;
  }
  const resumeQuote = Boolean(
    quoteSession
    && !quoteSession.booking_id
    && text(quoteSession.address)
    && text(quoteSession.zip_code)
    && text(quoteSession.service_type),
  );

  const newest = bookings[0];
  const addressOnBooking = text(newest?.address);
  // A ZIP on a lead form, or passed in from an old test, is not the home.
  // A quote that already has a street is the home this follow-up continues.
  const zip = (addressOnBooking
    ? text(newest?.zip_code || payload.zip_code || hinted.zip_code || lead?.zip_code)
    : resumeQuote
      ? text(quoteSession?.zip_code)
      : ""
  ).replace(/\D/g, "").slice(0, 5);
  let coverage: Record<string, unknown> | null = null;
  let zoneName = "";
  let lookupFailed = false;
  if (zip) {
    const [coverageRes, zoneZipRes] = await Promise.all([
      supabase.from("service_coverage_zones").select("city, state, county, tier, tier_label, is_active").eq("zip_code", zip).maybeSingle(),
      supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle(),
    ]);
    if (coverageRes.error) lookupFailed = true;
    coverage = (coverageRes.data || null) as Record<string, unknown> | null;
    const zoneId = zoneZipRes.data?.zone_id;
    if (zoneId) {
      const { data: zone } = await supabase.from("pricing_zones").select("name, status").eq("id", zoneId).maybeSingle();
      if (zone?.status === "not_served" && coverage) coverage = { ...coverage, is_active: false };
      zoneName = text(zone?.name);
    }
  }

  const active = bookings.filter((row) => ["pending_payment", "confirmed", "assigned"].includes(String(row.status || "")));
  const today = todayEastern();
  const upcoming = active
    .filter((row) => text(row.service_date) >= today)
    .sort((a, b) => text(a.service_date).localeCompare(text(b.service_date)))[0] || active[0];
  const completedCount = bookings.filter((row) => row.status === "completed").length;
  const firstName = realName(text(newest?.first_name || quoteSession?.first_name || lead?.first_name || hinted.first_name));
  const lastName = realName(text(newest?.last_name || lead?.last_name || hinted.last_name));
  const fullName = `${firstName} ${lastName}`.trim();
  const email = text(newest?.email || quoteSession?.email || lead?.email);
  const address = addressOnBooking || (resumeQuote ? text(quoteSession?.address) : "");
  const city = text(newest?.city || (resumeQuote ? quoteSession?.city || quoteSession?.coverage_city : "") || coverage?.city);
  const state = text(newest?.state || (resumeQuote ? quoteSession?.state || quoteSession?.coverage_state : "") || coverage?.state);
  const serviced = lookupFailed ? "unknown" : coverage ? (coverage.is_active ? "yes" : "no") : (zip ? "no" : "unknown");
  const serviceRaw = text(upcoming?.service_type || (resumeQuote ? quoteSession?.service_type : "") || lead?.service_type || hinted.service_type);
  const knownService = serviceId(serviceRaw);
  const sqft = Number((resumeQuote ? quoteSession?.sqft : 0) || lead?.sqft || 0);
  const sized = sizeFromSqft(sqft);
  const knownSize = text(upcoming?.home_size_id || (resumeQuote ? quoteSession?.home_size_id : "")) || sized.id;
  const sizeLabel = SIZE_BANDS.find((band) => band[2] === knownSize)?.[3] || sized.label;
  const bedrooms = text(upcoming?.bedrooms || (resumeQuote ? quoteSession?.bedrooms : "") || lead?.bedrooms || hinted.bedrooms);
  const bathrooms = text(upcoming?.bathrooms || (resumeQuote ? quoteSession?.bathrooms : "") || lead?.bathrooms);
  const preferredDate = text(lead?.preferred_date || upcoming?.service_date || (resumeQuote ? quoteSession?.service_date : ""));
  const depositCents = Number(upcoming?.deposit_cents || 0);
  const unpaid = Boolean(upcoming && !upcoming.payment_received_at && ["pending_payment", "confirmed", "assigned"].includes(String(upcoming.status || "")));
  const dueNow = unpaid ? (depositCents || Math.round(Number(upcoming?.total_estimate_cents || 0) / 2)) : 0;
  const when = upcoming?.service_date ? spokenDate(text(upcoming.service_date)) : "";
  const slot = text(upcoming?.time_slot || (!upcoming && resumeQuote ? quoteSession?.time_slot : ""));
  const svc = serviceLabel(text(upcoming?.service_type)) || "clean";
  const doNotCall = Boolean(lead?.do_not_call);

  const missing: string[] = [];
  if (!firstName) missing.push("first name");
  if (!lastName) missing.push("last name");
  if (!email.includes("@")) missing.push("email");
  if (!address) missing.push("street address");
  else {
    if (!city) missing.push("city");
    if (!state) missing.push("state");
  }
  if (!zip) missing.push("ZIP code");
  if (!bedrooms) missing.push("bedrooms");
  if (!bathrooms) missing.push("bathrooms");
  if (!text(upcoming?.dwelling_type || (resumeQuote ? quoteSession?.dwelling_type : ""))) missing.push("home type");
  if (!knownSize) missing.push("home size");
  if (!knownService) missing.push("service");
  if (!preferredDate) missing.push("date");
  if (!slot) missing.push("arrival time");

  const brandNew = bookings.length === 0 && !lead && !resumeQuote;
  let sayFirst = "I can get you a price. What ZIP is the home in?";
  let nextStep = brandNew
    ? "They may want a first clean. Answer whatever they already said. When you have a ZIP, call check_service_area. If it is served, say the city and ask for the street. Do not ask for the city."
    : "Answer what they just said. When you have a ZIP, call check_service_area. If it is served, say the city, then learn the home before you price it.";
  let resultTarget = "One visit saved after a spoken read-back and a yes, with the deposit text sent.";

  if (role === "service") {
    resultTarget = brandNew
      ? "A first clean booked on this call, or help with a visit that is under another number."
      : "Finish what they called about on this call, or put a person on it and say that plainly.";
    if (ten.length < 10) {
      sayFirst = "I can book a clean or pull up a visit. What's the mobile number?";
      nextStep = "If they want a new clean, ask for the ZIP next. If they have a visit, call list_customer_bookings with that number.";
    } else if (!upcoming) {
      sayFirst = fullName
        ? `${fullName}, I don't see a visit on this number. Want me to book one, or is it under another phone?`
        : "I don't see a visit on this number. Want me to book one, or is it under another phone?";
      nextStep = "If they want to book, ask for the ZIP and continue one question at a time. If they have another number, call list_customer_bookings with that number.";
    } else if (upcoming.status === "pending_payment" && !upcoming.payment_received_at) {
      sayFirst = `Your ${svc} on ${when} is saved, and it's waiting on the ${money(dueNow)} deposit. Want me to resend that link, or move the day?`;
      nextStep = "If they want to cancel or move it, call preview_change and say the fee before anything is changed.";
    } else {
      sayFirst = `You've got a ${svc} on ${when}${slot ? `, arriving ${slot}` : ""}. What do you need?`;
      nextStep = "For a cancel or a new time, call preview_change first and wait for a yes. For damage, a billing dispute, or a refund that is not a normal cancel, call submit_request and do not promise an amount.";
    }
  } else if (role === "outbound" && doNotCall) {
    sayFirst = "Sorry to catch you. I'll mark this number so we don't call again.";
    nextStep = "Call opt_out_calls with the caller's phone, confirm that, and end the call.";
    resultTarget = "This number is opted out and the call is over.";
  } else if (upcoming && !upcoming.payment_received_at && upcoming.status === "pending_payment") {
    sayFirst = fullName
      ? `${fullName}, your ${svc} on ${when} is saved and waiting on the ${money(dueNow)} deposit. Want me to resend that link, or move the day?`
      : `Your ${svc} on ${when} is saved and waiting on the ${money(dueNow)} deposit. Want me to resend that link, or move the day?`;
    nextStep = "Do not create a second booking. If they want a different day, preview the change or escalate. If they are ready to pay, send them to the account page and the text that already went out.";
    resultTarget = "They pay the existing deposit, or a person handles a change. No second booking.";
  } else if (serviced === "no") {
    sayFirst = `I checked ${zip}. We don't clean there yet. I can put you on the waitlist and reach out when that ZIP opens.`;
    nextStep = "Collect a real first name and a real email, then call add_to_waitlist. Do not quote a price.";
    resultTarget = "A waitlist entry with a real name and email, or a polite end if they decline.";
  } else if (serviced === "unknown" && !zip) {
    const source = text(lead?.source || hinted.lead_source).toLowerCase();
    const fromGoogle = source.includes("google") || source.includes("lsa") || source.includes("local service");
    if (role === "booking") {
      sayFirst = fromGoogle
        ? "I saw you just inquired about a cleaning from Google. Do you recall?"
        : "What's the ZIP for the home?";
      nextStep = fromGoogle
        ? "You already introduced yourself as Malik. If they recall the Google inquiry, ask the ZIP. Call check_service_area before you name a city. If it is served, say we service that area, then ask standard, deep, move-in/out, or something special. If they pick deep, tell them deep is the most detailed clean and is for a home that needs more care. If they keep the home up, a standard clean is usually enough. Offer the checklist so they can see the difference, and let them choose."
        : "You already introduced yourself as Malik. Ask the ZIP, call check_service_area, and only then say the city. Then ask standard, deep, move-in/out, or something special. If they pick deep, explain it is the most detailed clean and let them choose after they see the difference.";
    } else {
      sayFirst = "I can get you a price. What ZIP is the home in?";
      nextStep = brandNew
        ? "Answer what they already said. Call check_service_area before you name a city. If the ZIP is served, say the city and ask for the street."
        : "Answer what they already said. Call check_service_area before you name a city or talk price. After a served ZIP, ask for the street, then beds, baths, and whether they are moving.";
    }
    if (role === "outbound") resultTarget = "A booked visit on this call, a callback with a day and a time, or a clear no.";
  } else if (lookupFailed) {
    sayFirst = "I'm checking that ZIP now. I don't want to guess on coverage.";
    nextStep = "Call check_service_area. If it returns lookup_failed, do not say the ZIP is outside the area. Offer a person via escalate_to_human.";
  } else {
    const place = city ? `We clean in ${city}.` : "That ZIP is in our service area.";
    const who = fullName ? `${fullName}, ` : "";
    if (!address && role !== "service") {
      sayFirst = `${who}${place} What's the street address?`;
      nextStep = "Do not ask for the city. Call lookup_address with the street and this ZIP. Confirm the address it returns. Then ask if they are moving, if the home is empty, and how kept up it is. Text the checklist for the service you recommend before any price.";
    } else if (knownSize && knownService) {
      sayFirst = `${who}${place} I can price the ${serviceLabel(knownService)} for a home that's ${sizeLabel}.`;
      nextStep = `Before any price, call send_checklist with service_type ${knownService} and ask them to glance at the text. Say the brief. Then call get_price_estimate with home_size_id ${knownSize}, service_type ${knownService}, zip_code ${zip}, occupancy, and home_condition. An empty move-out uses occupancy empty. A kept-up home that asked for deep uses home_condition light, and you speak both totals from the tool. Speak only human_summary, then pause.`;
    } else if (knownService && sizeLabel) {
      sayFirst = `${who}${place} You asked about a ${serviceLabel(knownService)}, and the home looks ${sizeLabel}. Is that the size?`;
      nextStep = "If they confirm, call send_checklist for that service and ask them to glance at it. Then call get_price_estimate with that size, service, ZIP, occupancy, and home_condition. Speak only human_summary, then pause.";
    } else if (!knownService) {
      sayFirst = `${who}${place} Are you looking for a standard clean, a deep clean, or a move-in/out?`;
      nextStep = "One answer, then ask the home size if you don't already have it. Listen for an empty home, or a home that is already kept up, before you choose deep over standard. Fridge and oven are included on a move-in/out. Text the checklist and ask them to glance at it before any price.";
    } else {
      sayFirst = `${who}${place} About how big is the home, in square feet or bedrooms?`;
      nextStep = "Map the answer to a home_size_id. Call send_checklist, ask them to glance at it, then call get_price_estimate with the ZIP, occupancy, and home_condition. Speak only human_summary, then pause.";
    }
    if (brandNew) {
      nextStep = `${nextStep} They are new to Novara. Keep going toward a first booking, one question at a time.`;
    }
    if (role === "outbound") {
      resultTarget = "A booked visit on this call, a callback with a day and a time, or a clear no.";
      if (firstName) {
        const leadIn = fullName ? `${fullName}, ` : `${firstName}, `;
        const rest = sayFirst.startsWith(leadIn) ? sayFirst.slice(leadIn.length) : sayFirst;
        sayFirst = `Thanks ${firstName}. ${rest}`;
      }
    }
  }

  if (preferredDate && role !== "service" && serviced === "yes" && knownSize && knownService && !slot) {
    nextStep = `${nextStep} They asked for ${spokenDate(preferredDate)}. After the price, call get_available_slots for that date and offer only those times.`;
  }

  if (role === "booking") {
    const fromGoogle = /google|lsa|local service/.test(text(lead?.source || hinted.lead_source).toLowerCase());
    sayFirst = [
      "Private note. Not a line to speak. You are Nova, the AI assistant.",
      fromGoogle ? "They may have inquired from Google." : "No Google inquiry is on file.",
      firstName ? `Name: ${firstName}.` : "Name not collected yet. Ask for it first.",
      zip ? `ZIP ${zip} is ${serviced}${city ? `, ${city}` : ""}.` : "No ZIP yet.",
      knownService ? `Service mentioned: ${serviceLabel(knownService)}.` : "No service chosen yet.",
      knownSize ? `Size on file: ${sizeLabel || knownSize}.` : "No size yet.",
      address ? `Street already on file: ${address}.` : "Do not ask for the street until name, ZIP, home type, beds, baths, size, pets, email, and phone are done.",
      upcoming ? `A visit is already saved for ${when || "an open date"}.` : "No visit is saved.",
    ].join(" ");
    nextStep = "Call get_price_estimate after every answer before you ask anything else. Right after their name, ask standard, deep, or move-in/out. Do not ask for the street until that tool says the street is next. Say a price only when its say field includes a total.";
  }

  let openingLine = role === "service"
    ? "Hi, this is Novara Cleaning. What's going on with your visit?"
    : role === "outbound"
      ? "Hey, this is Nova, Novara Cleaning's AI assistant. You asked about a clean. Is now an okay time?"
      : "Hey, this is Nova, Novara Cleaning's AI assistant. I can take care of this for you.";

  if (resumeQuote && quoteSession && role !== "service") {
    const who = realName(text(quoteSession.first_name)) || firstName || "there";
    const street = text(quoteSession.address);
    const town = text(quoteSession.city || quoteSession.coverage_city);
    const kind = serviceLabel(text(quoteSession.service_type));
    const total = Number(quoteSession.total_cents || 0);
    const deposit = Number(quoteSession.deposit_cents || 0);
    const priceBit = total > 0
      ? ` The total is ${money(total)} and the deposit is ${money(deposit)}.`
      : " I can give you the price now.";
    const savedDay = text(quoteSession.service_date).slice(0, 10);
    const savedStart = text(quoteSession.time_slot).split(" - ")[0].trim();
    const wanted = savedDay
      ? ` You wanted ${spokenDate(savedDay)}${savedStart ? ` at ${savedStart}` : ""}.`
      : "";
    openingLine = `Hey ${who}, it's Nova calling back. We left off on your ${kind} at ${street}${town ? ` in ${town}` : ""}.${priceBit}${wanted} Is now still okay?`;
    sayFirst = [
      "Private note. This is a follow-up. Do not re-ask anything already known.",
      `Name ${who}. ${kind}. ZIP ${text(quoteSession.zip_code)}.`,
      `${text(quoteSession.dwelling_type)}, ${text(quoteSession.bedrooms)} bedrooms, ${text(quoteSession.bathrooms)} bathrooms, ${text(quoteSession.sqft)} square feet.`,
      `Pets ${text(quoteSession.pets) || "none"}. Email ${text(quoteSession.email)}. This phone can take a text.`,
      `Street ${street}, ${town} ${text(quoteSession.state)}.`,
      total > 0 ? `Price already calculated: total ${money(total)}, deposit ${money(deposit)}. Say those numbers first.` : "Call get_price_estimate immediately and say the total.",
      savedDay ? `They asked for ${spokenDate(savedDay)}${savedStart ? ` at ${savedStart}` : ""}.` : "No day was chosen yet.",
      "The first get_price_estimate call passes only the phone. Do not pass service_date until they agree to a time.",
    ].join(" ");
    nextStep = savedDay
      ? `Call get_price_estimate now with the caller phone and no service_date. Say the total and the deposit out loud. Offer ${spokenDate(savedDay)}${savedStart ? ` at ${savedStart}` : ""} if that opening is in the tool response. Pass service_date and time_slot only after they say yes.`
      : "Call get_price_estimate now with the caller phone and no service_date. Say the total and the deposit out loud. Offer one opening from the tool response. Pass service_date only after they pick a time.";
    resultTarget = savedDay
      ? `They hear the price on this call, then ${spokenDate(savedDay)}${savedStart ? ` at ${savedStart}` : ""} is booked or another open time is chosen.`
      : "They hear the price on this call, then a day from the live openings is booked or a callback is set.";
  }

  const nextBooking = upcoming
    ? `Booking ${text(upcoming.booking_number)} is ${text(upcoming.status)} on ${when || "an open date"}${slot ? ` at ${slot}` : ""}${address ? `, ${address}` : ""}${city ? `, ${city}` : ""}.`
    : "No active booking.";
  const brief = brandNew
    ? [
      "Facts for you. Do not read this aloud as a list.",
      "This is a new caller. Nothing is saved for this number yet.",
      "They may be calling to book a first clean. Start the booking.",
      "Do not apologize for a missing account and do not read a list of missing fields.",
      phone ? `Caller phone: ${phone}.` : "",
      zip ? `ZIP ${zip} is ${serviced === "yes" ? "served" : serviced === "no" ? "not served" : "unconfirmed"}. ${text(coverage?.city)} ${text(coverage?.state)} ${zoneName}.` : "No ZIP yet. Ask for it first.",
    ].filter(Boolean).join(" ")
    : [
      "Facts for you. Do not read this aloud as a list.",
      fullName ? `Name on file: ${fullName}.` : "No name is on file yet.",
      phone ? `Caller phone: ${phone}.` : "",
      email.includes("@") ? `Email on file: ${email}.` : "",
      address ? `Address on file: ${address}, ${city} ${state} ${zip}.` : "",
      zip ? `ZIP ${zip} is ${serviced === "yes" ? "served" : serviced === "no" ? "not served" : "unconfirmed"}. ${text(coverage?.city)} ${text(coverage?.state)} ${zoneName}.` : "No ZIP is on file yet.",
      knownService ? `Service interest: ${serviceLabel(knownService)}.` : "",
      sizeLabel ? `Home size on file: ${sizeLabel}.` : "",
      bedrooms ? `Bedrooms on file: ${bedrooms}.` : "",
      nextBooking,
      dueNow > 0 ? `Deposit still due to confirm the visit: ${money(dueNow)}.` : "No deposit is waiting on an active visit.",
      completedCount > 0 ? `Completed cleans on this number: ${completedCount}.` : "",
      lead?.source ? `Lead source: ${text(lead.source)}.` : "",
      doNotCall ? "This lead is marked do not call." : "",
    ].filter(Boolean).join(" ");

  const variables = {
    customer_found: bookings.length ? "yes" : "no",
    caller_status: brandNew ? "new" : "known",
    first_name: firstName,
    customer_name: fullName,
    customer_email: email.includes("@") ? email : "",
    customer_address: address,
    caller_phone: phone,
    known_zip: zip,
    zip_serviced: serviced,
    coverage_city: text(coverage?.city),
    coverage_state: text(coverage?.state),
    pricing_zone: zoneName,
    known_service_type: knownService,
    known_home_size_id: knownSize,
    next_booking: nextBooking,
    outstanding_balance: dueNow > 0 ? money(dueNow) : "none",
    payment_link_on_file: upcoming?.hosted_invoice_url ? "yes" : "no",
    lead_source: text(lead?.source || hinted.lead_source),
    do_not_call: doNotCall ? "yes" : "no",
    say_first: sayFirst,
    next_step: nextStep,
    missing_to_book: upcoming?.status === "pending_payment"
      ? "Do not start a second booking unless they want a different home."
      : brandNew
        ? "New caller. Ask one thing at a time: ZIP, then the street address. Use the address lookup for city and state. Learn if they are moving, if the home is empty, and how kept up it is. Text the checklist before any price."
        : (missing.length ? missing.join(", ") : "Nothing else. Read the visit back and ask for a yes."),
    result_target: resultTarget,
    context_brief: brief,
    agent_role: role,
    opening_line: openingLine,
  };

  const dynamic_variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) dynamic_variables[key] = clip(text(value));

  return new Response(JSON.stringify({ dynamic_variables }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
