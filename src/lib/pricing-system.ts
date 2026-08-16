// ─── NovaraCleaning Pricing System v4.0 ───────────────────────────────────
//
// This file is now a thin BACKWARDS-COMPATIBILITY facade in front of
// `pricing.ts` — the new single source of truth. Every value/function that
// older code imported from `pricing-system` is re-exported here, but the
// underlying math comes from `pricing.ts` so customer + VA + edge functions
// always agree.
//
// New code MUST import from `@/lib/pricing` directly. Do not add new exports
// to this file.

import {
  HOME_SIZE_RANGES as _HOME_SIZE_RANGES,
  SERVICE_TIER_PRICING as _SERVICE_TIER_PRICING,
  SERVICE_ZONES as _SERVICE_ZONES,
  ADD_ONS as _ADD_ONS,
  FIRST_CLEAN_DEEP_ID as _FIRST_CLEAN_DEEP_ID,
  chargeableAddOnIds as _chargeableAddOnIds,
  MEMBERSHIP_PLANS as _MEMBERSHIP_PLANS,
  MEMBERSHIP_PRICES as _MEMBERSHIP_PRICES,
  DEPOSIT_PERCENT as _DEPOSIT_PERCENT,
  calculatePrice as _calculatePrice,
  getServiceListPrice as _getServiceListPrice,
  getServiceFinalPrice as _getServiceFinalPrice,
  getZonePrice as _getZonePrice,
  getMembershipPrice as _getMembershipPrice,
  getEstimatedHours as _getEstimatedHours,
  type HomeSizeRange as _HomeSizeRange,
  type ZoneId as _ZoneId,
} from "./pricing";

// ─── Pass-throughs (preserve original symbol names) ──────────────────────
export const HOME_SIZE_RANGES = _HOME_SIZE_RANGES;
export const SERVICE_TIER_PRICING = _SERVICE_TIER_PRICING;
export const SERVICE_ZONES = _SERVICE_ZONES;
export const ADD_ONS = _ADD_ONS;
export const FIRST_CLEAN_DEEP_ID = _FIRST_CLEAN_DEEP_ID;
export const chargeableAddOnIds = _chargeableAddOnIds;
export const MEMBERSHIP_PLANS = _MEMBERSHIP_PLANS;
export const MEMBERSHIP_PRICES = _MEMBERSHIP_PRICES;
export const DEPOSIT_PERCENT = _DEPOSIT_PERCENT;

export type HomeSizeRange = _HomeSizeRange;
export type ZoneId = _ZoneId;

// Legacy helpers
export const HOURLY_RATE = 75;
export const OVERTIME_RATE = 75;
export const OVERTIME_INCREMENT = 0.5;
export const DEPOSIT_AMOUNT = 0;
export const FIRST_CLEAN_SURCHARGE = 0;

/** @deprecated The acquisition discount is now per-service-tier — see
 *  SERVICE_DISCOUNT_RATES in `pricing.ts`. This constant is retained so
 *  legacy callers compile; it is no longer used in any calculation. */
export const NEW_CUSTOMER_DISCOUNT_PERCENT = 0;
/** @deprecated See NEW_CUSTOMER_DISCOUNT_PERCENT note above. */
export const NEW_CUSTOMER_DISCOUNT = 0;

export function getZonePrice(basePrice: number, zone: ZoneId = "B"): number {
  return _getZonePrice(basePrice, zone);
}

export function getServicePrice(homeSizeId: string, serviceType: string, zone: ZoneId = "B"): number {
  // Legacy callers expected the LIST price (pre-discount). Keep that contract.
  return _getServiceListPrice(homeSizeId, serviceType, zone);
}

export function getMembershipPrice(homeSizeId: string, planId: string, zone: ZoneId = "B"): number {
  return _getMembershipPrice(homeSizeId, planId, zone);
}

export function getEstimatedHours(homeSizeId: string): number {
  return _getEstimatedHours(homeSizeId);
}

// ─── Types preserved from v3 (shape kept identical for downstream UI) ────
export interface PricingCalculation {
  basePrice: number;
  serviceAddition: number;
  addOnsTotal: number;
  subtotal: number;
  membershipDiscount: number;
  newCustomerDiscount: number;
  total: number;
  deposit: number;
  balanceDue: number;
  hours: number;
}

export interface PromoCode {
  code: string;
  type: "percent" | "amount";
  value: number;
  applies_to: "all" | "new_customers" | "returning_customers";
  min_profit_margin_percent: number;
  max_uses_per_customer?: number;
  total_uses: number;
  max_total_uses?: number;
}

export interface PromoValidation {
  valid: boolean;
  discount: number;
  message?: string;
  promoCode?: PromoCode;
}

export interface FullPaymentCalculation {
  originalTotal: number;
  discount: number;
  newCustomerDiscount: number;
  promoDiscount: number;
  finalAmount: number;
  savings: number;
}

/**
 * v3-compatible wrapper around the new calculator. The `isNewCustomer` and
 * `promoDiscount` args are intentionally ignored — discounts are now driven
 * entirely by the service tier rules in `pricing.ts`.
 */
export function calculatePrice(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = "none",
  useCredit: boolean = false,
  _isNewCustomer: boolean = false,
  _promoDiscount: number = 0,
): PricingCalculation {
  void _isNewCustomer;
  void _promoDiscount;
  const calc = _calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, "B");
  const serviceAddition = Math.max(0, calc.serviceListPrice - calc.basePrice);
  return {
    basePrice: calc.basePrice,
    serviceAddition,
    addOnsTotal: calc.addOnsTotal,
    subtotal: calc.subtotal,
    // Legacy field name kept for component compatibility. Now equals the
    // ENTIRE discount applied to the service tier — whether that came from
    // the standard 15%, deep 25%, or combo "50% off standard portion" rule.
    membershipDiscount: 0,
    newCustomerDiscount: calc.serviceDiscount,
    total: calc.total,
    deposit: calc.deposit,
    balanceDue: calc.balanceDue,
    hours: calc.hours,
  };
}

export function calculateFullPaymentWithDiscount(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = "none",
  useCredit: boolean = false,
  isNewCustomer: boolean = false,
  promoDiscount: number = 0,
): FullPaymentCalculation {
  const pricing = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, isNewCustomer, promoDiscount);
  const finalAmount = pricing.total;
  return {
    originalTotal: pricing.subtotal,
    discount: 0,
    newCustomerDiscount: pricing.newCustomerDiscount,
    promoDiscount: 0,
    finalAmount: Math.max(0, finalAmount),
    savings: pricing.newCustomerDiscount,
  };
}

/**
 * Promo-code redemption is fully disabled — the only discounts in the
 * system are the service-tier rules baked into `pricing.ts`. We keep the
 * function signature so legacy components still compile, but it always
 * returns "invalid" so nothing can stack on top of the new rates.
 */
export async function applyPromoCode(
  _code: string,
  _subtotal: number,
  _homeSizeId: string,
  _isNewCustomer: boolean,
  _customerEmail: string,
  _supabase: unknown,
): Promise<PromoValidation> {
  void _code; void _subtotal; void _homeSizeId; void _isNewCustomer; void _customerEmail; void _supabase;
  return {
    valid: false,
    discount: 0,
    message: "Promo codes are no longer accepted — the published rate already includes the appropriate discount.",
  };
}
