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
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length !== 10) {
    return { isValid: false, error: "Phone number must be 10 digits" };
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
