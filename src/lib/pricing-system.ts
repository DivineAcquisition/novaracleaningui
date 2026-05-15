// ─── NovaraCleaning Pricing System v3.0 — Maryland ──────
// Zone B = Base | Zone A = ×1.15 | Zone C = ×0.90
// Deep = Standard × 1.5 | Move-In/Out = Standard × 2.0
// Base prices raised ~2.2x in v3 to protect margins under the 50% new-customer promo.
// Deposit: 50% of total (no more flat $39 down).

export interface HomeSizeRange {
  id: string;
  label: string;
  minSqft: number;
  maxSqft: number;
  bedroomRange: string;
  baseHours: number;
  standardPrice: number; // Zone B base standard clean price
  cleaners: string;      // Number of cleaners for standard
}

export const HOURLY_RATE = 75;
export const OVERTIME_RATE = 75;
export const OVERTIME_INCREMENT = 0.5;

// 50% deposit on total when "Pay 50% Deposit" is chosen.
export const DEPOSIT_PERCENT = 0.5;

// Legacy export kept for backwards-compatibility with views still importing it.
// It is no longer used to compute deposits — those are now 50% of total.
export const DEPOSIT_AMOUNT = 0;

// New-customer promo is now a percentage (50% off) instead of a fixed $ amount.
export const NEW_CUSTOMER_DISCOUNT_PERCENT = 0.5;
// Legacy export — older components expected a fixed dollar amount. Now 0 because
// the discount is computed as a percentage of the subtotal at calculation time.
export const NEW_CUSTOMER_DISCOUNT = 0;

export const FIRST_CLEAN_SURCHARGE = 0; // No longer applied — standard tier hidden from UI.

// ─── Service Zones ──────────────────────────────────────
export const SERVICE_ZONES = {
  A: { id: 'A', label: 'Zone A (Premium)', modifier: 1.15, areas: 'Bethesda, Potomac, Chevy Chase, Rockville, Silver Spring' },
  B: { id: 'B', label: 'Zone B (Standard)', modifier: 1.00, areas: 'Rest of MoCo, PG County, Columbia, Ellicott City' },
  C: { id: 'C', label: 'Zone C (Outer)', modifier: 0.90, areas: 'Frederick, Hagerstown, Annapolis, Baltimore suburbs' },
};

export type ZoneId = 'A' | 'B' | 'C';

// ─── Home Size Ranges (Zone B base prices — v3.1) ───────────────────────
// Aligned to the official Maryland rate card: standard prices are kept
// just slightly above the listed Zone B numbers ($150, $189, $239, …) so
// the displayed standard is above $150 and Deep (×1.5) is above $225 at
// the smallest size. The 50% new-customer promo discounts off these
// base prices.
export const HOME_SIZE_RANGES: HomeSizeRange[] = [
  { id: '0_999',      label: '0 – 999 sq ft',       minSqft: 0,    maxSqft: 999,   bedroomRange: 'Studio – 1 BR',         baseHours: 2.0, standardPrice: 159,   cleaners: '1' },
  { id: '1000_1500',  label: '1,000 – 1,500 sq ft',  minSqft: 1000, maxSqft: 1500,  bedroomRange: '1–2 BR condos/homes',   baseHours: 2.5, standardPrice: 199,   cleaners: '1' },
  { id: '1501_2000',  label: '1,501 – 2,000 sq ft',  minSqft: 1501, maxSqft: 2000,  bedroomRange: '2–3 BR apartments',     baseHours: 3.0, standardPrice: 249,   cleaners: '1' },
  { id: '2001_2500',  label: '2,001 – 2,500 sq ft',  minSqft: 2001, maxSqft: 2500,  bedroomRange: '3–4 BR homes',          baseHours: 3.5, standardPrice: 289,   cleaners: '1' },
  { id: '2501_3000',  label: '2,501 – 3,000 sq ft',  minSqft: 2501, maxSqft: 3000,  bedroomRange: '4 BR homes',            baseHours: 4.0, standardPrice: 349,   cleaners: '1-2' },
  { id: '3001_3500',  label: '3,001 – 3,500 sq ft',  minSqft: 3001, maxSqft: 3500,  bedroomRange: '4–5 BR homes',          baseHours: 4.5, standardPrice: 389,   cleaners: '1-2' },
  { id: '3501_4000',  label: '3,501 – 4,000 sq ft',  minSqft: 3501, maxSqft: 4000,  bedroomRange: '5 BR homes',            baseHours: 5.0, standardPrice: 449,   cleaners: '2' },
  { id: '4001_4500',  label: '4,001 – 4,500 sq ft',  minSqft: 4001, maxSqft: 4500,  bedroomRange: '5+ BR homes',           baseHours: 5.5, standardPrice: 499,   cleaners: '2' },
  { id: '4501_5000',  label: '4,501 – 5,000 sq ft',  minSqft: 4501, maxSqft: 5000,  bedroomRange: '5+ BR large homes',     baseHours: 6.0, standardPrice: 549,   cleaners: '2' },
  { id: '5000_plus',  label: '5,000+ sq ft',          minSqft: 5000, maxSqft: 999999, bedroomRange: '6+ BR estates',         baseHours: 0,   standardPrice: 0,     cleaners: 'Custom' },
];

// ─── Service Tier Multipliers ───────────────────────────
export const SERVICE_TIER_PRICING = {
  standard: { label: 'Standard Clean', multiplier: 1.0, addition: 0 },
  deep:     { label: 'Deep Clean',     multiplier: 1.5, addition: 0 }, // +50% of standard
  moveInOut: { label: 'Move-In/Out',   multiplier: 2.0, addition: 0 }, // +100% of standard, includes fridge & oven
};

// ─── Add-Ons ────────────────────────────────────────────
export const ADD_ONS = {
  fridge:  { label: 'Inside Fridge', price: 30, note: 'Free w/ Move-In/Out' },
  oven:    { label: 'Inside Oven',   price: 30, note: 'Free w/ Move-In/Out' },
  windows: { label: 'Interior Windows', price: 40, note: 'Per visit' },
};

// ─── Membership Plans (Zone B base monthly prices) ──────
// Monthly prices vary by home size. These are the base tier structures.
export const MEMBERSHIP_PLANS = {
  none: {
    id: 'none',
    label: 'Pay Per Clean',
    frequency: 'one-time',
    cleansPerMonth: 0,
    monthlyPrice: 0,
    includedHours: 0,
    overtimeDiscount: 0,
    discount: 0,
    description: 'No commitment, pay as you go',
    features: ['Flexible scheduling', 'No monthly fees', 'Book anytime'],
  },
  monthly: {
    id: 'monthly',
    label: 'Glow Monthly',
    frequency: 'monthly',
    cleansPerMonth: 1,
    monthlyPrice: 0, // Varies by home size
    includedHours: 0,
    overtimeDiscount: 0.15,
    discount: 0.15,
    description: '1 clean/month • Up to 18% off',
    features: ['1 clean per month', 'Up to 18% off one-time price', 'Priority scheduling', 'Cancel anytime'],
  },
  biweekly: {
    id: 'biweekly',
    label: 'Glow Bi-Weekly',
    frequency: 'biweekly',
    cleansPerMonth: 2,
    monthlyPrice: 0, // Varies by home size
    includedHours: 0,
    overtimeDiscount: 0.25,
    discount: 0.34,
    description: '2 cleans/month • Up to 34% off • BEST VALUE',
    features: ['2 cleans per month', 'Up to 34% off per clean', 'Priority scheduling', 'Free add-ons', 'Same trusted team'],
  },
  weekly: {
    id: 'weekly',
    label: 'Glow Weekly',
    frequency: 'weekly',
    cleansPerMonth: 4,
    monthlyPrice: 0, // Varies by home size
    includedHours: 0,
    overtimeDiscount: 0.35,
    discount: 0.42,
    description: '4 cleans/month • Up to 42% off • Premium',
    features: ['4 cleans per month', 'Up to 42% off per clean', 'VIP scheduling', 'Free add-ons', 'Dedicated team', 'Best for families & pets'],
  },
};

// ─── Membership pricing lookup (Zone B base — v3.1) ─────
// Membership pricing matches the official Maryland rate card exactly.
// The 50% new-customer promo does NOT stack on memberships (members
// already get plan-level discounts of 14–42% per clean).
export const MEMBERSHIP_PRICES: Record<string, { monthly: number; biweekly: number; weekly: number }> = {
  '0_999':     { monthly: 129, biweekly: 199, weekly: 349 },
  '1000_1500': { monthly: 159, biweekly: 249, weekly: 449 },
  '1501_2000': { monthly: 199, biweekly: 319, weekly: 569 },
  '2001_2500': { monthly: 229, biweekly: 369, weekly: 659 },
  '2501_3000': { monthly: 279, biweekly: 449, weekly: 799 },
  '3001_3500': { monthly: 319, biweekly: 499, weekly: 899 },
  '3501_4000': { monthly: 369, biweekly: 579, weekly: 1039 },
  '4001_4500': { monthly: 409, biweekly: 649, weekly: 1159 },
  '4501_5000': { monthly: 459, biweekly: 719, weekly: 1279 },
};

// ─── Helpers ────────────────────────────────────────────

/** Get zone-adjusted price */
export function getZonePrice(basePrice: number, zone: ZoneId = 'B'): number {
  return Math.round(basePrice * SERVICE_ZONES[zone].modifier);
}

/** Get service tier price for a home size and zone */
export function getServicePrice(homeSizeId: string, serviceType: string, zone: ZoneId = 'B'): number {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  if (!homeSize || homeSize.standardPrice === 0) return 0;
  
  const tier = SERVICE_TIER_PRICING[serviceType as keyof typeof SERVICE_TIER_PRICING];
  const basePrice = homeSize.standardPrice * (tier?.multiplier || 1);
  return getZonePrice(Math.round(basePrice), zone);
}

/** Get membership monthly price for a home size, plan, and zone */
export function getMembershipPrice(homeSizeId: string, planId: string, zone: ZoneId = 'B'): number {
  const prices = MEMBERSHIP_PRICES[homeSizeId];
  if (!prices) return 0;
  
  const planKey = planId as keyof typeof prices;
  const basePrice = prices[planKey] || 0;
  return getZonePrice(basePrice, zone);
}

// ─── Types ──────────────────────────────────────────────

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
  type: 'percent' | 'amount';
  value: number;
  applies_to: 'all' | 'new_customers' | 'returning_customers';
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

export function getEstimatedHours(homeSizeId: string): number {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  return homeSize?.baseHours || 4;
}

export function calculateFullPaymentWithDiscount(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false,
  isNewCustomer: boolean = false,
  promoDiscount: number = 0
): FullPaymentCalculation {
  const pricing = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, isNewCustomer, promoDiscount);
  // Pay-in-full no longer stacks an extra 10% off on top of the 50% new-customer
  // promo — customer just pays the full discounted total today (no deposit split).
  const finalAmount = pricing.total;
  const originalTotal = pricing.subtotal;
  const totalSavings = pricing.newCustomerDiscount + pricing.membershipDiscount + promoDiscount;

  return {
    originalTotal,
    discount: 0,
    newCustomerDiscount: pricing.newCustomerDiscount,
    promoDiscount,
    finalAmount: Math.max(0, finalAmount),
    savings: totalSavings,
  };
}

export function calculatePrice(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false,
  isNewCustomer: boolean = false,
  promoDiscount: number = 0
): PricingCalculation {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  if (!homeSize) {
    return {
      basePrice: 0, serviceAddition: 0, addOnsTotal: 0, subtotal: 0,
      membershipDiscount: 0, newCustomerDiscount: 0, total: 0,
      deposit: 0, balanceDue: 0, hours: 0,
    };
  }

  // Base price = standard clean for the home size (Zone B)
  const basePrice = homeSize.standardPrice;

  // Service tier: deep = 50% more, moveInOut = 100% more
  const tier = SERVICE_TIER_PRICING[serviceType as keyof typeof SERVICE_TIER_PRICING];
  const serviceAddition = tier ? Math.round(basePrice * (tier.multiplier - 1)) : 0;

  // Add-ons (Move-In/Out includes fridge & oven)
  let addOnsTotal = 0;
  if (serviceType === 'moveInOut') {
    addOnsTotal = addOns
      .filter(addon => addon === 'windows')
      .reduce((total, addon) => total + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0), 0);
  } else {
    addOnsTotal = addOns.reduce((total, addon) => {
      return total + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0);
    }, 0);
  }

  const subtotal = basePrice + serviceAddition + addOnsTotal;

  // Membership discount on extras
  const membership = MEMBERSHIP_PLANS[membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const extrasAmount = serviceAddition + addOnsTotal;
  const membershipDiscount = membership && !useCredit ? extrasAmount * membership.discount : 0;

  // New customer promo — 50% off the entire subtotal.
  // Only Standard and Deep one-time cleans qualify. Members already
  // get plan-level pricing (14–42% off per clean), and Move-In/Out is
  // intentionally excluded.
  const promoEligible =
    membershipPlan === 'none' && (serviceType === 'standard' || serviceType === 'deep');
  const newCustomerDiscount = isNewCustomer && promoEligible
    ? Math.round(subtotal * NEW_CUSTOMER_DISCOUNT_PERCENT * 100) / 100
    : 0;

  // Credit coverage
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;

  const total = Math.max(0, subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - promoDiscount);

  // Deposit = 50% of total (rounded to nearest cent). Zero if using membership credit.
  const deposit = useCredit ? 0 : Math.round(total * DEPOSIT_PERCENT * 100) / 100;
  const balanceDue = Math.max(0, total - deposit);

  return {
    basePrice, serviceAddition, addOnsTotal, subtotal,
    membershipDiscount, newCustomerDiscount,
    total,
    deposit,
    balanceDue,
    hours: homeSize.baseHours,
  };
}

export async function applyPromoCode(
  code: string, subtotal: number, homeSizeId: string,
  isNewCustomer: boolean, customerEmail: string, supabase: any
): Promise<PromoValidation> {
  if (!code.trim()) return { valid: false, discount: 0, message: 'Please enter a promo code' };

  const { data: promoCode, error } = await supabase
    .from('promo_codes').select('*').eq('code', code.toUpperCase()).eq('active', true).single();

  if (error || !promoCode) return { valid: false, discount: 0, message: 'Invalid promo code' };
  if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date())
    return { valid: false, discount: 0, message: 'This promo code has expired' };
  if (promoCode.applies_to === 'new_customers' && !isNewCustomer)
    return { valid: false, discount: 0, message: 'This code is only for new customers' };
  if (promoCode.applies_to === 'returning_customers' && isNewCustomer)
    return { valid: false, discount: 0, message: 'This code is only for returning customers' };
  if (promoCode.max_total_uses && promoCode.total_uses >= promoCode.max_total_uses)
    return { valid: false, discount: 0, message: 'This promo code has reached its usage limit' };

  if (promoCode.max_uses_per_customer) {
    const { data: customerUsage } = await supabase
      .from('bookings').select('id').eq('email', customerEmail)
      .ilike('team_notes', `%${code.toUpperCase()}%`);
    if (customerUsage && customerUsage.length >= promoCode.max_uses_per_customer)
      return { valid: false, discount: 0, message: `You've already used this code ${promoCode.max_uses_per_customer} time(s)` };
  }

  let discount = promoCode.type === 'percent'
    ? Math.round((subtotal * promoCode.value) / 100 * 100) / 100
    : promoCode.value;

  if (subtotal - discount < 0) return { valid: false, discount: 0, message: 'Invalid discount amount' };

  return { valid: true, discount, message: `🎉 ${promoCode.value}% off applied!`, promoCode: promoCode as PromoCode };
}
