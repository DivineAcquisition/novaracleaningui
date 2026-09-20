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
  if (isPastServiceDate(data.serviceDate)) return;
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

export const CHECKOUT_TZ = "America/New_York";

/** Calendar date in America/New_York as YYYY-MM-DD. Mirrors the edge guard. */
export function etYmd(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHECKOUT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "0";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isPastServiceDate(
  serviceDate: string | null | undefined,
  now = new Date(),
): boolean {
  const ymd = String(serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  return ymd < etYmd(now);
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
