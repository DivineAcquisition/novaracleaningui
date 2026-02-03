import { supabase } from "@/integrations/supabase/client";

// ============================================
// TYPES
// ============================================

export interface HomeSizeRange {
  id: string;
  label: string;
  minSqft: number;
  maxSqft: number;
  bedroomRange: string;
  baseHours: number;
  standardPrice: number;
}

export interface PricingZone {
  id: string;
  name: string;
  modifier: number;
  areas: string[];
}

export interface ServiceType {
  id: string;
  name: string;
  multiplier: number;
  includes: string[];
}

export interface MembershipPlan {
  id: string;
  frequency: string;
  cleansPerMonth: number;
  discountVsOnetime: string;
  recommended: boolean;
  firstCleanFeeCents: number;
}

export interface MembershipPrice {
  planId: string;
  sqftRange: string;
  priceCents: number;
  cleaners: string;
}

export interface AddOn {
  id: string;
  name: string;
  priceCents: number;
  description?: string;
}

export interface ContractorTier {
  id: string;
  name: string;
  hourlyRateCents: number;
  platformFee: number;
  tenureMonthsRequired: number;
  minJobsRequired: number;
  minRating: number;
  onTimeRateRequired?: number;
  jobAccess: string[];
  priorityBooking: boolean;
}

export interface CleanerAssignmentRule {
  serviceType: string;
  sqftRange: string;
  cleaners: string;
  preferTier?: string;
  fallbackCleaners?: number;
}

export interface PricingCalculation {
  basePrice: number;
  serviceAddition: number;
  addOnsTotal: number;
  subtotal: number;
  membershipDiscount: number;
  newCustomerDiscount: number;
  zoneModifier: number;
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

// ============================================
// CONSTANTS (Fallback values)
// ============================================

export const HOURLY_RATE = 75;
export const DEPOSIT_AMOUNT = 39;
export const OVERTIME_RATE = 75;
export const OVERTIME_INCREMENT = 0.5;
export const NEW_CUSTOMER_DISCOUNT = 60;
export const MEMBERSHIP_FIRST_CLEAN_FEE = 75;
export const CUSTOM_QUOTE_THRESHOLD_SQFT = 5000;
export const PLATFORM_FEE = 0.05;

// Zone modifiers
export const PRICING_ZONES: Record<string, PricingZone> = {
  A: {
    id: 'A',
    name: 'Premium',
    modifier: 1.15,
    areas: ['Bethesda', 'Potomac', 'Chevy Chase', 'Rockville', 'Silver Spring'],
  },
  B: {
    id: 'B',
    name: 'Standard',
    modifier: 1.0,
    areas: ['Rest of MoCo', 'PG County', 'Columbia', 'Ellicott City'],
  },
  C: {
    id: 'C',
    name: 'Outer',
    modifier: 0.90,
    areas: ['Frederick', 'Hagerstown', 'Annapolis', 'Baltimore suburbs'],
  },
};

// Zone A ZIP codes (Premium)
export const ZONE_A_ZIP_CODES = [
  '20814', '20815', '20816', '20817', '20854', '20859', 
  '20850', '20851', '20852', '20901', '20902', '20903', 
  '20904', '20910'
];

// Zone C ZIP codes (Outer)
export const ZONE_C_ZIP_CODES = [
  '21701', '21702', '21703', '21740', '21742', 
  '21401', '21403', '21117', '21208', '21228', '21244'
];

// Updated home size ranges with new pricing
export const HOME_SIZE_RANGES: HomeSizeRange[] = [
  {
    id: '0_999',
    label: '0 – 999 sq ft',
    minSqft: 0,
    maxSqft: 999,
    bedroomRange: 'Studio – 1 BR',
    baseHours: 2.0,
    standardPrice: 150,
  },
  {
    id: '1000_1500',
    label: '1,000 – 1,500 sq ft',
    minSqft: 1000,
    maxSqft: 1500,
    bedroomRange: '1–2 BR condos/homes',
    baseHours: 2.5,
    standardPrice: 189,
  },
  {
    id: '1501_2000',
    label: '1,501 – 2,000 sq ft',
    minSqft: 1501,
    maxSqft: 2000,
    bedroomRange: '2–3 BR apartments/townhomes',
    baseHours: 3.0,
    standardPrice: 239,
  },
  {
    id: '2001_2500',
    label: '2,001 – 2,500 sq ft',
    minSqft: 2001,
    maxSqft: 2500,
    bedroomRange: '3–4 BR homes',
    baseHours: 3.5,
    standardPrice: 279,
  },
  {
    id: '2501_3000',
    label: '2,501 – 3,000 sq ft',
    minSqft: 2501,
    maxSqft: 3000,
    bedroomRange: '4 BR homes',
    baseHours: 4.0,
    standardPrice: 339,
  },
  {
    id: '3001_3500',
    label: '3,001 – 3,500 sq ft',
    minSqft: 3001,
    maxSqft: 3500,
    bedroomRange: '4–5 BR homes',
    baseHours: 4.5,
    standardPrice: 379,
  },
  {
    id: '3501_4000',
    label: '3,501 – 4,000 sq ft',
    minSqft: 3501,
    maxSqft: 4000,
    bedroomRange: '5 BR homes',
    baseHours: 5.0,
    standardPrice: 439,
  },
  {
    id: '4001_4500',
    label: '4,001 – 4,500 sq ft',
    minSqft: 4001,
    maxSqft: 4500,
    bedroomRange: '5+ BR homes',
    baseHours: 5.5,
    standardPrice: 489,
  },
  {
    id: '4501_5000',
    label: '4,501 – 5,000 sq ft',
    minSqft: 4501,
    maxSqft: 5000,
    bedroomRange: '5+ BR large homes',
    baseHours: 6.0,
    standardPrice: 539,
  },
  {
    id: '5000_plus',
    label: '5,000+ sq ft',
    minSqft: 5000,
    maxSqft: 999999,
    bedroomRange: '6+ BR estates',
    baseHours: 0,
    standardPrice: 0,
  },
];

// Service type multipliers
export const SERVICE_TYPE_MULTIPLIERS = {
  standard: { name: 'Standard Clean', multiplier: 1.0, includes: [] },
  deep: { name: 'Deep Clean', multiplier: 1.5, includes: [] },
  moveInOut: { name: 'Move-In/Out Clean', multiplier: 2.0, includes: ['fridge', 'oven'] },
};

// Legacy SERVICE_TIER_PRICING for backward compatibility
export const SERVICE_TIER_PRICING = {
  standard: { label: 'Standard', addition: 0 },
  deep: { label: 'Deep Clean', addition: 50 },
  moveInOut: { label: 'Move-In/Out Cleaning', addition: 120 },
};

// Add-ons with new pricing
export const ADD_ONS = {
  fridge: { label: 'Inside Fridge', price: 30 },
  oven: { label: 'Inside Oven', price: 30 },
  windows: { label: 'Interior Windows', price: 40 },
};

// Membership prices by frequency and sqft range
export const MEMBERSHIP_PRICES = {
  monthly: {
    '0_999': { price: 129, cleaners: '1' },
    '1000_1500': { price: 159, cleaners: '1' },
    '1501_2000': { price: 199, cleaners: '1' },
    '2001_2500': { price: 229, cleaners: '1' },
    '2501_3000': { price: 279, cleaners: '1-2' },
    '3001_3500': { price: 319, cleaners: '1-2' },
    '3501_4000': { price: 369, cleaners: '2' },
    '4001_4500': { price: 409, cleaners: '2' },
    '4501_5000': { price: 459, cleaners: '2' },
  },
  biweekly: {
    '0_999': { price: 199, cleaners: '1' },
    '1000_1500': { price: 249, cleaners: '1' },
    '1501_2000': { price: 319, cleaners: '1' },
    '2001_2500': { price: 369, cleaners: '1' },
    '2501_3000': { price: 449, cleaners: '1-2' },
    '3001_3500': { price: 499, cleaners: '1-2' },
    '3501_4000': { price: 579, cleaners: '2' },
    '4001_4500': { price: 649, cleaners: '2' },
    '4501_5000': { price: 719, cleaners: '2' },
  },
  weekly: {
    '0_999': { price: 349, cleaners: '1' },
    '1000_1500': { price: 449, cleaners: '1' },
    '1501_2000': { price: 569, cleaners: '1' },
    '2001_2500': { price: 659, cleaners: '1' },
    '2501_3000': { price: 799, cleaners: '1-2' },
    '3001_3500': { price: 899, cleaners: '1-2' },
    '3501_4000': { price: 1039, cleaners: '2' },
    '4001_4500': { price: 1159, cleaners: '2' },
    '4501_5000': { price: 1279, cleaners: '2' },
  },
};

// Legacy MEMBERSHIP_PLANS for backward compatibility
export const MEMBERSHIP_PLANS = {
  none: {
    id: 'none',
    label: 'Pay Per Clean',
    monthlyPrice: 0,
    cleansPerMonth: 0,
    includedHours: 0,
    overtimeDiscount: 0,
    discount: 0,
    description: 'No commitment, pay as you go',
    features: ['Flexible scheduling', 'No monthly fees', 'Cancel anytime']
  },
  essential: {
    id: 'essential',
    label: 'Essential',
    monthlyPrice: 189,
    cleansPerMonth: 1,
    includedHours: 2,
    overtimeDiscount: 0.15,
    discount: 0.10,
    description: '1 clean/month • 2 hrs included • 15% off overtime',
    features: ['1 clean per month', '2 hours included', '15% off overtime', 'Priority scheduling']
  },
  standard: {
    id: 'standard',
    label: 'Standard',
    monthlyPrice: 289,
    cleansPerMonth: 2,
    includedHours: 3,
    overtimeDiscount: 0.25,
    discount: 0.20,
    description: '2 cleans/month • 3 hrs included • 25% off overtime',
    features: ['2 cleans per month', '3 hours included', '25% off overtime', 'Priority scheduling', 'Free add-ons']
  },
  premium: {
    id: 'premium',
    label: 'Premium',
    monthlyPrice: 389,
    cleansPerMonth: 4,
    includedHours: 3,
    overtimeDiscount: 0.35,
    discount: 0.30,
    description: '4 cleans/month • 3 hrs included • 35% off overtime',
    features: ['4 cleans per month', '3 hours included per clean', '35% off overtime', 'VIP scheduling', 'Free add-ons', 'Dedicated team']
  }
};

// Contractor tiers
export const CONTRACTOR_TIERS = {
  foundation: {
    name: 'Foundation',
    hourlyRate: 18,
    platformFee: 0.10,
    requirements: { tenureMonths: 0, minJobs: 0, minRating: 4.8 },
    jobAccess: ['standard'],
  },
  proven: {
    name: 'Proven',
    hourlyRate: 20,
    platformFee: 0.07,
    requirements: { tenureMonths: 6, minJobs: 25, minRating: 4.8, onTimeRate: 0.90 },
    jobAccess: ['standard', 'deep'],
  },
  elite: {
    name: 'Elite',
    hourlyRate: 22,
    platformFee: 0.05,
    requirements: { tenureMonths: 12, minJobs: 50, minRating: 4.8, onTimeRate: 0.95 },
    jobAccess: ['standard', 'deep', 'move_in_out'],
    priorityBooking: true,
  },
};

// ============================================
// ZONE FUNCTIONS
// ============================================

/**
 * Get the pricing zone for a ZIP code
 */
export function getZoneForZipCode(zipCode: string): PricingZone {
  if (ZONE_A_ZIP_CODES.includes(zipCode)) {
    return PRICING_ZONES.A;
  }
  if (ZONE_C_ZIP_CODES.includes(zipCode)) {
    return PRICING_ZONES.C;
  }
  // Default to Zone B (Standard)
  return PRICING_ZONES.B;
}

/**
 * Get zone modifier for pricing calculations
 */
export function getZoneModifier(zipCode: string): number {
  const zone = getZoneForZipCode(zipCode);
  return zone.modifier;
}

/**
 * Fetch zone from Supabase (with fallback to local lookup)
 */
export async function fetchZoneForZipCode(zipCode: string): Promise<PricingZone> {
  try {
    const { data, error } = await supabase
      .rpc('get_pricing_zone', { p_zip_code: zipCode });
    
    if (error || !data || data.length === 0) {
      return getZoneForZipCode(zipCode);
    }
    
    return {
      id: data[0].zone_id,
      name: data[0].zone_name,
      modifier: parseFloat(data[0].modifier),
      areas: PRICING_ZONES[data[0].zone_id as keyof typeof PRICING_ZONES]?.areas || [],
    };
  } catch {
    return getZoneForZipCode(zipCode);
  }
}

// ============================================
// PRICING FUNCTIONS
// ============================================

export function getEstimatedHours(homeSizeId: string): number {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  return homeSize?.baseHours || 4;
}

/**
 * Get base price for home size (one-time)
 */
export function getBasePrice(homeSizeId: string): number {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  return homeSize?.standardPrice || 0;
}

/**
 * Get membership price for home size and frequency
 */
export function getMembershipPrice(homeSizeId: string, frequency: 'monthly' | 'biweekly' | 'weekly'): number {
  const prices = MEMBERSHIP_PRICES[frequency];
  if (!prices) return 0;
  
  const priceInfo = prices[homeSizeId as keyof typeof prices];
  return priceInfo?.price || 0;
}

/**
 * Calculate price with zone modifier
 */
export function calculatePriceWithZone(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false,
  isNewCustomer: boolean = false,
  promoDiscount: number = 0,
  zipCode?: string
): PricingCalculation {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  const zoneModifier = zipCode ? getZoneModifier(zipCode) : 1.0;
  
  if (!homeSize) {
    return {
      basePrice: 0,
      serviceAddition: 0,
      addOnsTotal: 0,
      subtotal: 0,
      membershipDiscount: 0,
      newCustomerDiscount: 0,
      zoneModifier: 1.0,
      total: 0,
      deposit: DEPOSIT_AMOUNT,
      balanceDue: 0,
      hours: 0,
    };
  }

  // Get base price based on service type multiplier
  let basePrice = homeSize.standardPrice;
  const serviceMultiplier = SERVICE_TYPE_MULTIPLIERS[serviceType as keyof typeof SERVICE_TYPE_MULTIPLIERS]?.multiplier || 1.0;
  const serviceIncludes = SERVICE_TYPE_MULTIPLIERS[serviceType as keyof typeof SERVICE_TYPE_MULTIPLIERS]?.includes || [];
  
  // Apply zone modifier to base price
  basePrice = Math.round(basePrice * zoneModifier);
  
  // Apply service type multiplier
  const serviceAddition = Math.round(basePrice * (serviceMultiplier - 1));
  
  // Add-ons (smart filtering for services that include certain add-ons)
  let addOnsTotal = 0;
  for (const addon of addOns) {
    if (!serviceIncludes.includes(addon)) {
      addOnsTotal += ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0;
    }
  }
  
  // Subtotal before discounts
  const subtotal = basePrice + serviceAddition + addOnsTotal;
  
  // Membership discount applies to extras
  const membership = MEMBERSHIP_PLANS[membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const extrasAmount = serviceAddition + addOnsTotal;
  const membershipDiscount = membership && !useCredit ? extrasAmount * membership.discount : 0;
  
  // New customer discount (only for non-members)
  const newCustomerDiscount = isNewCustomer && membershipPlan === 'none' ? NEW_CUSTOMER_DISCOUNT : 0;
  
  // Credit coverage
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  
  // Deposit
  const deposit = useCredit ? 0 : DEPOSIT_AMOUNT;
  
  // Total calculation
  const total = subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - promoDiscount;
  const balanceDue = Math.max(0, total - deposit);
  
  return {
    basePrice,
    serviceAddition,
    addOnsTotal,
    subtotal,
    membershipDiscount,
    newCustomerDiscount,
    zoneModifier,
    total: Math.max(0, total),
    deposit: useCredit ? 0 : DEPOSIT_AMOUNT,
    balanceDue,
    hours: homeSize.baseHours,
  };
}

/**
 * Calculate full payment with discount (10% off for paying in full)
 */
export function calculateFullPaymentWithDiscount(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false,
  isNewCustomer: boolean = false,
  promoDiscount: number = 0,
  zipCode?: string
): FullPaymentCalculation {
  const pricing = zipCode 
    ? calculatePriceWithZone(homeSizeId, serviceType, addOns, membershipPlan, useCredit, isNewCustomer, promoDiscount, zipCode)
    : calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, isNewCustomer, promoDiscount);
  
  // Calculate 10% full payment discount on the total AFTER all other discounts
  const fullPaymentDiscount = Math.round(pricing.total * 0.10 * 100) / 100;
  
  // Final amount after all discounts including full payment discount
  const finalAmount = pricing.total - fullPaymentDiscount;
  
  // originalTotal should be the subtotal (before any discounts) for display purposes
  const originalTotal = pricing.subtotal;
  
  // Total savings = new customer + membership + full payment + promo discounts
  const totalSavings = pricing.newCustomerDiscount + pricing.membershipDiscount + fullPaymentDiscount + promoDiscount;
  
  return {
    originalTotal: originalTotal,
    discount: fullPaymentDiscount,
    newCustomerDiscount: pricing.newCustomerDiscount,
    promoDiscount,
    finalAmount: Math.max(0, finalAmount),
    savings: totalSavings,
  };
}

/**
 * Original calculatePrice function (backward compatible)
 */
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
      basePrice: 0,
      serviceAddition: 0,
      addOnsTotal: 0,
      subtotal: 0,
      membershipDiscount: 0,
      newCustomerDiscount: 0,
      zoneModifier: 1.0,
      total: 0,
      deposit: DEPOSIT_AMOUNT,
      balanceDue: 0,
      hours: 0,
    };
  }

  // Base price from home size
  const basePrice = homeSize.standardPrice;
  
  // Service tier addition
  const serviceAddition = SERVICE_TIER_PRICING[serviceType as keyof typeof SERVICE_TIER_PRICING]?.addition || 0;
  
  // Add-ons (smart filtering for Move-In/Out which includes fridge & oven)
  let addOnsTotal = 0;
  if (serviceType === 'moveInOut') {
    // Move-In/Out includes fridge & oven, only count windows
    addOnsTotal = addOns
      .filter(addon => addon === 'windows')
      .reduce((total, addon) => total + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0), 0);
  } else {
    // Standard & Deep count all add-ons
    addOnsTotal = addOns.reduce((total, addon) => {
      return total + (ADD_ONS[addon as keyof typeof ADD_ONS]?.price || 0);
    }, 0);
  }
  
  // Subtotal before membership discount
  const subtotal = basePrice + serviceAddition + addOnsTotal;
  
  // Membership discount applies only to extras (service addition + add-ons)
  const membership = MEMBERSHIP_PLANS[membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const extrasAmount = serviceAddition + addOnsTotal;
  const membershipDiscount = membership && !useCredit ? extrasAmount * membership.discount : 0;
  
  // New customer discount (only for non-members)
  const newCustomerDiscount = isNewCustomer && membershipPlan === 'none' ? NEW_CUSTOMER_DISCOUNT : 0;
  
  // If using credit, base price is covered (up to 2 hours worth = $150)
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  
  // Deposit: $0 for members using credit, $39 otherwise
  const deposit = useCredit ? 0 : DEPOSIT_AMOUNT;
  
  // Total calculation with promo discount
  const total = subtotal - membershipDiscount - newCustomerDiscount - creditCoverage - promoDiscount;
  const balanceDue = Math.max(0, total - deposit);
  
  return {
    basePrice,
    serviceAddition,
    addOnsTotal,
    subtotal,
    membershipDiscount,
    newCustomerDiscount,
    zoneModifier: 1.0,
    total: Math.max(0, total),
    deposit: useCredit ? 0 : DEPOSIT_AMOUNT,
    balanceDue,
    hours: homeSize.baseHours,
  };
}

/**
 * Apply and validate promo code
 */
export async function applyPromoCode(
  code: string,
  subtotal: number,
  homeSizeId: string,
  isNewCustomer: boolean,
  customerEmail: string,
  supabaseClient: typeof supabase
): Promise<PromoValidation> {
  if (!code.trim()) {
    return { valid: false, discount: 0, message: 'Please enter a promo code' };
  }

  // Fetch promo code from database
  const { data: promoCode, error } = await supabaseClient
    .from('promo_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('active', true)
    .single();

  if (error || !promoCode) {
    return { valid: false, discount: 0, message: 'Invalid promo code' };
  }

  // Check expiration
  if (promoCode.expires_at && new Date(promoCode.expires_at) < new Date()) {
    return { valid: false, discount: 0, message: 'This promo code has expired' };
  }

  // Check customer eligibility
  if (promoCode.applies_to === 'new_customers' && !isNewCustomer) {
    return { valid: false, discount: 0, message: 'This code is only for new customers' };
  }
  if (promoCode.applies_to === 'returning_customers' && isNewCustomer) {
    return { valid: false, discount: 0, message: 'This code is only for returning customers' };
  }

  // Check total usage limit
  if (promoCode.max_total_uses && promoCode.total_uses >= promoCode.max_total_uses) {
    return { valid: false, discount: 0, message: 'This promo code has reached its usage limit' };
  }

  // Check per-customer usage limit
  if (promoCode.max_uses_per_customer) {
    const { data: customerUsage } = await supabaseClient
      .from('bookings')
      .select('id')
      .eq('email', customerEmail)
      .ilike('team_notes', `%${code.toUpperCase()}%`); // Promo codes stored in team_notes

    if (customerUsage && customerUsage.length >= promoCode.max_uses_per_customer) {
      return { 
        valid: false, 
        discount: 0, 
        message: `You've already used this code ${promoCode.max_uses_per_customer} time(s)` 
      };
    }
  }

  // Calculate discount
  let discount = 0;
  if (promoCode.type === 'percent') {
    discount = Math.round((subtotal * promoCode.value) / 100 * 100) / 100;
  } else {
    discount = promoCode.value;
  }

  // Validate profit margin (import validateDiscount if needed)
  const finalPrice = subtotal - discount;
  if (finalPrice < 0) {
    return { valid: false, discount: 0, message: 'Invalid discount amount' };
  }

  return {
    valid: true,
    discount,
    message: `${promoCode.value}% off applied!`,
    promoCode: promoCode as PromoCode,
  };
}

// ============================================
// SUPABASE FETCH FUNCTIONS
// ============================================

/**
 * Fetch pricing from Supabase
 */
export async function fetchPricingFromSupabase(
  zipCode: string,
  sqft: number,
  serviceType: string,
  frequency: string = 'one_time',
  addOns: string[] = []
): Promise<{
  basePriceCents: number;
  zoneModifier: number;
  serviceMultiplier: number;
  addOnsCents: number;
  totalPriceCents: number;
  estimatedHours: number;
  cleaners: string;
} | null> {
  try {
    const { data, error } = await supabase.rpc('calculate_booking_price', {
      p_zip_code: zipCode,
      p_sqft: sqft,
      p_service_type: serviceType,
      p_frequency: frequency,
      p_add_ons: addOns,
    });

    if (error || !data || data.length === 0) {
      console.error('Error fetching pricing from Supabase:', error);
      return null;
    }

    return {
      basePriceCents: data[0].base_price_cents,
      zoneModifier: parseFloat(data[0].zone_modifier),
      serviceMultiplier: parseFloat(data[0].service_multiplier),
      addOnsCents: data[0].add_ons_cents,
      totalPriceCents: data[0].total_price_cents,
      estimatedHours: parseFloat(data[0].estimated_hours),
      cleaners: data[0].cleaners,
    };
  } catch (err) {
    console.error('Exception fetching pricing:', err);
    return null;
  }
}

/**
 * Get cleaner assignment rules for a job
 */
export function getCleanerAssignment(
  serviceType: string, 
  homeSizeId: string
): { cleaners: string; preferTier?: string; fallbackCleaners?: number } {
  // Map home size IDs to sqft ranges
  const sqftRangeMap: Record<string, string> = {
    '0_999': '0-999',
    '1000_1500': '1000-1500',
    '1501_2000': '1501-2000',
    '2001_2500': '2001-2500',
    '2501_3000': '2501-3000',
    '3001_3500': '3001-3500',
    '3501_4000': '3501-4000',
    '4001_4500': '4001-4500',
    '4501_5000': '4501-5000',
  };

  const sqftRange = sqftRangeMap[homeSizeId] || '0-999';
  
  // Standard service cleaner assignments
  const standardAssignments: Record<string, { cleaners: string; preferTier?: string; fallbackCleaners?: number }> = {
    '0-999': { cleaners: '1' },
    '1000-1500': { cleaners: '1' },
    '1501-2000': { cleaners: '1' },
    '2001-2500': { cleaners: '1' },
    '2501-3000': { cleaners: '1', preferTier: 'elite', fallbackCleaners: 2 },
    '3001-3500': { cleaners: '1', preferTier: 'elite', fallbackCleaners: 2 },
    '3501-4000': { cleaners: '2' },
    '4001-4500': { cleaners: '2' },
    '4501-5000': { cleaners: '2' },
  };

  const deepAssignments: Record<string, { cleaners: string }> = {
    '0-999': { cleaners: '1' },
    '1000-1500': { cleaners: '1' },
    '1501-2000': { cleaners: '1' },
    '2001-2500': { cleaners: '1-2' },
    '2501-3000': { cleaners: '2' },
    '3001-3500': { cleaners: '2' },
    '3501-4000': { cleaners: '2' },
    '4001-4500': { cleaners: '2-3' },
    '4501-5000': { cleaners: '2-3' },
  };

  const moveInOutAssignments: Record<string, { cleaners: string }> = {
    '0-999': { cleaners: '1' },
    '1000-1500': { cleaners: '1-2' },
    '1501-2000': { cleaners: '2' },
    '2001-2500': { cleaners: '2' },
    '2501-3000': { cleaners: '2' },
    '3001-3500': { cleaners: '2-3' },
    '3501-4000': { cleaners: '2-3' },
    '4001-4500': { cleaners: '3' },
    '4501-5000': { cleaners: '3' },
  };

  if (serviceType === 'deep') {
    return deepAssignments[sqftRange] || { cleaners: '1' };
  }
  if (serviceType === 'moveInOut' || serviceType === 'move_in_out') {
    return moveInOutAssignments[sqftRange] || { cleaners: '1' };
  }
  return standardAssignments[sqftRange] || { cleaners: '1' };
}
