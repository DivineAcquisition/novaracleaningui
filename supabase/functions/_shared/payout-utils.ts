/**
 * Shared utilities for calculating cleaner payouts and mapping home sizes
 */

// Map home size IDs to estimated hours
export const HOME_SIZE_HOURS: Record<string, number> = {
  "0_999": 2,
  "1000_1500": 3,
  "1501_2000": 4,
  "2001_2500": 5,
  "2501_3000": 6,
  "3001_3500": 7,
  "3501_4000": 8,
  "4001_4500": 9,
  "4501_5000": 10,
  "5000_plus": 12,
};

// Home sizes that require 3 cleaners (above 2500 sq ft)
const LARGE_HOME_SIZES = ['2501_3000', '3001_3500', '3501_4000', '4001_4500', '4501_5000', '5000_plus'];

/**
 * Get team size based on home size (3 for >2500 sqft, 2 otherwise)
 */
export function getTeamSize(homeSizeId: string): number {
  return LARGE_HOME_SIZES.includes(homeSizeId) ? 3 : 2;
}

// Map home size IDs to square footage ranges for Zapier
export const HOME_SIZE_SQFT_RANGES: Record<string, string> = {
  "0_999": "0-999",
  "1000_1500": "1000-1500",
  "1501_2000": "1501-2000",
  "2001_2500": "2001-2500",
  "2501_3000": "2501-3000",
  "3001_3500": "3001-3500",
  "3501_4000": "3501-4000",
  "4001_4500": "4001-4500",
  "4501_5000": "4501-5000",
  "5000_plus": "5001+",
};

// Default cleaner hourly rate in cents ($20/hr)
export const DEFAULT_CLEANER_HOURLY_RATE_CENTS = 2000;

/**
 * Get estimated hours for a given home size
 */
export function getEstimatedHours(homeSizeId: string): number {
  return HOME_SIZE_HOURS[homeSizeId] || 4; // Default to 4 hours if not found
}

/**
 * Get square footage range string for Zapier
 */
export function getSqftRange(homeSizeId: string): string {
  return HOME_SIZE_SQFT_RANGES[homeSizeId] || "1000-1500";
}

/**
 * Calculate cleaner payout based on hours and hourly rate
 */
export function calculateCleanerPayout(
  estimatedHours: number,
  hourlyRateCents: number = DEFAULT_CLEANER_HOURLY_RATE_CENTS
): number {
  return estimatedHours * hourlyRateCents;
}

/**
 * Calculate cleaner payout from home size and hourly rate
 */
export function calculateCleanerPayoutFromHomeSize(
  homeSizeId: string,
  hourlyRateCents: number = DEFAULT_CLEANER_HOURLY_RATE_CENTS
): number {
  const hours = getEstimatedHours(homeSizeId);
  return calculateCleanerPayout(hours, hourlyRateCents);
}
