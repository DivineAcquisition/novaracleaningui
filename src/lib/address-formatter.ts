/**
 * Address formatting utilities for consistent address standardization
 */

export interface FormattedAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

/**
 * Standardize street address format
 * - Capitalize first letter of each word
 * - Standardize common abbreviations (St, Ave, Blvd, etc.)
 * - Remove extra spaces
 */
export function formatStreetAddress(street: string): string {
  if (!street) return "";

  // Remove extra spaces and trim
  let formatted = street.trim().replace(/\s+/g, " ");

  // Capitalize first letter of each word
  formatted = formatted
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  // Standardize common abbreviations
  const abbreviations: Record<string, string> = {
    "Street": "St",
    "Avenue": "Ave",
    "Boulevard": "Blvd",
    "Drive": "Dr",
    "Road": "Rd",
    "Lane": "Ln",
    "Court": "Ct",
    "Circle": "Cir",
    "Place": "Pl",
    "Terrace": "Ter",
    "Parkway": "Pkwy",
    "Highway": "Hwy",
  };

  Object.entries(abbreviations).forEach(([full, abbr]) => {
    const regex = new RegExp(`\\b${full}\\b`, "gi");
    formatted = formatted.replace(regex, abbr);
  });

  return formatted;
}

/**
 * Format city name - capitalize first letter of each word
 */
export function formatCity(city: string): string {
  if (!city) return "";
  
  return city
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Format state - ensure uppercase 2-letter code
 */
export function formatState(state: string): string {
  if (!state) return "";
  return state.trim().toUpperCase().slice(0, 2);
}

/**
 * Format ZIP code - ensure 5 digits
 */
export function formatZipCode(zip: string): string {
  if (!zip) return "";
  return zip.replace(/\D/g, "").slice(0, 5);
}

/**
 * Format complete address object
 */
export function formatAddress(address: FormattedAddress): FormattedAddress {
  return {
    street: formatStreetAddress(address.street),
    city: formatCity(address.city),
    state: formatState(address.state),
    zipCode: formatZipCode(address.zipCode),
  };
}

/**
 * Get display string for address
 */
export function getAddressDisplayString(address: FormattedAddress): string {
  return `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`;
}
