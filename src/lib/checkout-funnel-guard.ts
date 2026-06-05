// Snapshot + restore for the booking checkout step so idle time,
// browser back, or accidental context loss does not drop the customer's
// selected service / schedule before payment.

const SNAPSHOT_KEY = "novara_checkout_snapshot";

export type CheckoutSnapshot = {
  zipCode?: string;
  city?: string;
  state?: string;
  homeSizeId?: string;
  serviceType?: string;
  serviceDate?: string;
  timeSlot?: string;
  startTime?: string;
  endTime?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  addOns?: string[];
  membershipPlan?: string;
};

export function saveCheckoutSnapshot(data: CheckoutSnapshot) {
  if (typeof window === "undefined") return;
  if (!data.serviceDate || !data.timeSlot || !data.homeSizeId || !data.serviceType) return;
  try {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function loadCheckoutSnapshot(): CheckoutSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CheckoutSnapshot;
  } catch {
    return null;
  }
}

export function clearCheckoutSnapshot() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}

export function hasCheckoutPrerequisites(data: {
  homeSizeId?: string;
  serviceType?: string;
  serviceDate?: string;
  timeSlot?: string;
  email?: string;
}) {
  return !!(
    data.homeSizeId &&
    data.serviceType &&
    data.serviceDate &&
    data.timeSlot &&
    data.email?.trim()
  );
}
