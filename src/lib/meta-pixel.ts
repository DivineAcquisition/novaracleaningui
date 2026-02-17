/**
 * Meta Pixel helper functions for funnel tracking.
 * Each function safely no-ops if fbq is not loaded (e.g. ad blockers).
 */

const callFbq = (event: string, params?: Record<string, unknown>) => {
  if (typeof window !== 'undefined' && window.fbq) {
    window.fbq('track', event, params);
  }
};

/** Fires when a user views pricing / selects a service (Offer page). */
export function trackViewContent(value: number, contentName: string) {
  callFbq('ViewContent', {
    value,
    currency: 'USD',
    content_name: contentName,
  });
}

/** Fires when the user reaches the checkout / payment page. */
export function trackInitiateCheckout(value: number) {
  callFbq('InitiateCheckout', {
    value,
    currency: 'USD',
  });
}

/** Fires when a user submits a valid ZIP code (early funnel signal). */
export function trackLead(zipCode: string) {
  callFbq('Lead', {
    content_name: 'ZIP Entry',
    content_category: zipCode,
  });
}

/** Fires when the booking is confirmed (Success page). */
export function trackPurchase(
  value: number,
  serviceType: string,
  frequency: string,
  zoneId?: string,
) {
  callFbq('Purchase', {
    value,
    currency: 'USD',
    content_name: serviceType,
    content_category: frequency,
    content_ids: zoneId ? [zoneId] : [],
  });
}
