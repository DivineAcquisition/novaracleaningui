import { HOME_SIZES, SERVICE_TIERS, ADD_ONS } from "@/config/brand-config";

export interface QuoteCalculation {
  basePriceCents: number;
  serviceTierCost: number;
  addOnsCents: number;
  subtotalCents: number;
  discountPct: number;
  discountCents: number;
  finalPriceCents: number;
  depositCents: number;
  balanceDueCents: number;
  monthlyTotalCents: number;
  perCleanCents: number;
  homeSizeLabel: string;
  estimatedHours: number;
}

const FREQUENCY_DISCOUNTS: Record<string, number> = {
  "One-Time": 0,
  "Weekly": 0,
  "Bi-Weekly": 0,
  "Monthly": 0,
};

export function getFrequencyDiscount(frequency: string): number {
  return FREQUENCY_DISCOUNTS[frequency] ?? 0;
}

export function getFrequencyOptions() {
  return Object.entries(FREQUENCY_DISCOUNTS).map(([label, discount]) => ({
    label,
    discount,
  }));
}

export function calculateQuote(params: {
  homeSizeId: string;
  serviceType: string;
  frequency: string;
  addOnIds: string[];
  isNewCustomer?: boolean;
  customDiscountCents?: number;
}): QuoteCalculation {
  const homeSize = HOME_SIZES.find((h) => h.id === params.homeSizeId);
  const serviceTier = SERVICE_TIERS.find((t) => t.id === params.serviceType);

  if (!homeSize) {
    return {
      basePriceCents: 0, serviceTierCost: 0, addOnsCents: 0, subtotalCents: 0,
      discountPct: 0, discountCents: 0, finalPriceCents: 0, depositCents: 0,
      balanceDueCents: 0, monthlyTotalCents: 0, perCleanCents: 0,
      homeSizeLabel: "", estimatedHours: 0,
    };
  }

  const basePriceCents = homeSize.basePrice * 100;
  const serviceTierCost = Math.round(homeSize.basePrice * ((serviceTier?.multiplier || 1) - 1)) * 100;
  const addOnsCents = params.addOnIds.reduce((sum, id) => {
    const addon = ADD_ONS.find((a) => a.id === id);
    return sum + (addon ? addon.price * 100 : 0);
  }, 0);

  const subtotalCents = basePriceCents + serviceTierCost + addOnsCents;
  const discountPct = getFrequencyDiscount(params.frequency);
  const discountCents = Math.round(subtotalCents * (discountPct / 100));
  
  let finalPriceCents = subtotalCents - discountCents;
  if (params.customDiscountCents && params.customDiscountCents > 0) {
    finalPriceCents -= params.customDiscountCents;
  }
  finalPriceCents = Math.max(0, finalPriceCents);

  // 50% deposit on the final price (replaces the legacy $39 flat deposit).
  const depositCents = Math.round(finalPriceCents * 0.5);
  const balanceDueCents = Math.max(0, finalPriceCents - depositCents);

  // Monthly total for recurring
  let monthlyTotalCents = finalPriceCents;
  if (params.frequency === "Weekly") monthlyTotalCents = finalPriceCents * 4;
  else if (params.frequency === "Bi-Weekly") monthlyTotalCents = finalPriceCents * 2;

  return {
    basePriceCents,
    serviceTierCost,
    addOnsCents,
    subtotalCents,
    discountPct,
    discountCents,
    finalPriceCents,
    depositCents,
    balanceDueCents,
    monthlyTotalCents,
    perCleanCents: finalPriceCents,
    homeSizeLabel: `${homeSize.label} (${homeSize.sqftRange} sqft)`,
    estimatedHours: homeSize.baseHours,
  };
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatQuoteText(quote: QuoteCalculation, params: {
  serviceName: string;
  frequency: string;
  bedrooms?: number;
  bathrooms?: number;
  isNewCustomer: boolean;
}): string {
  const lines = [
    `🏠 NovaraCleaning Quote`,
    ``,
    `Service: ${params.serviceName}`,
    `Property: ${quote.homeSizeLabel}`,
  ];
  if (params.bedrooms) lines.push(`Bedrooms: ${params.bedrooms}`);
  if (params.bathrooms) lines.push(`Bathrooms: ${params.bathrooms}`);
  lines.push(`Frequency: ${params.frequency}`);
  lines.push(`Estimated Duration: ${quote.estimatedHours} hours`);
  lines.push(``);
  lines.push(`Base Price: ${formatCents(quote.basePriceCents)}`);
  if (quote.serviceTierCost > 0)
    lines.push(`Service Upgrade: +${formatCents(quote.serviceTierCost)}`);
  if (quote.addOnsCents > 0)
    lines.push(`Add-ons: +${formatCents(quote.addOnsCents)}`);
  if (quote.discountPct > 0)
    lines.push(`${params.frequency} Discount (${quote.discountPct}%): -${formatCents(quote.discountCents)}`);
  if (params.isNewCustomer && (quote as any).customDiscountCents > 0)
    lines.push(`Discount: -${formatCents((quote as any).customDiscountCents)}`);
  lines.push(``);
  lines.push(`✅ Per Clean: ${formatCents(quote.perCleanCents)}`);
  lines.push(`💰 Deposit Due Today: ${formatCents(quote.depositCents)}`);
  lines.push(`📋 Balance After Service: ${formatCents(quote.balanceDueCents)}`);
  if (params.frequency !== "One-Time") {
    lines.push(`📅 Monthly Total: ${formatCents(quote.monthlyTotalCents)}`);
  }
  lines.push(``);
  lines.push(`Book online: try.novaracleaning.com`);
  lines.push(`Call: (844) 735-2070`);
  return lines.join("\n");
}
