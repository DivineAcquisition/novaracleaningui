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
  const addOns = Array.isArray(body.add_ons) ? body.add_ons.map(String) : [];
  const membershipPlan = String(body.membership_plan || "none");
  const zip = String(body.zip_code || body.zip || "").replace(/\D/g, "").slice(0, 5);
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
  const priced = calculatePriceCents(homeSizeId, serviceType, addOns, membershipPlan, false, zone);
  if (!priced.totalCents) {
    return new Response(JSON.stringify({
      error: "could_not_price",
      human_summary: "I could not price that home from the size given. Ask for the square footage again.",
    }), { headers });
  }
  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const balance = Math.max(0, priced.totalCents - priced.depositCents);
  return new Response(JSON.stringify({
    subtotal_cents: priced.subtotalCents,
    promo_discount_cents: priced.discountCents,
    total_cents: priced.totalCents,
    deposit_cents: priced.depositCents,
    remaining_cents: priced.remainingCents,
    zone,
    zip_code: zip || null,
    human_summary: `Total ${fmt(priced.totalCents)}. Deposit today ${fmt(priced.depositCents)}. Balance ${fmt(balance)} after the clean. This price holds for 48 hours. Say these amounts only. Do not add a discount, a courtesy, or a 50 percent new-customer promo.`,
  }), { headers });
});
