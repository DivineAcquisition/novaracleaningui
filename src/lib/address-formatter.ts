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

// ─── Defensive parser ────────────────────────────────────────────────────────
// When the user types a full address into the street field — e.g.
//   "123 Main St, Frederick, MD 21703"
//   "123 Main St Frederick MD 21703"
//   "123 Main St, Frederick MD"
// we want to lift City / State / ZIP out of it so each lands in its own
// column instead of cramming the whole thing into Street. The parser is
// pure-string, never throws, and always returns a sensible street (the
// part before the first split, falling back to the original).
const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
]);

export interface ParsedAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

/**
 * Best-effort parse of a freeform US address string. Pulls a 5-digit
 * ZIP off the tail first, then a 2-letter state code, then everything
 * else after the first comma becomes the city; everything before the
 * city becomes the street. Always returns at minimum the original
 * string as `street`.
 */
export function parseAddressString(input: string): ParsedAddress {
  const empty: ParsedAddress = { street: "", city: "", state: "", zipCode: "" };
  if (!input || typeof input !== "string") return empty;

  let work = input.trim().replace(/\s+/g, " ");
  if (!work) return empty;

  let zipCode = "";
  let state = "";
  let city = "";
  let street = work;

  const zipMatch = work.match(/\b(\d{5})(?:-\d{4})?\b\s*$/);
  if (zipMatch) {
    zipCode = zipMatch[1];
    work = work.slice(0, zipMatch.index).trim().replace(/,\s*$/, "");
  }

  const stateMatch = work.match(/,?\s*([A-Z]{2})\s*$/i);
  if (stateMatch && US_STATE_CODES.has(stateMatch[1].toUpperCase())) {
    state = stateMatch[1].toUpperCase();
    work = work.slice(0, stateMatch.index).trim().replace(/,\s*$/, "");
  }

  const lastComma = work.lastIndexOf(",");
  if (lastComma >= 0) {
    city = work.slice(lastComma + 1).trim();
    street = work.slice(0, lastComma).trim();
  } else if (state || zipCode) {
    const parts = work.split(/\s+/);
    if (parts.length > 1) {
      city = parts[parts.length - 1];
      street = parts.slice(0, -1).join(" ").trim();
    } else {
      street = work;
    }
  } else {
    street = work;
  }

  if (!street) street = input.trim();

  return {
    street: formatStreetAddress(street),
    city: formatCity(city),
    state: formatState(state),
    zipCode: formatZipCode(zipCode),
  };
}

/**
 * Merge a parsed candidate into existing values: existing wins when
 * non-empty, so we never overwrite data the user (or earlier step)
 * already provided.
 */
export function mergeAddressParts(
  existing: Partial<ParsedAddress>,
  candidate: Partial<ParsedAddress>,
): ParsedAddress {
  return {
    street: existing.street?.trim() || candidate.street || "",
    city: existing.city?.trim() || candidate.city || "",
    state: existing.state?.trim() || candidate.state || "",
    zipCode: existing.zipCode?.trim() || candidate.zipCode || "",
  };
}

/** Canonical 51-entry list (50 states + DC) for State dropdowns. */
export const US_STATES: Array<{ value: string; label: string }> = [
  { value: "AL", label: "Alabama" },          { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },          { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },       { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },      { value: "DE", label: "Delaware" },
  { value: "DC", label: "District of Columbia" },
  { value: "FL", label: "Florida" },          { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },           { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },         { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },             { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },         { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },            { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },    { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },        { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },         { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },         { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },    { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },       { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },   { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },             { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },           { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },     { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },     { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },            { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },          { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },       { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },        { value: "WY", label: "Wyoming" },
];
