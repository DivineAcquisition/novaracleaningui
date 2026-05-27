/**
 * Profit Calculator Utility
 *
 * Updated for the revenue-share contractor compensation model.
 *
 * Cleaner cost is no longer hours × hourly_rate. It's now a flat
 * percentage of customer-paid revenue, tiered by cleaner tenure +
 * performance:
 *   Foundation : 40%
 *   Proven     : 45%
 *   Elite      : 50%
 *
 * Default tier for company-wide profit math (e.g. promo discount
 * validation) is Foundation, which is the worst case for company
 * profit (highest cleaner share is Elite at 50% — but the company's
 * worst profit case is when cost is highest, and 50% > 40%, so we
 * actually use Elite for the most conservative discount validation).
 *
 * Stripe processing is still ~3% of revenue.
 */

// Most conservative tier for company-side discount validation:
// assume Elite (50%) when checking whether a discount still leaves
// margin. That way we never approve a promo that breaks even on
// Foundation but loses money once the cleaner hits Elite.
const WORST_CASE_PAY_PERCENT = 0.50;
const PLATFORM_FEE_PERCENT = 0.03;
const MINIMUM_PROFIT_MARGIN = 0.20;

export interface ProfitCalculation {
  revenue: number;
  cleanerCost: number;
  platformFee: number;
  profit: number;
  profitMargin: number; // as decimal (0.40 = 40%)
}

/**
 * Calculate profit for a booking under the revenue-share model.
 *
 * cleanerHourlyRate is accepted (and ignored) for back-compat with
 * any caller that still passes a numeric override. New callers should
 * pass the cleaner's pay_percentage as a decimal in
 * `payPercentageOverride` if they want to model a specific tier.
 */
export function calculateProfit(
  totalRevenue: number,
  _homeSizeId: string,
  payPercentageOverride: number = WORST_CASE_PAY_PERCENT,
): ProfitCalculation {
  const cleanerCost = totalRevenue * payPercentageOverride;
  const platformFee = totalRevenue * PLATFORM_FEE_PERCENT;
  const profit = totalRevenue - cleanerCost - platformFee;
  const profitMargin = totalRevenue > 0 ? profit / totalRevenue : 0;

  return {
    revenue: totalRevenue,
    cleanerCost,
    platformFee,
    profit,
    profitMargin,
  };
}

/**
 * Validate if a discount maintains minimum profit margin.
 */
export function validateDiscount(
  originalPrice: number,
  discountPercent: number,
  homeSizeId: string,
  minMargin: number = MINIMUM_PROFIT_MARGIN,
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
 * Minimum price to maintain target margin under revenue-share.
 *
 * margin = 1 - PAY_PCT - PLATFORM_FEE
 * If the constants already satisfy `1 - PAY_PCT - PLATFORM_FEE >= targetMargin`
 * the minimum price is essentially "any positive price" — return 0
 * because there's no per-job fixed cost. This used to depend on the
 * fixed hourly cleaner cost; under the percentage model price scales
 * with cost, so margin is effectively constant for any given tier.
 */
export function getMinimumPrice(
  _homeSizeId: string,
  targetMargin: number = MINIMUM_PROFIT_MARGIN,
): number {
  const baseMargin = 1 - WORST_CASE_PAY_PERCENT - PLATFORM_FEE_PERCENT;
  if (baseMargin >= targetMargin) return 0;
  // Margin is structurally too low for the requested target — there's
  // no price that fixes it under revenue share. Return Infinity so the
  // caller treats the discount as invalid.
  return Number.POSITIVE_INFINITY;
}

/**
 * Maximum discount percentage that maintains minimum margin.
 *
 * Under revenue share margin doesn't depend on absolute price — only
 * on PAY_PCT and PLATFORM_FEE. So either the structure allows full
 * 100% discounts (impossible with paid platform fees) or no discount.
 */
export function getMaxDiscount(
  _originalPrice: number,
  _homeSizeId: string,
  minMargin: number = MINIMUM_PROFIT_MARGIN,
): number {
  const baseMargin = 1 - WORST_CASE_PAY_PERCENT - PLATFORM_FEE_PERCENT;
  return baseMargin >= minMargin ? 100 : 0;
}
