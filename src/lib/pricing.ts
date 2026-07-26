// ─── NovaraCleaning Pricing System v4.0 — single source of truth ──────────
//
// Goals (per operator directive, 2026-05-30):
//   1. Use the TRUE list prices (pre-inflation). No more "double the price so
//      we can advertise 50% off" trick.
//   2. Exactly THREE discount rules in the whole system. Nothing else.
//      • Standard clean (alone)        ............... 15% off
//      • Deep clean (alone)            ............... 25% off
//      • Deep + Standard bundle        ............... 50% off the Standard
//                                                       portion only (Deep is
//                                                       charged at full list).
//      → Move-In/Out and Memberships have NO additional discount.
//   3. Pricing is identical between the customer booking funnel and the
//      internal/VA booking form (so quoting matches what the customer pays).
//
// This module is the canonical TypeScript implementation, used by every
// React view. The Deno mirror lives at
// `supabase/functions/_shared/pricing.ts` and MUST be kept in lock-step.

// ─── Base price table (Zone B — the operational baseline) ────────────────
//
// These are the "true" un-inflated standard-clean prices. Deep is +50% of
// Standard. Combo is Standard + Deep. Move-In/Out is 2× Standard.

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

// ─── Service tier multipliers (applied to the standard-clean base) ───────
export type ServiceType = "standard" | "deep" | "combo" | "moveInOut";

export const SERVICE_TIER_PRICING: Record<ServiceType, { label: string; multiplier: number }> = {
  standard:  { label: "Standard Clean",          multiplier: 1.0 },
  deep:      { label: "Deep Clean",              multiplier: 1.5 },
  combo:     { label: "Deep + Standard Combo",   multiplier: 2.5 }, // = standard (1.0) + deep (1.5)
  moveInOut: { label: "Move-In / Move-Out",      multiplier: 2.0 },
};

// ─── Zones ───────────────────────────────────────────────────────────────
export type ZoneId = "A" | "B" | "C";
export const SERVICE_ZONES: Record<ZoneId, { id: ZoneId; label: string; modifier: number; areas: string }> = {
  A: { id: "A", label: "Zone A (Premium)",  modifier: 1.15, areas: "Bethesda, Potomac, Chevy Chase, Rockville, Silver Spring" },
  B: { id: "B", label: "Zone B (Standard)", modifier: 1.00, areas: "Rest of MoCo, PG County, Columbia, Ellicott City" },
  C: { id: "C", label: "Zone C (Outer)",    modifier: 0.90, areas: "Frederick, Hagerstown, Annapolis, Baltimore suburbs" },
};

// ─── Add-ons ─────────────────────────────────────────────────────────────
export const ADD_ONS = {
  fridge:       { label: "Inside Fridge",          price: 30, note: "Free w/ Move-In/Out" },
  oven:         { label: "Inside Oven",            price: 30, note: "Free w/ Move-In/Out" },
  windows:      { label: "Interior Windows",       price: 40, note: "Per visit" },
  laundry:      { label: "Laundry — wash & fold",  price: 35, note: "Per load" },
  changeLinens: { label: "Change bed linens",      price: 15, note: "Linens provided by client" },
  dishes:       { label: "Dishes & kitchen cleanup", price: 20, note: "Hand-wash / load dishwasher" },
  baseboards:   { label: "Baseboards (hand-wiped)", price: 35, note: "Whole home" },
  blinds:       { label: "Blinds & shutters",      price: 30, note: "Dusted / wiped" },
  cabinets:     { label: "Inside cabinets",        price: 35, note: "Emptied cabinets" },
  walls:        { label: "Spot wall washing",      price: 40, note: "Marks & scuffs" },
  ceilingFans:  { label: "Ceiling fans",           price: 15, note: "Per home" },
  microwave:    { label: "Inside microwave",       price: 10, note: "" },
  dishwasher:   { label: "Inside dishwasher",      price: 15, note: "Descale / wipe" },
  garage:       { label: "Garage sweep-out",       price: 50, note: "Single / double" },
  basement:     { label: "Basement clean",         price: 75, note: "Sweep, vacuum & tidy" },
  patio:        { label: "Patio / balcony",        price: 35, note: "Sweep & tidy" },
  petHair:      { label: "Heavy pet-hair removal", price: 35, note: "Extra vacuum pass" },
  closets:      { label: "Inside closets / tidy",  price: 30, note: "Organize & wipe" },
  trashHaul:    { label: "Trash haul",             price: 75, note: "Haul away trash / junk" },
  deepBathroomDetail: { label: "Deep bathroom detail", price: 45, note: "Per bathroom" },
  cateringEvent: { label: "Catering / event cleanup", price: 85, note: "Post-event catering mess & dish volume" },
} as const;

export type AddOnId = keyof typeof ADD_ONS;

// ─── Membership plans (separate pricing rail — no extra discount stack) ──
//
// Members pay the published membership rate per clean. The 15/25/50 discount
// rules below DO NOT apply to memberships — the membership price IS the
// discount.

// Membership plan metadata. `monthlyPrice` + `includedHours` +
// `overtimeDiscount` are zero-valued here because the actual per-home
// monthly rate comes from MEMBERSHIP_PRICES below (varies by home
// size). They're kept as fields so legacy consumers compile.
export const MEMBERSHIP_PLANS = {
  none: {
    id: "none", label: "Pay Per Clean", frequency: "one-time",
    cleansPerMonth: 0, monthlyPrice: 0, includedHours: 0, overtimeDiscount: 0,
    discount: 0,
    description: "No commitment, pay as you go",
    features: ["Flexible scheduling", "No monthly fees", "Book anytime"],
  },
  monthly: {
    id: "monthly", label: "Glow Monthly", frequency: "monthly",
    cleansPerMonth: 1, monthlyPrice: 0, includedHours: 0, overtimeDiscount: 0.15,
    discount: 0.15,
    description: "1 clean/month • members get our best per-clean rates",
    features: ["1 clean per month", "Priority scheduling", "Cancel anytime"],
  },
  biweekly: {
    id: "biweekly", label: "Glow Bi-Weekly", frequency: "biweekly",
    cleansPerMonth: 2, monthlyPrice: 0, includedHours: 0, overtimeDiscount: 0.25,
    discount: 0.25,
    description: "2 cleans/month • members get our best per-clean rates • BEST VALUE",
    features: ["2 cleans per month", "Priority scheduling", "Free add-ons", "Same trusted team"],
  },
  weekly: {
    id: "weekly", label: "Glow Weekly", frequency: "weekly",
    cleansPerMonth: 4, monthlyPrice: 0, includedHours: 0, overtimeDiscount: 0.35,
    discount: 0.35,
    description: "4 cleans/month • members get our best per-clean rates • Premium",
    features: ["4 cleans per month", "VIP scheduling", "Free add-ons", "Dedicated team"],
  },
} as const;

export type MembershipPlan = keyof typeof MEMBERSHIP_PLANS;

// Membership per-clean prices kept where they were — they are NOT touched
// by the new acquisition-discount logic.
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

// ─── Discount rules (the only three discounts in the system) ─────────────
export const SERVICE_DISCOUNT_RATES: Record<ServiceType, number> = {
  standard:  0.15, // 15% off standard clean (alone)
  deep:      0.25, // 25% off deep clean (alone)
  combo:     0,    // combo's "discount" is half-off on the standard portion only,
                   // applied separately in computeServicePrice() — NOT as a flat
                   // percentage on the bundle subtotal.
  moveInOut: 0,    // No additional discount on Move-In/Out.
};

// ─── Deposit ─────────────────────────────────────────────────────────────
export const DEPOSIT_PERCENT = 0.5;

// ─── Helpers ─────────────────────────────────────────────────────────────

export function getHomeSize(homeSizeId: string): HomeSizeRange | undefined {
  return HOME_SIZE_RANGES.find((h) => h.id === homeSizeId);
}

export function getZonePrice(basePrice: number, zone: ZoneId = "B"): number {
  return Math.round(basePrice * SERVICE_ZONES[zone].modifier);
}

/** Pre-discount list price for a service tier (used for "list price" badges). */
export function getServiceListPrice(
  homeSizeId: string,
  serviceType: ServiceType | string,
  zone: ZoneId = "B",
): number {
  const home = getHomeSize(homeSizeId);
  if (!home || home.standardPrice === 0) return 0;
  const tier = SERVICE_TIER_PRICING[serviceType as ServiceType];
  if (!tier) return 0;
  return getZonePrice(home.standardPrice * tier.multiplier, zone);
}

/**
 * Final per-service price after applying the new discount rules — NOT
 * including add-ons, membership extras, or any wallet credit.
 *
 * For members (`membershipPlan != 'none'`) and Move-In/Out, returns the
 * un-discounted list price.
 */
export function getServiceFinalPrice(
  homeSizeId: string,
  serviceType: ServiceType | string,
  zone: ZoneId = "B",
  membershipPlan: MembershipPlan | string = "none",
): number {
  const list = getServiceListPrice(homeSizeId, serviceType, zone);
  if (list === 0) return 0;
  if (membershipPlan !== "none") return list; // membership has its own rail
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
      // 50% off the standard portion only. Deep stays at full list.
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

export function getEstimatedHours(homeSizeId: string): number {
  const homeSize = getHomeSize(homeSizeId);
  return homeSize?.baseHours || 4;
}

// ─── Full calculation (service + add-ons + credit + deposit) ─────────────

export interface PricingCalculation {
  basePrice: number;       // standard-clean list (Zone-adjusted)
  serviceListPrice: number; // tier list price (Zone-adjusted, pre-discount)
  serviceFinalPrice: number; // tier price AFTER the new discount rules
  serviceDiscount: number;   // serviceListPrice - serviceFinalPrice (>= 0)
  addOnsTotal: number;
  subtotal: number;          // pre-discount subtotal (serviceList + add-ons)
  total: number;             // final billable total
  creditCoverage: number;    // member free-credit coverage
  deposit: number;           // 50% of total (0 if useCredit)
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

  // Add-ons. Move-In/Out already includes fridge + oven, so those two are
  // free there; every other selected add-on is still chargeable.
  let addOnsTotal = 0;
  if (serviceType === "moveInOut") {
    addOnsTotal = addOns
      .filter((a) => a !== "fridge" && a !== "oven")
      .reduce((sum, a) => sum + (ADD_ONS[a as AddOnId]?.price || 0), 0);
  } else {
    addOnsTotal = addOns.reduce((sum, a) => sum + (ADD_ONS[a as AddOnId]?.price || 0), 0);
  }

  const subtotal = serviceListPrice + addOnsTotal;
  const creditCoverage = useCredit ? Math.min(basePrice, 150) : 0;
  const total = Math.max(0, serviceFinalPrice + addOnsTotal - creditCoverage);

  const deposit = useCredit ? 0 : Math.round(total * DEPOSIT_PERCENT * 100) / 100;
  const balanceDue = Math.max(0, total - deposit);

  return {
    basePrice,
    serviceListPrice,
    serviceFinalPrice,
    serviceDiscount,
    addOnsTotal,
    subtotal,
    total,
    creditCoverage,
    deposit,
    balanceDue,
    hours: home.baseHours,
  };
}
