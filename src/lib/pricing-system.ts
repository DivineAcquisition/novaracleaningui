export interface HomeSizeRange {
  id: string;
  label: string;
  minSqft: number;
  maxSqft: number;
  bedroomRange: string;
  baseHours: number;
  standardPrice: number;
}

export const HOURLY_RATE = 75;
export const DEPOSIT_AMOUNT = 39;
export const OVERTIME_RATE = 75;
export const OVERTIME_INCREMENT = 0.5;
export const NEW_CUSTOMER_DISCOUNT = 60;

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
    standardPrice: 187.5,
  },
  {
    id: '1501_2000',
    label: '1,501 – 2,000 sq ft',
    minSqft: 1501,
    maxSqft: 2000,
    bedroomRange: '2–3 BR apartments/townhomes',
    baseHours: 3.0,
    standardPrice: 225,
  },
  {
    id: '2001_2500',
    label: '2,001 – 2,500 sq ft',
    minSqft: 2001,
    maxSqft: 2500,
    bedroomRange: '3–4 BR homes',
    baseHours: 3.5,
    standardPrice: 262.5,
  },
  {
    id: '2501_3000',
    label: '2,501 – 3,000 sq ft',
    minSqft: 2501,
    maxSqft: 3000,
    bedroomRange: '4 BR homes',
    baseHours: 4.0,
    standardPrice: 300,
  },
  {
    id: '3001_3500',
    label: '3,001 – 3,500 sq ft',
    minSqft: 3001,
    maxSqft: 3500,
    bedroomRange: '4–5 BR homes',
    baseHours: 4.5,
    standardPrice: 337.5,
  },
  {
    id: '3501_4000',
    label: '3,501 – 4,000 sq ft',
    minSqft: 3501,
    maxSqft: 4000,
    bedroomRange: '5 BR homes',
    baseHours: 5.0,
    standardPrice: 375,
  },
  {
    id: '4001_4500',
    label: '4,001 – 4,500 sq ft',
    minSqft: 4001,
    maxSqft: 4500,
    bedroomRange: '5+ BR homes',
    baseHours: 5.5,
    standardPrice: 412.5,
  },
  {
    id: '4501_5000',
    label: '4,501 – 5,000 sq ft',
    minSqft: 4501,
    maxSqft: 5000,
    bedroomRange: '5+ BR large homes',
    baseHours: 6.0,
    standardPrice: 450,
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

export const SERVICE_TIER_PRICING = {
  standard: { label: 'Standard', addition: 0 },
  deep: { label: 'Deep Clean', addition: 50 },
  moveInOut: { label: 'Move-In/Out Cleaning', addition: 120 },
};

export const ADD_ONS = {
  fridge: { label: 'Inside Fridge', price: 30 },
  oven: { label: 'Inside Oven', price: 30 },
  windows: { label: 'Interior Windows', price: 40 },
};

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
  // Get base pricing WITH new customer discount AND promo discount already applied
  const pricing = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, isNewCustomer, promoDiscount);
  
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
  supabase: any
): Promise<PromoValidation> {
  if (!code.trim()) {
    return { valid: false, discount: 0, message: 'Please enter a promo code' };
  }

  // Fetch promo code from database
  const { data: promoCode, error } = await supabase
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
    const { data: customerUsage } = await supabase
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
    message: `🎉 ${promoCode.value}% off applied!`,
    promoCode: promoCode as PromoCode,
  };
}
