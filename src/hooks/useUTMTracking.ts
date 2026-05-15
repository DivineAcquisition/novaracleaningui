"use client";

import { useCallback, useEffect } from "react";
import { useSearchParams, usePathname } from "next/navigation";

// localStorage keys — match the AlphaLux convention so analytics tooling
// that bridges the two codebases recognises the same shape.
const STORAGE_KEYS = {
  UTM_SOURCE: "utm_source",
  UTM_MEDIUM: "utm_medium",
  UTM_CAMPAIGN: "utm_campaign",
  UTM_CONTENT: "utm_content",
  UTM_TERM: "utm_term",
  LANDING_PAGE: "landing_page",
  REFERRER: "referrer",
  FIRST_VISIT_TIMESTAMP: "first_visit_timestamp",
  FBCLID: "fbclid",
  GCLID: "gclid",
} as const;

export interface TrackingData {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_page: string | null;
  referrer: string | null;
  first_visit_timestamp: string | null;
  fbclid: string | null;
  gclid: string | null;
}

const isBrowser = () => typeof window !== "undefined";

function readStorage(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — Safari private mode / quota errors
  }
}

/**
 * Hook that captures UTM + landing-page + referrer + first-visit
 * timestamp into localStorage on every navigation. Mirrors AlphaLux's
 * useUTMTracking pattern, adapted for Next.js App Router.
 *
 * - UTM params are ONLY written when present in the URL (so an internal
 *   navigation that drops `?utm_*` doesn't clobber the original
 *   attribution).
 * - landing_page, referrer, and first_visit_timestamp are written only
 *   on the customer's *first* visit (no overwrite).
 * - Returns helpers for retrieving / clearing the bag.
 */
export function useUTMTracking() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    if (!isBrowser()) return;

    // ─── UTM params (only write when present so we don't wipe out the
    //     original attribution on internal nav) ──────────────────────
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const writeIfPresent = (param: string, key: string) => {
      const v = params.get(param);
      if (v) writeStorage(key, v);
    };

    writeIfPresent("utm_source", STORAGE_KEYS.UTM_SOURCE);
    writeIfPresent("utm_medium", STORAGE_KEYS.UTM_MEDIUM);
    writeIfPresent("utm_campaign", STORAGE_KEYS.UTM_CAMPAIGN);
    writeIfPresent("utm_content", STORAGE_KEYS.UTM_CONTENT);
    writeIfPresent("utm_term", STORAGE_KEYS.UTM_TERM);
    writeIfPresent("fbclid", STORAGE_KEYS.FBCLID);
    writeIfPresent("gclid", STORAGE_KEYS.GCLID);

    // ─── First-visit attribution (don't overwrite) ──────────────────
    if (!readStorage(STORAGE_KEYS.LANDING_PAGE)) {
      writeStorage(STORAGE_KEYS.LANDING_PAGE, window.location.href);
    }
    if (!readStorage(STORAGE_KEYS.REFERRER)) {
      writeStorage(STORAGE_KEYS.REFERRER, document.referrer || "");
    }
    if (!readStorage(STORAGE_KEYS.FIRST_VISIT_TIMESTAMP)) {
      writeStorage(STORAGE_KEYS.FIRST_VISIT_TIMESTAMP, new Date().toISOString());
    }
  }, [searchParams, pathname]);

  const getTrackingData = useCallback((): TrackingData => getStoredTrackingData(), []);

  const clearTrackingData = useCallback(() => {
    if (!isBrowser()) return;
    Object.values(STORAGE_KEYS).forEach((k) => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });
  }, []);

  return { getTrackingData, clearTrackingData };
}

/**
 * Standalone reader for use outside React (e.g. plain handlers, libs).
 * Returns the same shape as the hook's getTrackingData().
 */
export function getStoredTrackingData(): TrackingData {
  return {
    utm_source: readStorage(STORAGE_KEYS.UTM_SOURCE),
    utm_medium: readStorage(STORAGE_KEYS.UTM_MEDIUM),
    utm_campaign: readStorage(STORAGE_KEYS.UTM_CAMPAIGN),
    utm_content: readStorage(STORAGE_KEYS.UTM_CONTENT),
    utm_term: readStorage(STORAGE_KEYS.UTM_TERM),
    landing_page: readStorage(STORAGE_KEYS.LANDING_PAGE),
    referrer: readStorage(STORAGE_KEYS.REFERRER),
    first_visit_timestamp: readStorage(STORAGE_KEYS.FIRST_VISIT_TIMESTAMP),
    fbclid: readStorage(STORAGE_KEYS.FBCLID),
    gclid: readStorage(STORAGE_KEYS.GCLID),
  };
}

/**
 * Convenience: return only the non-null tracking fields so an
 * Edge Function body can omit empty values entirely.
 */
export function getTrackingPayload(): Record<string, string> {
  const all = getStoredTrackingData();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (v && typeof v === "string") out[k] = v;
  }
  return out;
}
