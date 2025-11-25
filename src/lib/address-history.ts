/**
 * Address history management for faster repeat bookings
 */

import { FormattedAddress, getAddressDisplayString } from "./address-formatter";

const HISTORY_KEY = "address_history";
const MAX_HISTORY_ITEMS = 5;

export interface AddressHistoryItem extends FormattedAddress {
  id: string;
  timestamp: number;
  lat?: number;
  lng?: number;
}

/**
 * Save address to history
 */
export function saveAddressToHistory(
  address: FormattedAddress & { lat?: number; lng?: number }
): void {
  try {
    const history = getAddressHistory();
    
    // Check if address already exists (by street and zip)
    const existingIndex = history.findIndex(
      (item) =>
        item.street.toLowerCase() === address.street.toLowerCase() &&
        item.zipCode === address.zipCode
    );

    // Remove existing if found
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }

    // Add new address to beginning
    const newItem: AddressHistoryItem = {
      id: `addr_${Date.now()}`,
      ...address,
      timestamp: Date.now(),
    };

    history.unshift(newItem);

    // Keep only MAX_HISTORY_ITEMS
    const trimmedHistory = history.slice(0, MAX_HISTORY_ITEMS);

    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
  } catch (error) {
    console.error("Failed to save address to history:", error);
  }
}

/**
 * Get address history
 */
export function getAddressHistory(): AddressHistoryItem[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];

    const history = JSON.parse(stored) as AddressHistoryItem[];
    return history;
  } catch (error) {
    console.error("Failed to load address history:", error);
    return [];
  }
}

/**
 * Clear address history
 */
export function clearAddressHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (error) {
    console.error("Failed to clear address history:", error);
  }
}

/**
 * Get display string for history item
 */
export function getHistoryItemDisplay(item: AddressHistoryItem): string {
  return getAddressDisplayString(item);
}
