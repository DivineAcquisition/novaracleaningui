/**
 * Format phone number as (XXX) XXX-XXXX
 */
export const formatPhoneNumber = (value: string): string => {
  // Remove all non-digits
  const phoneNumber = value.replace(/\D/g, '');
  
  // Limit to 10 digits
  const trimmed = phoneNumber.slice(0, 10);
  
  // Format as (XXX) XXX-XXXX
  if (trimmed.length <= 3) {
    return trimmed;
  } else if (trimmed.length <= 6) {
    return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3)}`;
  } else {
    return `(${trimmed.slice(0, 3)}) ${trimmed.slice(3, 6)}-${trimmed.slice(6)}`;
  }
};

/**
 * Get raw phone number (digits only)
 */
export const getRawPhoneNumber = (formatted: string): string => {
  return formatted.replace(/\D/g, '');
};

/**
 * Validate phone number (must be exactly 10 digits)
 */
export const isValidPhoneNumber = (value: string): boolean => {
  const raw = getRawPhoneNumber(value);
  return raw.length === 10;
};

/**
 * Format ZIP code (5 digits only)
 */
export const formatZipCode = (value: string): string => {
  return value.replace(/\D/g, '').slice(0, 5);
};

/**
 * Validate ZIP code (must be exactly 5 digits)
 */
export const isValidZipCode = (value: string): boolean => {
  return /^\d{5}$/.test(value);
};
