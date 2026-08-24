// ─── Commercial pricing config, server side ────────────────────────────────
//
// commercial-pricing.ts is pure arithmetic and is mirrored into the edge
// functions. This is the Node-side loader for it, so a Next API route can
// compute the same anchor the VA saw and the booking will record, without a
// round trip through the quote edge function.
//
// Missing or empty tables fall back to the shipped defaults rather than
// failing: an admin who deactivates every facility type should get a usable
// number and a support ticket, not a dead pricing step.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  DEFAULT_COMMERCIAL_CONFIG,
  DEFAULT_COMMERCIAL_SETTINGS,
  type CommercialPricingConfig,
  type CommercialSettings,
  type FacilityType,
  type ScopeLevel,
  type SizeTier,
} from "@/lib/commercial-pricing";

type Client = ReturnType<typeof getAdminSupabase>;

export async function loadCommercialConfigServer(
  supabase: Client,
): Promise<CommercialPricingConfig> {
  const [facilities, scopes, tiers, settings] = await Promise.all([
    supabase.from("commercial_facility_types")
      .select("key, label, base_rate_cents_per_sqft, description, sort_order, active")
      .eq("active", true).order("sort_order"),
    supabase.from("commercial_scope_levels")
      .select("key, label, multiplier, summary, sqft_per_cleaner_hour, sort_order, active")
      .eq("active", true).order("sort_order"),
    supabase.from("commercial_size_tiers")
      .select("label, min_sqft, max_sqft, multiplier").order("min_sqft"),
    supabase.from("app_settings").select("value")
      .eq("key", "commercial_pricing_settings").maybeSingle(),
  ]);

  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const facilityTypes = ((facilities.data || []) as FacilityType[]).map((f) => ({
    ...f,
    base_rate_cents_per_sqft: num(f.base_rate_cents_per_sqft, 0),
  }));
  const scopeLevels = ((scopes.data || []) as ScopeLevel[]).map((s) => ({
    ...s,
    multiplier: num(s.multiplier, 1),
    sqft_per_cleaner_hour: Math.round(num(s.sqft_per_cleaner_hour, 2200)),
  }));
  const sizeTiers = ((tiers.data || []) as SizeTier[]).map((t) => ({
    ...t,
    min_sqft: Math.round(num(t.min_sqft, 0)),
    max_sqft: t.max_sqft == null ? null : Math.round(num(t.max_sqft, 0)),
    multiplier: num(t.multiplier, 1),
  }));

  const raw = (settings.data?.value || {}) as Partial<CommercialSettings>;
  const merged = Object.fromEntries(
    Object.entries(DEFAULT_COMMERCIAL_SETTINGS).map(([k, v]) => [
      k,
      num((raw as Record<string, unknown>)[k], v as number),
    ]),
  ) as unknown as CommercialSettings;

  return {
    facilityTypes: facilityTypes.length ? facilityTypes : DEFAULT_COMMERCIAL_CONFIG.facilityTypes,
    scopeLevels: scopeLevels.length ? scopeLevels : DEFAULT_COMMERCIAL_CONFIG.scopeLevels,
    sizeTiers: sizeTiers.length ? sizeTiers : DEFAULT_COMMERCIAL_CONFIG.sizeTiers,
    settings: merged,
  };
}
