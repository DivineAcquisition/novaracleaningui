// ─── NovaraCleaning Pricing System v4.0 — Deno mirror ────────────────────
//
// Lock-step mirror of `src/lib/pricing.ts`. Edge functions MUST import
// pricing math from this module so customer charges (create-payment-intent),
// VA invoices (book-as-va), and the AI quoting agent (ai-tool-router)
// always produce the same numbers the React app shows.
//
// If you change anything here, change `src/lib/pricing.ts` to match — and
// vice-versa. Drift between the two is what produced the v3.x "the offer
// said $216 but the server charged $432" bug.

export type ServiceType = "standard" | "deep" | "combo" | "moveInOut" | "focused";
export type ZoneId = "A" | "B" | "C";
export type MembershipPlan = "none" | "monthly" | "biweekly" | "weekly";

export interface HomeSizeRange {
  id: string;
  label: string;
  minSqft: number;
  maxSqft: number;
  bedroomRange: string;
  baseHours: number;
  /** Zone B base standard-clean price (whole dollars). */
  standardPrice: number;
  cleaners: string;
}

export const HOME_SIZE_RANGES: HomeSizeRange[] = [
  { id: "0_999",     label: "0 – 999 sq ft",         minSqft: 0,    maxSqft: 999,    bedroomRange: "Studio – 1 BR",       baseHours: 2.0, standardPrice: 150, cleaners: "1" },
  { id: "1000_1500", label: "1,000 – 1,500 sq ft",   minSqft: 1000, maxSqft: 1500,   bedroomRange: "1–2 BR condos/homes", baseHours: 2.5, standardPrice: 190, cleaners: "1" },
  { id: "1501_2000", label: "1,501 – 2,000 sq ft",   minSqft: 1501, maxSqft: 2000,   bedroomRange: "2–3 BR apartments",   baseHours: 3.0, standardPrice: 225, cleaners: "1" },
  { id: "2001_2500", label: "2,001 – 2,500 sq ft",   minSqft: 2001, maxSqft: 2500,   bedroomRange: "3–4 BR homes",        baseHours: 3.5, standardPrice: 260, cleaners: "1" },
  { id: "2501_3000", label: "2,501 – 3,000 sq ft",   minSqft: 2501, maxSqft: 3000,   bedroomRange: "4 BR homes",          baseHours: 4.0, standardPrice: 300, cleaners: "1-2" },
  { id: "3001_3500", label: "3,001 – 3,500 sq ft",   minSqft: 3001, maxSqft: 3500,   bedroomRange: "4–5 BR homes",        baseHours: 4.5, standardPrice: 340, cleaners: "1-2" },
  { id: "3501_4000", label: "3,501 – 4,000 sq ft",   minSqft: 3501, maxSqft: 4000,   bedroomRange: "5 BR homes",          baseHours: 5.0, standardPrice: 375, cleaners: "2" },
  { id: "4001_4500", label: "4,001 – 4,500 sq ft",   minSqft: 4001, maxSqft: 4500,   bedroomRange: "5+ BR homes",         baseHours: 5.5, standardPrice: 415, cleaners: "2" },
  { id: "4501_5000", label: "4,501 – 5,000 sq ft",   minSqft: 4501, maxSqft: 5000,   bedroomRange: "5+ BR large homes",   baseHours: 6.0, standardPrice: 450, cleaners: "2" },
  { id: "5000_plus", label: "5,000+ sq ft",          minSqft: 5000, maxSqft: 999999, bedroomRange: "6+ BR estates",       baseHours: 0,   standardPrice: 0,   cleaners: "Custom" },
];

export const SERVICE_TIER_PRICING: Record<ServiceType, { label: string; multiplier: number }> = {
  standard:  { label: "Standard Clean",          multiplier: 1.0 },
  deep:      { label: "Deep Clean",              multiplier: 1.5 },
  combo:     { label: "Deep + Standard Combo",   multiplier: 2.5 },
  moveInOut: { label: "Move-In / Move-Out",      multiplier: 2.0 },
  focused:   { label: "Focused / Single-Area Clean", multiplier: 0 },
};

export const SERVICE_ZONES: Record<ZoneId, { id: ZoneId; modifier: number }> = {
  A: { id: "A", modifier: 1.15 },
  B: { id: "B", modifier: 1.00 },
  C: { id: "C", modifier: 0.90 },
};

export const ADD_ONS: Record<string, { price: number }> = {
  fridge:       { price: 30 },
  oven:         { price: 30 },
  windows:      { price: 40 },
  laundry:      { price: 35 },
  changeLinens: { price: 15 },
  dishes:       { price: 20 },
  baseboards:   { price: 35 },
  blinds:       { price: 30 },
  cabinets:     { price: 35 },
  walls:        { price: 40 },
  ceilingFans:  { price: 15 },
  microwave:    { price: 10 },
  dishwasher:   { price: 15 },
  garage:       { price: 50 },
  basement:     { price: 75 },
  patio:        { price: 35 },
  petHair:      { price: 35 },
  closets:      { price: 30 },
  trashHaul:    { price: 75 },
  deepBathroomDetail: { price: 45 },
  cateringEvent: { price: 85 },
  firstCleanDeep: { price: 75 },
};

export const FIRST_CLEAN_DEEP_ID = "firstCleanDeep";

export function chargeableAddOnIds(addOns: string[], serviceType: string): string[] {
  const ids = (addOns || []).filter(Boolean);
  if (serviceType === "moveInOut") return ids.filter((a) => a !== "fridge" && a !== "oven");
  if (serviceType === "deep" || serviceType === "combo") {
    return ids.filter((a) => a !== FIRST_CLEAN_DEEP_ID);
  }
  return ids;
}

export const MEMBERSHIP_PRICES: Record<string, { monthly: number; biweekly: number; weekly: number }> = {
  "0_999":     { monthly: 129, biweekly: 199, weekly: 349 },
  "1000_1500": { monthly: 159, biweekly: 249, weekly: 449 },
  "1501_2000": { monthly: 199, biweekly: 319, weekly: 569 },
  "2001_2500": { monthly: 229, biweekly: 369, weekly: 659 },
  "2501_3000": { monthly: 279, biweekly: 449, weekly: 799 },
  "3001_3500": { monthly: 319, biweekly: 499, weekly: 899 },
  "3501_4000": { monthly: 369, biweekly: 579, weekly: 1039 },
  "4001_4500": { monthly: 409, biweekly: 649, weekly: 1159 },
  "4501_5000": { monthly: 459, biweekly: 719, weekly: 1279 },
};

export const SERVICE_DISCOUNT_RATES: Record<ServiceType, number> = {
  standard:  0.15,
  deep:      0.25,
  combo:     0,
  moveInOut: 0,
  focused:   0,
};

export const DEPOSIT_PERCENT = 0.5;

// ─── Helpers ─────────────────────────────────────────────────────────────

export function getHomeSize(homeSizeId: string): HomeSizeRange | undefined {
  return HOME_SIZE_RANGES.find((h) => h.id === homeSizeId);
}

export function getZonePrice(basePrice: number, zone: ZoneId = "B"): number {
  return Math.round(basePrice * SERVICE_ZONES[zone].modifier);
}

export function getServiceListPrice(
  homeSizeId: string,
  serviceType: ServiceType | string,
  zone: ZoneId = "B",
): number {
  if (serviceType === "focused") return 0; // per-area flat rates — see focused-same-day.ts
  const home = getHomeSize(homeSizeId);
  if (!home || home.standardPrice === 0) return 0;
  const tier = SERVICE_TIER_PRICING[serviceType as ServiceType];
  if (!tier) return 0;
  return getZonePrice(home.standardPrice * tier.multiplier, zone);
}

export function getServiceFinalPrice(
  homeSizeId: string,
  serviceType: ServiceType | string,
  zone: ZoneId = "B",
  membershipPlan: MembershipPlan | string = "none",
): number {
  const list = getServiceListPrice(homeSizeId, serviceType, zone);
  if (list === 0) return 0;
  if (membershipPlan !== "none") return list;
  const home = getHomeSize(homeSizeId);
  if (!home) return list;
  const stdList = getZonePrice(home.standardPrice, zone);
  const deepList = getZonePrice(home.standardPrice * SERVICE_TIER_PRICING.deep.multiplier, zone);
  switch (serviceType) {
    case "standard":
      return Math.round(stdList * (1 - SERVICE_DISCOUNT_RATES.standard) * 100) / 100;
    case "deep":
      return Math.round(deepList * (1 - SERVICE_DISCOUNT_RATES.deep) * 100) / 100;
    case "combo":
      return Math.round((stdList * 0.5 + deepList) * 100) / 100;
    case "moveInOut":
    default:
      return list;
  }
}

export function getMembershipPrice(
  homeSizeId: string,
  planId: MembershipPlan | string,
  zone: ZoneId = "B",
): number {
  const prices = MEMBERSHIP_PRICES[homeSizeId];
  if (!prices) return 0;
  const planKey = planId as "monthly" | "biweekly" | "weekly";
  const basePrice = prices[planKey] || 0;
  return getZonePrice(basePrice, zone);
}

export interface PricingCalculation {
  basePrice: number;
  serviceListPrice: number;
  serviceFinalPrice: number;
  serviceDiscount: number;
  addOnsTotal: number;
  subtotal: number;
  total: number;
  creditCoverage: number;
  deposit: number;
  balanceDue: number;
  hours: number;
}

export function calculatePrice(
  homeSizeId: string,
  serviceType: ServiceType | string,
  addOns: string[] = [],
  membershipPlan: MembershipPlan | string = "none",
  useCredit = false,
  zone: ZoneId = "B",
): PricingCalculation {
  const home = getHomeSize(homeSizeId);
  if (!home) {
    return { basePrice: 0, serviceListPrice: 0, serviceFinalPrice: 0, serviceDiscount: 0, addOnsTotal: 0, subtotal: 0, total: 0, creditCoverage: 0, deposit: 0, balanceDue: 0, hours: 0 };
  }
  const basePrice = getZonePrice(home.standardPrice, zone);
  const serviceListPrice = getServiceListPrice(homeSizeId, serviceType, zone);
  const serviceFinalPrice = getServiceFinalPrice(homeSizeId, serviceType, zone, membershipPlan);
  const serviceDiscount = Math.max(0, serviceListPrice - serviceFinalPrice);

  const addOnsTotal = chargeableAddOnIds(addOns, String(serviceType)).reduce(
    (sum, a) => sum + (ADD_ONS[a]?.price || 0),
    0,
  );

  const subtotal = serviceListPrice + addOnsTotal;
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  const total = Math.max(0, serviceFinalPrice + addOnsTotal - creditCoverage);
  const deposit = useCredit ? 0 : Math.round(total * DEPOSIT_PERCENT * 100) / 100;
  const balanceDue = Math.max(0, total - deposit);

  return {
    basePrice, serviceListPrice, serviceFinalPrice, serviceDiscount,
    addOnsTotal, subtotal, total, creditCoverage, deposit, balanceDue,
    hours: home.baseHours,
  };
}

/** Cents-only convenience wrapper for edge functions doing Stripe math. */
export interface PricingCents {
  basePriceCents: number;
  serviceListCents: number;
  serviceFinalCents: number;
  discountCents: number;
  addOnsCents: number;
  subtotalCents: number;
  totalCents: number;
  depositCents: number;
  remainingCents: number;
  hours: number;
}

export function calculatePriceCents(
  homeSizeId: string,
  serviceType: ServiceType | string,
  addOns: string[] = [],
  membershipPlan: MembershipPlan | string = "none",
  useCredit = false,
  zone: ZoneId = "B",
): PricingCents {
  const c = calculatePrice(homeSizeId, serviceType, addOns, membershipPlan, useCredit, zone);
  const toC = (n: number) => Math.round(n * 100);
  return {
    basePriceCents: toC(c.basePrice),
    serviceListCents: toC(c.serviceListPrice),
    serviceFinalCents: toC(c.serviceFinalPrice),
    discountCents: toC(c.serviceDiscount),
    addOnsCents: toC(c.addOnsTotal),
    subtotalCents: toC(c.subtotal),
    totalCents: toC(c.total),
    depositCents: toC(c.deposit),
    remainingCents: toC(c.balanceDue),
    hours: c.hours,
  };
}
