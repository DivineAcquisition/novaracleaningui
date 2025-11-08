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
    label: 'Pay Per Clean', 
    monthlyPrice: 0, 
    credits: 0, 
    discount: 0,
    description: 'No commitment, pay as you go'
  },
  monthly: { 
    label: 'Novara Monthly', 
    monthlyPrice: 189, 
    credits: 1, 
    discount: 0.20,
    description: '1 credit/month • 20% off extras'
  },
  biweekly: { 
    label: 'Novara Bi-Weekly', 
    monthlyPrice: 289, 
    credits: 2, 
    discount: 0.25,
    description: '2 credits/month • 25% off extras • early booking'
  },
  weekly: { 
    label: 'Novara Weekly', 
    monthlyPrice: 389, 
    credits: 4, 
    discount: 0.30,
    description: '4 credits/month • 30% off extras • priority'
  },
};

export interface PricingCalculation {
  basePrice: number;
  serviceAddition: number;
  addOnsTotal: number;
  subtotal: number;
  membershipDiscount: number;
  total: number;
  deposit: number;
  balanceDue: number;
  hours: number;
}

export interface FullPaymentCalculation {
  originalTotal: number;
  discount: number;
  finalAmount: number;
  savings: number;
}

export function calculateFullPaymentWithDiscount(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false
): FullPaymentCalculation {
  const pricing = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit);
  const originalTotal = pricing.total;
  const discount = Math.round(originalTotal * 0.10 * 100) / 100; // 10% discount
  const finalAmount = originalTotal - discount;
  
  return {
    originalTotal,
    discount,
    finalAmount,
    savings: discount,
  };
}

export function calculatePrice(
  homeSizeId: string,
  serviceType: string,
  addOns: string[] = [],
  membershipPlan: string = 'none',
  useCredit: boolean = false
): PricingCalculation {
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
  if (!homeSize) {
    return {
      basePrice: 0,
      serviceAddition: 0,
      addOnsTotal: 0,
      subtotal: 0,
      membershipDiscount: 0,
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
  
  // If using credit, base price is covered (up to 2 hours worth = $150)
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  
  // Deposit: $0 for members using credit, $39 otherwise
  const deposit = useCredit ? 0 : DEPOSIT_AMOUNT;
  
  // Total calculation
  const total = subtotal - membershipDiscount - creditCoverage;
  const balanceDue = Math.max(0, total - deposit);
  
  return {
    basePrice,
    serviceAddition,
    addOnsTotal,
    subtotal,
    membershipDiscount,
    total,
    deposit: useCredit ? 0 : DEPOSIT_AMOUNT,
    balanceDue,
    hours: homeSize.baseHours,
  };
}
