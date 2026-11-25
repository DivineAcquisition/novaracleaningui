// Google conversion events for the booking funnel.
// GTM-WT3SLNN7 is also loaded by TrackerGate after advertising consent.
// These pushes are what a Google Ads / Tag Manager test looks for on the
// pages where a booking or quote actually completes.

const GTM_ID = "GTM-WT3SLNN7";

type DataLayer = unknown[];

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

function layer(): DataLayer {
  const w = window as Window & { dataLayer?: DataLayer; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function gtag() {
      w.dataLayer!.push(arguments);
    };
  }
  return w.dataLayer;
}

function ensureTag(): boolean {
  if (!advertisingAllowed()) return false;
  const dataLayer = layer();
  const src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  if (!document.querySelector(`script[src="${src}"]`)) {
    dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }
  return true;
}

function once(key: string): boolean {
  try {
    const storageKey = `novara.gtm.${key}`;
    if (window.sessionStorage.getItem(storageKey)) return false;
    window.sessionStorage.setItem(storageKey, "1");
    return true;
  } catch {
    return true;
  }
}

function push(event: string, params: { value?: number; transactionId?: string }, dedupeKey: string) {
  if (!ensureTag()) return;
  if (!once(dedupeKey)) return;
  const dataLayer = layer();
  const value = typeof params.value === "number" && Number.isFinite(params.value) ? params.value : undefined;
  dataLayer.push({
    event,
    value,
    currency: "USD",
    transaction_id: params.transactionId,
  });
  const w = window as Window & { gtag?: (...args: unknown[]) => void };
  w.gtag?.("event", event, {
    value,
    currency: "USD",
    transaction_id: params.transactionId,
  });
}

/** Paid booking confirmed. This is the Google Ads conversion. */
export function trackGooglePurchase(value: number, transactionId?: string) {
  push("purchase", { value, transactionId }, `purchase:${transactionId || "booking"}`);
  push("booking_completed", { value, transactionId }, `booking_completed:${transactionId || "booking"}`);
}

/** Quote request submitted. */
export function trackGoogleLead(transactionId?: string) {
  push("generate_lead", { transactionId }, `generate_lead:${transactionId || "quote"}`);
}
