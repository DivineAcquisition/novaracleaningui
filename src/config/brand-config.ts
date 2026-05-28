/**
 * NovaraCleaning Brand & Pricing Configuration
 * 
 * This standalone file contains all company branding, colors, and pricing data.
 * Copy this entire file to another project and import as needed.
 */

// =============================================================================
// COMPANY INFORMATION
// =============================================================================

export const COMPANY = {
  name: "NovaraCleaning",
  tagline: "Professional House Cleaning Services",
  phone: "+1 (844) 735-2070",
  email: "hello@novaracleaning.com",
  website: "https://novaracleaning.com",
  logoUrl: "/novara-logo.png",
  address: {
    city: "Dallas",
    state: "TX",
    serviceAreas: ["Dallas", "Fort Worth", "Plano", "Frisco", "McKinney"],
  },
  social: {
    instagram: "@novaracleaning",
    facebook: "novaracleaning",
  },
} as const;

// =============================================================================
// BRAND COLORS (HSL Format for Tailwind)
// =============================================================================

export const COLORS = {
  // Primary brand colors
  primary: "142 76% 36%",           // Green - main brand color
  primaryHover: "142 76% 30%",      // Darker green for hover states
  primaryForeground: "0 0% 100%",   // White text on primary
  
  // Accent colors
  accent: "142 60% 95%",            // Light green tint
  accentForeground: "142 76% 25%",  // Dark green text
  
  // Status colors
  success: "142 76% 36%",           // Same as primary
  warning: "38 92% 50%",            // Orange/amber
  destructive: "0 84% 60%",         // Red for errors
  
  // Neutral colors
  background: "0 0% 100%",          // White
  foreground: "222 47% 11%",        // Dark text
  muted: "210 40% 96%",             // Light gray
  mutedForeground: "215 16% 47%",   // Gray text
  border: "214 32% 91%",            // Light border
  
  // Card colors
  card: "0 0% 100%",
  cardForeground: "222 47% 11%",
} as const;

// =============================================================================
// GRADIENTS & EFFECTS
// =============================================================================

export const EFFECTS = {
  gradients: {
    primary: "linear-gradient(135deg, hsl(142, 76%, 36%), hsl(142, 70%, 28%))",
    hero: "linear-gradient(180deg, hsl(142, 60%, 95%) 0%, hsl(0, 0%, 100%) 100%)",
    card: "linear-gradient(135deg, hsl(0, 0%, 100%) 0%, hsl(142, 30%, 98%) 100%)",
  },
  shadows: {
    card: "0 4px 20px -4px hsla(142, 76%, 36%, 0.15)",
    cardHover: "0 8px 30px -4px hsla(142, 76%, 36%, 0.25)",
    glow: "0 0 40px hsla(142, 76%, 36%, 0.3)",
  },
} as const;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const TYPOGRAPHY = {
  fontFamily: {
    primary: "'Inter', system-ui, sans-serif",
    display: "'Plus Jakarta Sans', 'Inter', sans-serif",
  },
  borderRadius: "0.75rem",
} as const;

// =============================================================================
// PRICING CONSTANTS
// =============================================================================

export const PRICING = {
  hourlyRate: 75,                  // $ per hour
  depositPercent: 0.5,             // 50% deposit on total when "Pay 50% Deposit" is chosen
  depositAmount: 0,                // Deprecated — kept for backwards compatibility
  newCustomerDiscountPercent: 0.5, // 50% off the entire booking for new customers
  newCustomerDiscount: 0,          // Deprecated — discount is now percent-based
  overtimeRate: 75,                // $ per additional hour
  firstCleanSurcharge: 0,          // No longer applied
} as const;

// =============================================================================
// HOME SIZE PRICING (Standard Clean)
// =============================================================================

export interface HomeSizeConfig {
  id: string;
  label: string;
  sqftRange: string;
  bedrooms: string;
  baseHours: number;
  basePrice: number;
}

export const HOME_SIZES: HomeSizeConfig[] = [
  { id: "0_999",      label: "XS",   sqftRange: "0-999",       bedrooms: "Studio-1",  baseHours: 2,    basePrice: 270 },
  { id: "1000_1500",  label: "S",    sqftRange: "1,000-1,500", bedrooms: "1-2",       baseHours: 2.5,  basePrice: 342 },
  { id: "1501_2000",  label: "M",    sqftRange: "1,501-2,000", bedrooms: "2-3",       baseHours: 3,    basePrice: 432 },
  { id: "2001_2500",  label: "L",    sqftRange: "2,001-2,500", bedrooms: "3-4",       baseHours: 3.5,  basePrice: 504 },
  { id: "2501_3000",  label: "XL",   sqftRange: "2,501-3,000", bedrooms: "4-5",       baseHours: 4,    basePrice: 612 },
  { id: "3001_3500",  label: "2XL",  sqftRange: "3,001-3,500", bedrooms: "5+",        baseHours: 4.5,  basePrice: 684 },
  { id: "3501_4000",  label: "3XL",  sqftRange: "3,501-4,000", bedrooms: "5+",        baseHours: 5,    basePrice: 792 },
  { id: "4001_4500",  label: "4XL",  sqftRange: "4,001-4,500", bedrooms: "6+",        baseHours: 5.5,  basePrice: 882 },
  { id: "4501_5000",  label: "5XL",  sqftRange: "4,501-5,000", bedrooms: "6+",        baseHours: 6,    basePrice: 972 },
  { id: "5000_plus",  label: "6XL",  sqftRange: "5,001+",      bedrooms: "7+",        baseHours: 0,    basePrice: 0 },
];

// =============================================================================
// SERVICE TIERS
// =============================================================================

export interface ServiceTierConfig {
  id: string;
  name: string;
  description: string;
  multiplier: number;
  additionalCost: number; // Kept for backward compat; use multiplier for calculations
  features: string[];
}

export const SERVICE_TIERS: ServiceTierConfig[] = [
  {
    id: "standard",
    name: "Standard Clean",
    description: "Regular maintenance cleaning",
    multiplier: 1.0,
    additionalCost: 0,
    features: [
      "Dusting all surfaces",
      "Vacuuming & mopping floors",
      "Kitchen & bathroom cleaning",
      "Trash removal",
      "Making beds",
    ],
  },
  {
    id: "deep",
    name: "Deep Clean",
    description: "Thorough top-to-bottom cleaning",
    multiplier: 1.5,
    additionalCost: 0,
    features: [
      "Everything in Standard Clean",
      "Inside cabinet cleaning",
      "Baseboard cleaning",
      "Light fixture cleaning",
      "Detailed scrubbing",
    ],
  },
  {
    id: "move",
    name: "Move-In/Out Clean",
    description: "Complete clean for moving",
    multiplier: 2.0,
    additionalCost: 0,
    features: [
      "Everything in Deep Clean",
      "Inside all cabinets & drawers",
      "Inside refrigerator",
      "Inside oven",
      "Garage sweep",
    ],
  },
];

// =============================================================================
// ADD-ON SERVICES
// =============================================================================

export interface AddOnConfig {
  id: string;
  name: string;
  price: number;
  description?: string;
}

export const ADD_ONS: AddOnConfig[] = [
  { id: "fridge",           name: "Inside Fridge",        price: 30, description: "Deep clean inside refrigerator" },
  { id: "oven",             name: "Inside Oven",          price: 30, description: "Deep clean inside oven" },
  { id: "interior_windows", name: "Interior Windows",     price: 40, description: "Clean all interior windows" },
  { id: "laundry",          name: "Laundry",              price: 25, description: "Wash, dry, fold one load" },
  { id: "garage",           name: "Garage Sweep",         price: 40, description: "Sweep and tidy garage" },
  { id: "organization",     name: "Light Organization",   price: 50, description: "Organize closets/pantry" },
];

// =============================================================================
// MEMBERSHIP PLANS
// =============================================================================

export interface MembershipPlanConfig {
  id: string;
  name: string;
  monthlyPrice: number;
  cleansPerMonth: number;
  includedHours: number;
  overtimeDiscount: number;  // Percentage (e.g., 15 = 15%)
  features: string[];
  popular?: boolean;
}

export const MEMBERSHIP_PLANS: MembershipPlanConfig[] = [
  {
    id: "none",
    name: "Pay Per Clean",
    monthlyPrice: 0,
    cleansPerMonth: 0,
    includedHours: 0,
    overtimeDiscount: 0,
    features: [
      "No monthly commitment",
      "Standard pricing",
      "Book anytime",
    ],
  },
  {
    id: "monthly",
    name: "Glow Monthly",
    monthlyPrice: 129,
    cleansPerMonth: 1,
    includedHours: 2,
    overtimeDiscount: 15,
    features: [
      "1 clean per month",
      "Up to 18% off one-time price",
      "Priority scheduling",
      "Cancel anytime",
    ],
  },
  {
    id: "biweekly",
    name: "Glow Bi-Weekly",
    monthlyPrice: 199,
    cleansPerMonth: 2,
    includedHours: 3,
    overtimeDiscount: 25,
    popular: true,
    features: [
      "2 cleans per month",
      "Up to 34% off per clean",
      "Same trusted team",
      "Priority scheduling",
      "Free add-ons included",
    ],
  },
  {
    id: "weekly",
    name: "Glow Weekly",
    monthlyPrice: 349,
    cleansPerMonth: 4,
    includedHours: 3,
    overtimeDiscount: 35,
    features: [
      "4 cleans per month",
      "Up to 42% off per clean",
      "Dedicated cleaning team",
      "VIP scheduling",
      "Free add-ons included",
      "Best for families & pets",
    ],
  },
];

// =============================================================================
// PROMOTIONS
// =============================================================================

export interface PromoConfig {
  code: string;
  description: string;
  discountType: "amount" | "percent";
  discountValue: number;
  expiresAt?: string;
  appliesTo?: string[];
}

// =============================================================================
// $99 FIRST CLEAN PROMO (Toggle on/off here)
// =============================================================================

// The old $99 standard-clean intro promo has been retired — Standard Cleaning is
// no longer offered to customers (Membership + Deep Clean only). The new-customer
// 50% off promo replaces it across the funnel.
export const FIRST_CLEAN_PROMO = {
  enabled: false,
  price: 0,
  label: "",
  description: "",
  serviceTypeRestriction: "standard" as const,
} as const;

export const ACTIVE_PROMOS: PromoConfig[] = [
  {
    code: "NEW50",
    description: "50% off your first booking — new customers",
    discountType: "percent",
    discountValue: 50,
    appliesTo: ["deep"],
  },
];

// =============================================================================
// CLEANER OPERATIONS
// =============================================================================

export const CLEANER_CONFIG = {
  // Revenue share by tier (percent of customer-paid revenue).
  payPercentage: {
    foundation: 35,
    proven: 40,
    elite: 45,
  },
  defaultPayPercentage: 35, // Foundation default for unassigned jobs
  teamSize: {
    standard: 2,                // 2 cleaners for homes ≤2500 sqft
    large: 3,                   // 3 cleaners for homes >2500 sqft
  },
  largeHomeThreshold: "2501_3000", // Home size ID where 3 cleaners start
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get home size config by ID
 */
export function getHomeSize(id: string): HomeSizeConfig | undefined {
  return HOME_SIZES.find(size => size.id === id);
}

/**
 * Get service tier config by ID
 */
export function getServiceTier(id: string): ServiceTierConfig | undefined {
  return SERVICE_TIERS.find(tier => tier.id === id);
}

/**
 * Get membership plan config by ID
 */
export function getMembershipPlan(id: string): MembershipPlanConfig | undefined {
  return MEMBERSHIP_PLANS.find(plan => plan.id === id);
}

/**
 * Calculate base price for a booking
 */
export function calculateBasePrice(
  homeSizeId: string,
  serviceTierId: string = "standard"
): number {
  const homeSize = getHomeSize(homeSizeId);
  const serviceTier = getServiceTier(serviceTierId);
  
  if (!homeSize) return 0;
  
  return Math.round(homeSize.basePrice * (serviceTier?.multiplier || 1));
}

/**
 * Calculate total with add-ons
 */
export function calculateTotal(
  homeSizeId: string,
  serviceTierId: string = "standard",
  addOnIds: string[] = [],
  applyNewCustomerDiscount: boolean = false
): number {
  let total = calculateBasePrice(homeSizeId, serviceTierId);

  // Add add-ons
  addOnIds.forEach(id => {
    const addOn = ADD_ONS.find(a => a.id === id);
    if (addOn) total += addOn.price;
  });

  // 50% off for new customers (replaces the legacy flat-dollar discount).
  if (applyNewCustomerDiscount) {
    total = total * (1 - PRICING.newCustomerDiscountPercent);
  }

  return Math.max(0, Math.round(total * 100) / 100);
}

/**
 * Get team size for home size
 */
export function getTeamSize(homeSizeId: string): number {
  const largeHomeSizes = ['2501_3000', '3001_3500', '3501_4000', '4001_4500', '4501_5000', '5000_plus'];
  return largeHomeSizes.includes(homeSizeId) 
    ? CLEANER_CONFIG.teamSize.large 
    : CLEANER_CONFIG.teamSize.standard;
}

/**
 * Calculate the total cleaner pool for a job under the revenue-share
 * model. Returns the dollar amount the company owes the team in total
 * (split evenly per cleaner).
 *
 *   pool = revenue × payPercentage / 100
 *
 * Pass `payPercentage` explicitly when you know the assigned team's
 * highest tier. Defaults to Foundation (40%) which matches what
 * create-payment-intent stamps at booking time before any cleaner is
 * assigned.
 */
export function calculateCleanerPayout(
  homeSizeId: string,
  serviceTierId: string = "standard",
  payPercentage: number = CLEANER_CONFIG.defaultPayPercentage,
  addOnIds: string[] = [],
): number {
  const revenue = calculateTotal(homeSizeId, serviceTierId, addOnIds, false);
  const pct = Math.max(0, Math.min(100, payPercentage));
  return Math.round(revenue * pct) / 100;
}
