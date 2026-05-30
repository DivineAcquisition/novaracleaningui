/**
 * Automatic Promo Code Application — DISABLED (v4 pricing).
 *
 * In v3 we ran a "highest-value eligible promo" auto-applier so /book/checkout
 * could quietly stack DB promo codes (HOLIDAY25, JOLLY20, NEWYEAR15) on top
 * of the 50% acquisition discount. v4 collapses every customer-facing
 * discount into the per-service-tier rules in `src/lib/pricing.ts` — there
 * are now exactly three discounts in the entire system (standard 15%,
 * deep 25%, combo 50% off the standard portion). Auto-applying a DB promo
 * on top of those is no longer valid; it would double-discount.
 *
 * This module keeps its original surface area so existing imports compile,
 * but `findBestPromoCode` always returns null. If/when product wants
 * seasonal promos back, switch the implementation here AND update
 * `_shared/pricing.ts` so the math agrees end-to-end.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface EligiblePromo {
  code: string;
  value: number;
  type: "percent" | "amount";
  discount: number;
  description: string;
}

export async function findBestPromoCode(
  _supabase: SupabaseClient,
  _customerEmail: string,
  _isNewCustomer: boolean,
  _subtotal: number,
): Promise<EligiblePromo | null> {
  void _supabase; void _customerEmail; void _isNewCustomer; void _subtotal;
  return null;
}

export function formatPromoSavings(_promo: EligiblePromo): string {
  return "";
}

export function getPromoRecommendation(_isNewCustomer: boolean): string {
  return "";
}
