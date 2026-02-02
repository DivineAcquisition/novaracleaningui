/**
 * Profit Calculator Utility
 * Calculates profit margins and validates discounts to ensure minimum profitability
 */

import { getEstimatedHours } from "./pricing-system";

// Constants
const DEFAULT_CLEANER_HOURLY_RATE = 18; // $18/hour base rate for all cleaners
const PLATFORM_FEE_PERCENT = 0.03; // 3% payment processing
const MINIMUM_PROFIT_MARGIN = 0.20; // 20% minimum

export interface ProfitCalculation {
  revenue: number;
  cleanerCost: number;
  platformFee: number;
  profit: number;
  profitMargin: number; // as decimal (0.40 = 40%)
}

/**
 * Calculate profit for a booking
 */
export function calculateProfit(
  totalRevenue: number,
  homeSizeId: string,
  cleanerHourlyRate: number = DEFAULT_CLEANER_HOURLY_RATE
): ProfitCalculation {
  const hours = getEstimatedHours(homeSizeId);
  const cleanerCost = hours * cleanerHourlyRate;
  const platformFee = totalRevenue * PLATFORM_FEE_PERCENT;
  const profit = totalRevenue - cleanerCost - platformFee;
  const profitMargin = profit / totalRevenue;

  return {
    revenue: totalRevenue,
    cleanerCost,
    platformFee,
    profit,
    profitMargin,
  };
}

/**
 * Validate if a discount maintains minimum profit margin
 */
export function validateDiscount(
  originalPrice: number,
  discountPercent: number,
  homeSizeId: string,
  minMargin: number = MINIMUM_PROFIT_MARGIN
): { valid: boolean; finalPrice: number; profitMargin: number } {
  const finalPrice = originalPrice * (1 - discountPercent / 100);
  const profitCalc = calculateProfit(finalPrice, homeSizeId);
  
  return {
    valid: profitCalc.profitMargin >= minMargin,
    finalPrice,
    profitMargin: profitCalc.profitMargin,
  };
}

/**
 * Get minimum price to maintain target margin
 */
export function getMinimumPrice(
  homeSizeId: string,
  targetMargin: number = MINIMUM_PROFIT_MARGIN
): number {
  const hours = getEstimatedHours(homeSizeId);
  const cleanerCost = hours * DEFAULT_CLEANER_HOURLY_RATE;
  
  // Formula: price * (1 - platformFee) - cleanerCost = price * targetMargin
  // Solving for price: price = cleanerCost / ((1 - platformFee) - targetMargin)
  const minPrice = cleanerCost / ((1 - PLATFORM_FEE_PERCENT) - targetMargin);
  
  return Math.ceil(minPrice);
}

/**
 * Get maximum discount percentage that maintains minimum margin
 */
export function getMaxDiscount(
  originalPrice: number,
  homeSizeId: string,
  minMargin: number = MINIMUM_PROFIT_MARGIN
): number {
  const minPrice = getMinimumPrice(homeSizeId, minMargin);
  const maxDiscount = ((originalPrice - minPrice) / originalPrice) * 100;
  
  return Math.max(0, Math.floor(maxDiscount));
}
