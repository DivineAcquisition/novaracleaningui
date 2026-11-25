// Google conversion events for the booking funnel.
// GTM-WT3SLNN7 is also loaded by TrackerGate after advertising consent.
// These pushes are what a Google Ads / Tag Manager test looks for on the
// pages where a booking or quote actually completes.

const GTM_ID = "GTM-WT3SLNN7";
const ADS_ID = "AW-17623293005";

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

function push(event: string, params: { value?: number; transactionId?: string }, dedupeKey: string, asConversion: boolean) {
  if (typeof window === "undefined") return;
  if (!once(dedupeKey)) return;
  const value = typeof params.value === "number" && Number.isFinite(params.value) ? params.value : undefined;
  const payload = {
    event,
    value,
    currency: "USD",
    transaction_id: params.transactionId,
  };
  // Queue first so the tag still receives the hit if it loads with consent
  // a moment later. No name, email, phone, or address.
  layer().push(payload);
  if (!ensureTag()) return;
  const w = window as Window & { gtag?: (...args: unknown[]) => void };
  w.gtag?.("js", new Date());
  w.gtag?.("config", ADS_ID);
  w.gtag?.("event", event, {
    value,
    currency: "USD",
    transaction_id: params.transactionId,
  });
  if (asConversion) {
    w.gtag?.("event", "conversion", {
      send_to: ADS_ID,
      value,
      currency: "USD",
      transaction_id: params.transactionId,
    });
  }
}

/** Paid booking confirmed. This is the Google Ads conversion. */
export function trackGooglePurchase(value: number, transactionId?: string) {
  push("booking_completed", { value, transactionId }, `booking_completed:${transactionId || "booking"}`, true);
}

/** Quote request submitted. */
export function trackGoogleLead(transactionId?: string) {
  push("generate_lead", { transactionId }, `generate_lead:${transactionId || "quote"}`, true);
}
