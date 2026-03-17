/**
 * Form validation utilities with real-time error messages
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateEmail = (email: string): ValidationResult => {
  if (!email) {
    return { isValid: false, error: "Email is required" };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: "Please enter a valid email address" };
  }
  
  return { isValid: true };
};

export const validateName = (name: string, fieldName: string = "Name"): ValidationResult => {
  if (!name) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  if (name.trim().length < 2) {
    return { isValid: false, error: `${fieldName} must be at least 2 characters` };
  }
  
  if (name.length > 50) {
    return { isValid: false, error: `${fieldName} must be less than 50 characters` };
  }
  
  return { isValid: true };
};

export const validatePhone = (phone: string): ValidationResult => {
  if (!phone) {
    return { isValid: false, error: "Phone number is required" };
  }
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // Strip leading 1 for US country code
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.substring(1);
  }
  
  if (digits.length !== 10) {
    return { isValid: false, error: "Phone number must be 10 digits (e.g. 555-123-4567)" };
  }
  
  return { isValid: true };
};

export const validateRequired = (value: any, fieldName: string): ValidationResult => {
  if (!value || (typeof value === 'string' && !value.trim())) {
    return { isValid: false, error: `${fieldName} is required` };
  }
  
  return { isValid: true };
};

export const validateZipCode = (zipCode: string): ValidationResult => {
  if (!zipCode) {
    return { isValid: false, error: "ZIP code is required" };
  }
  
  if (!/^\d{5}$/.test(zipCode)) {
    return { isValid: false, error: "ZIP code must be 5 digits" };
  }
  
  return { isValid: true };
};

export const validateAddress = (address: string): ValidationResult => {
  if (!address) {
    return { isValid: false, error: "Street address is required" };
  }
  
  if (address.trim().length < 5) {
    return { isValid: false, error: "Please enter a complete street address" };
  }
  
  if (address.length > 200) {
    return { isValid: false, error: "Address must be less than 200 characters" };
  }
  
  // Check for basic street address components (number + street name)
  const hasNumber = /\d+/.test(address);
  if (!hasNumber) {
    return { isValid: false, error: "Address must include a street number" };
  }
  
  return { isValid: true };
};

export const validateCity = (city: string): ValidationResult => {
  if (!city) {
    return { isValid: false, error: "City is required" };
  }
  
  if (city.trim().length < 2) {
    return { isValid: false, error: "Please enter a valid city name" };
  }
  
  if (city.length > 100) {
    return { isValid: false, error: "City name must be less than 100 characters" };
  }
  
  return { isValid: true };
};

export const validateState = (state: string): ValidationResult => {
  if (!state) {
    return { isValid: false, error: "State is required" };
  }
  
  // US state abbreviation (2 letters)
  if (!/^[A-Z]{2}$/.test(state.toUpperCase())) {
    return { isValid: false, error: "Please enter a valid 2-letter state code" };
  }
  
  return { isValid: true };
};

export interface CompleteAddress {
  address: string;
  city: string;
  state: string;
  zipCode: string;
}

export const validateCompleteAddress = (addressData: CompleteAddress): ValidationResult => {
  const addressCheck = validateAddress(addressData.address);
  if (!addressCheck.isValid) return addressCheck;
  
  const cityCheck = validateCity(addressData.city);
  if (!cityCheck.isValid) return cityCheck;
  
  const stateCheck = validateState(addressData.state);
  if (!stateCheck.isValid) return stateCheck;
  
  const zipCheck = validateZipCode(addressData.zipCode);
  if (!zipCheck.isValid) return zipCheck;
  
  return { isValid: true };
};
