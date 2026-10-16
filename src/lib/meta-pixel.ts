/**
 * Meta Pixel helper functions for funnel tracking.
 * Each function safely no-ops if fbq is not loaded (e.g. ad blockers).
 */

function advertisingAllowed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem("novara.cookie.choice.v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { advertising?: boolean };
    return parsed.advertising === true;
  } catch {
    return false;
  }
}

function safeParams(params?: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  if (typeof params?.value === "number" && Number.isFinite(params.value)) safe.value = params.value;
  safe.currency = "USD";
  return safe;
}

const callFbq = (event: string, params?: Record<string, unknown>, eventId?: string) => {
  if (!advertisingAllowed()) return;
  if (typeof window === "undefined" || !window.fbq) return;
  const fbq = window.fbq as (...args: unknown[]) => void;
  const payload = safeParams(params);
  if (eventId) fbq("track", event, payload, { eventID: eventId });
  else fbq("track", event, payload);
};

/** Fires when a user views pricing / selects a service (Offer page). */
export function trackViewContent(value: number, _contentName: string) {
  callFbq("booking_started", { value, currency: "USD" });
}

/** Fires when the user reaches the checkout / payment page. */
export function trackInitiateCheckout(value: number) {
  callFbq("booking_started", { value, currency: "USD" });
}

/** Fires when a user submits a valid ZIP code (early funnel signal). */
export function trackLead(_zipCode: string) {
  callFbq("booking_started");
}

/** Fires when the booking is confirmed (Success page). */
export function trackPurchase(
  value: number,
  serviceType: string,
  frequency: string,
  zoneId?: string,
  eventId?: string,
) {
  void serviceType;
  void frequency;
  void zoneId;
  callFbq("booking_completed", { value, currency: "USD" }, eventId);
}
