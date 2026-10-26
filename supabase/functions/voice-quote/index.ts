// Live price for the Telnyx booking tools.
// Uses the ZIP's pricing zone and never describes the result as a
// 50 percent new-customer promo.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { calculatePriceCents, HOME_SIZE_RANGES } from "./pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ZoneLetter = "A" | "B" | "C";

function emptyMoveOut(serviceType: string, occupancy: string): boolean {
  const occ = occupancy.toLowerCase();
  const empty = occ.includes("empty") || occ.includes("vacant") || occ.includes("unoccupied") || occ.includes("unfurnished");
  return serviceType === "moveInOut" && empty;
}

function applyOccupancy(totalCents: number, serviceType: string, occupancy: string) {
  if (!emptyMoveOut(serviceType, occupancy) || totalCents <= 0) {
    const deposit = Math.round(totalCents / 2);
    return { totalCents, depositCents: deposit, remainingCents: totalCents - deposit, empty_move_out_discount: false };
  }
  const total = Math.round(totalCents * 0.85);
  const deposit = Math.round(total / 2);
  return { totalCents: total, depositCents: deposit, remainingCents: total - deposit, empty_move_out_discount: true };
}

function serviceAdvice(serviceType: string, condition: string, occupancy: string): { recommended_service: string; comparison: string } {
  const c = condition.toLowerCase();
  const light = /light|kept|tidy|good|maintained|well|regular/.test(c);
  const heavy = /heavy|messy|dirty|neglected|build|first|long time|awhile|a while/.test(c);
  if (serviceType === "deep" && light && !heavy) {
    return {
      recommended_service: "standard",
      comparison: "The home sounds kept up, so a standard clean fits better than a deep clean. A deep clean adds inside cabinets, baseboards, interior windows, and behind furniture.",
    };
  }
  if (serviceType === "standard" && heavy) {
    return {
      recommended_service: "deep",
      comparison: "The home sounds like more than a regular clean. A deep clean adds inside cabinets, baseboards, interior windows, and behind furniture.",
    };
  }
  if (serviceType === "moveInOut") {
    return {
      recommended_service: "moveInOut",
      comparison: emptyMoveOut(serviceType, occupancy)
        ? "This empty move-out includes the fridge and oven. The price is already 15 percent under a furnished move-out."
        : "A move-in or move-out includes the fridge and oven. If the home is empty, pass occupancy empty. That price is 15 percent under a furnished move-out.",
    };
  }
  return { recommended_service: serviceType || "standard", comparison: "" };
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
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  const homeSizeId = String(body.home_size_id || "");
  const serviceType = String(body.service_type || "standard");
  const occupancy = String(body.occupancy || "");
  const condition = String(body.home_condition || "");
  const addOns = Array.isArray(body.add_ons) ? body.add_ons.map(String) : [];
  const membershipPlan = String(body.membership_plan || "none");
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
  const advice = serviceAdvice(serviceType, condition, occupancy);
  if (homeSizeId === "5000_plus") {
    return new Response(JSON.stringify({
      total_cents: 0,
      deposit_cents: 0,
      remaining_cents: 0,
      requires_custom_quote: true,
      human_summary: "Homes over 5,000 square feet need a person to quote. Call escalate_to_human with reason custom_quote.",
    }), { headers });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  let zone: ZoneLetter = "B";
  if (/^\d{5}$/.test(zip)) {
    const { data: zoneZip } = await supabase.from("pricing_zone_zips").select("zone_id").eq("zip", zip).maybeSingle();
    if (zoneZip?.zone_id) {
      const { data: zoneRow } = await supabase.from("pricing_zones").select("code, name, multiplier").eq("id", zoneZip.zone_id).maybeSingle();
      zone = zoneLetterFrom(zoneRow);
    }
  }
  const quoteOne = (type: string) => {
    const raw = calculatePriceCents(homeSizeId, type, addOns, membershipPlan, false, zone);
    return applyOccupancy(raw.totalCents, type, occupancy);
  };
  const priced = quoteOne(serviceType);
  if (!priced.totalCents) {
    return new Response(JSON.stringify({
      error: "could_not_price",
      human_summary: "I could not price that home from the size given. Ask for the square footage again.",
    }), { headers });
  }
  const alternate = advice.recommended_service !== serviceType ? quoteOne(advice.recommended_service) : null;
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const spoken = alternate || priced;
  const spokenService = alternate ? advice.recommended_service : serviceType;
  const otherLine = alternate
    ? ` If they still want the ${serviceType} clean, that total is ${fmt(priced.totalCents)} and the deposit is ${fmt(priced.depositCents)}.`
    : "";
  const delivery = await deliverQuote(supabase, body, spoken, spokenService);
  const priceLine = `${labelService(spokenService)} total ${fmt(spoken.totalCents)}. Half due now is ${fmt(spoken.depositCents)}. The other half, ${fmt(spoken.remainingCents)}, is charged when the clean is done.`;
  const humanSummary = delivery.ready
    ? `${advice.comparison ? `${advice.comparison} ` : ""}Say this price out loud now. ${priceLine}${otherLine} This price holds for 48 hours. Do not add another discount.`
    : `Do not say a price yet. Still need ${delivery.missing.join(", ")}. The street address comes last, after the name, ZIP, home type, beds, baths, size, pets, email, and a confirmed phone.`;
  return new Response(JSON.stringify({
    total_cents: delivery.ready ? spoken.totalCents : 0,
    deposit_cents: delivery.ready ? spoken.depositCents : 0,
    remaining_cents: delivery.ready ? spoken.remainingCents : 0,
    quoted_service: spokenService,
    empty_move_out_discount: spoken.empty_move_out_discount,
    recommended_service: advice.recommended_service,
    requested_total_cents: priced.totalCents,
    alternate_total_cents: alternate?.totalCents ?? null,
    alternate_deposit_cents: alternate?.depositCents ?? null,
    zone,
    zip_code: zip || null,
    price_ready: delivery.ready,
    human_summary: humanSummary,
    quote_email_sent: delivery.email_sent,
    checklist_sent: delivery.checklist_sent,
    say: delivery.ready
      ? `Say the total ${fmt(spoken.totalCents)} and the deposit ${fmt(spoken.depositCents)} out loud. Quote email ${delivery.email_sent ? "sent" : "did not send"}. Checklist ${delivery.checklist_sent ? "sent" : "did not send"}. Tell them which ones arrived. The deposit text goes out when they pick a day and you book it.`
      : `Do not say a dollar amount yet. Still need ${delivery.missing.join(", ")}.`,
  }), { headers });
});

function labelService(serviceType: string): string {
  if (serviceType === "moveInOut") return "Move-in/out";
  if (serviceType === "deep") return "Deep clean";
  if (serviceType === "combo") return "Deep and standard";
  return "Standard clean";
}

function sizeLabel(id: string): string {
  return HOME_SIZE_RANGES.find((band) => band.id === id)?.label || id;
}

async function deliverQuote(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  priced: { totalCents: number; depositCents: number; remainingCents: number },
  serviceType: string,
): Promise<{ ready: boolean; missing: string[]; email_sent: boolean; checklist_sent: boolean }> {
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const first = String(body.first_name || "").trim();
  const address = String(body.address || "").trim();
  const missing: string[] = [];
  if (first.length < 2) missing.push("name");
  if (!email.includes("@")) missing.push("email");
  if (phone.replace(/\D/g, "").length < 10) missing.push("phone");
  if (address.length < 4) missing.push("street address");
  const ready = missing.length === 0;
  if (!ready) return { ready: false, missing, email_sent: false, checklist_sent: false };
  let emailSent = false;
  let checklistSent = false;
  try {
    const mail = await supabase.functions.invoke("send-sales-quote-email", {
      body: {
        email,
        firstName: first,
        serviceName: labelService(serviceType),
        homeSizeLabel: sizeLabel(String(body.home_size_id || "")),
        frequency: "One-Time",
        bedrooms: Number(body.bedrooms || 0),
        bathrooms: Number(body.bathrooms || 0),
        basePriceCents: priced.totalCents,
        serviceTierCost: 0,
        addOnsCents: 0,
        discountPct: 0,
        discountCents: 0,
        finalPriceCents: priced.totalCents,
        depositCents: priced.depositCents,
        balanceDueCents: priced.remainingCents,
        monthlyTotalCents: priced.totalCents,
        isNewCustomer: false,
        addOns: Array.isArray(body.add_ons) ? body.add_ons.map(String) : [],
      },
    });
    emailSent = !mail.error;
  } catch { /* the spoken price still stands */ }
  try {
    const list = await supabase.functions.invoke("send-cleaning-checklist", {
      body: {
        email,
        phone,
        firstName: first,
        serviceType,
        sendEmail: true,
        sendSms: true,
      },
    });
    const data = list.data as { smsSent?: boolean; emailed?: boolean } | null;
    checklistSent = !list.error && Boolean(data?.smsSent || data?.emailed);
  } catch { /* the spoken price still stands */ }
  return { ready: true, missing, email_sent: emailSent, checklist_sent: checklistSent };
}
