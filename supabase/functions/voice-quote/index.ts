// Live price for the Telnyx booking tools.
// Uses the ZIP's pricing zone and never describes the result as a
// 50 percent new-customer promo.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { calculatePriceCents } from "./pricing.ts";

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

function serviceAdvice(serviceType: string, condition: string): { recommended_service: string; comparison: string } {
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
      comparison: "A move-in or move-out includes the fridge and oven. An empty home is 15 percent under the price of a furnished move-out.",
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
  const advice = serviceAdvice(serviceType, condition);
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
  const discountLine = spoken.empty_move_out_discount
    ? "Empty move-out is 15 percent under a furnished move-out. "
    : "";
  const otherLine = alternate
    ? ` If they still want the ${serviceType} clean, that total is ${fmt(priced.totalCents)} and the deposit is ${fmt(priced.depositCents)}.`
    : "";
  return new Response(JSON.stringify({
    total_cents: spoken.totalCents,
    deposit_cents: spoken.depositCents,
    remaining_cents: spoken.remainingCents,
    quoted_service: spokenService,
    empty_move_out_discount: spoken.empty_move_out_discount,
    recommended_service: advice.recommended_service,
    requested_total_cents: priced.totalCents,
    alternate_total_cents: alternate?.totalCents ?? null,
    alternate_deposit_cents: alternate?.depositCents ?? null,
    zone,
    zip_code: zip || null,
    human_summary: `${advice.comparison ? `${advice.comparison} ` : ""}${discountLine}Quote the ${spokenService} clean unless they choose otherwise. Total ${fmt(spoken.totalCents)}. Deposit today ${fmt(spoken.depositCents)}. Balance ${fmt(spoken.remainingCents)} after the clean.${otherLine} This price holds for 48 hours. Say these amounts only. Do not add another discount.`,
  }), { headers });
});
