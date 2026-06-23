// ─── Google Places JS API loader ──────────────────────────────────────────
//
// Lazily fetches the API key from the `google-places-key` edge function
// (so we never ship the key in the client bundle) and injects the
// Maps JS API <script> tag exactly once per page. All callers share a
// single promise so concurrent invocations don't race.
//
// Usage:
//   const places = await loadGooglePlaces();
//   if (!places) {
//     // Fall back to local geocode UI — Google key not configured
//   } else {
//     const autocomplete = new places.Autocomplete(inputEl, { … });
//   }
//
// We DO NOT throw when the key is missing. Returning null lets the
// caller render a graceful fallback (e.g. the legacy Nominatim
// AddressAutocomplete) instead of breaking the booking flow.

import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    __novaraGooglePlacesPromise?: Promise<typeof google.maps.places | null>;
    __novaraGooglePlacesReady?: boolean;
    __novaraGooglePlacesCallback?: () => void;
    __novaraGmAuthFailed?: boolean;
    __novaraGmAuthFailureHooked?: boolean;
  }
}

const SCRIPT_ID = "novara-google-maps-js";

/** Load Google Maps JS + Places library. Returns the `places` namespace
 *  when ready, or null if the API key is unavailable. */
export function loadGooglePlaces(): Promise<typeof google.maps.places | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }

  // Install the auth-failure hook BEFORE the Maps script is ever injected.
  // Defining window.gm_authFailure suppresses Google's default
  // "This page can't load Google Maps correctly" modal — instead we flip a
  // flag the address components watch so they fall back to a plain,
  // typeable input + server-side geocoding. Doing this in the loader (not a
  // React effect) guarantees it's set before Google performs its check, so
  // the customer never sees the alarming dialog.
  if (!window.__novaraGmAuthFailureHooked) {
    window.__novaraGmAuthFailureHooked = true;
    const prior = (window as { gm_authFailure?: () => void }).gm_authFailure;
    (window as { gm_authFailure?: () => void }).gm_authFailure = () => {
      console.warn("[google-places] gm_authFailure — domain not allow-listed or key/API restricted");
      window.__novaraGmAuthFailed = true;
      try { prior?.(); } catch { /* ignore */ }
    };
  }

  if (window.__novaraGooglePlacesPromise) {
    return window.__novaraGooglePlacesPromise;
  }
  if (window.google?.maps?.places) {
    window.__novaraGooglePlacesReady = true;
    return Promise.resolve(window.google.maps.places);
  }

  window.__novaraGooglePlacesPromise = (async () => {
    let apiKey = "";
    try {
      const { data, error } = await supabase.functions.invoke("google-places-key", { body: {} });
      if (error || !data?.apiKey) {
        console.warn("[google-places] API key not configured — falling back to local geocode", error);
        return null;
      }
      apiKey = data.apiKey;
    } catch (err) {
      console.warn("[google-places] Failed to fetch API key", err);
      return null;
    }

    return await new Promise<typeof google.maps.places | null>((resolve) => {
      const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

      // With loading=async the callback fires before legacy `libraries=`
      // params are applied — importLibrary("places") is required.
      const onReady = async () => {
        if (window.__novaraGmAuthFailed) {
          resolve(null);
          return;
        }
        try {
          if (!window.google?.maps) {
            console.warn("[google-places] Script loaded but google.maps missing");
            resolve(null);
            return;
          }
          if (window.google.maps.importLibrary) {
            await window.google.maps.importLibrary("places");
          }
          if (window.google.maps.places) {
            window.__novaraGooglePlacesReady = true;
            resolve(window.google.maps.places);
            return;
          }
          console.warn("[google-places] Places library loaded but namespace missing");
          resolve(null);
        } catch (err) {
          console.warn("[google-places] importLibrary('places') failed", err);
          resolve(window.google?.maps?.places ?? null);
        }
      };

      window.__novaraGooglePlacesCallback = () => {
        void onReady();
      };

      if (existing) {
        if (window.__novaraGooglePlacesReady && window.google?.maps?.places) {
          void onReady();
        } else {
          existing.addEventListener("load", () => void onReady(), { once: true });
          existing.addEventListener("error", () => resolve(null), { once: true });
        }
        return;
      }

      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        `&callback=__novaraGooglePlacesCallback&loading=async&v=weekly`;
      script.onerror = () => {
        console.warn("[google-places] Script load failed");
        resolve(null);
      };
      document.head.appendChild(script);
    });
  })();

  return window.__novaraGooglePlacesPromise;
}

export interface PlacesAddressComponents {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  formattedAddress?: string;
}

// ─── Places API (New) — programmatic autocomplete ─────────────────────────────
//
// Google stopped serving the legacy `places.Autocomplete` widget to API keys /
// Cloud projects created on/after 2025-03-01 — it constructs but returns NO
// predictions (the "dropdown doesn't work anywhere" symptom). The supported
// path is the new `AutocompleteSuggestion` API, which we drive ourselves and
// render in our own dropdown (so it also works inside dialogs/sheets without
// the old .pac-container z-index / focus-trap problems).

export interface AddressSuggestion {
  id: string;
  /** Bold first line, e.g. "123 Main St". */
  primary: string;
  /** Muted second line, e.g. "Frederick, MD, USA". */
  secondary: string;
  /** Internal handle used to resolve full place details. */
  _prediction: unknown;
}

// A billing "session" groups keystroke suggestions with the final resolve; we
// rotate the token after each resolved place (Google's recommended pattern).
let sessionToken: unknown = null;

/** True when the modern AutocompleteSuggestion API is present (Places New). */
export function newPlacesAutocompleteAvailable(): boolean {
  const places = window.google?.maps?.places as unknown as { AutocompleteSuggestion?: unknown } | undefined;
  return !!places?.AutocompleteSuggestion;
}

function getSessionToken(reset = false): unknown {
  const places = window.google?.maps?.places as unknown as { AutocompleteSessionToken?: new () => unknown } | undefined;
  if (!places?.AutocompleteSessionToken) return undefined;
  if (reset || !sessionToken) sessionToken = new places.AutocompleteSessionToken();
  return sessionToken;
}

/**
 * Fetch US address autocomplete suggestions for `input`. Returns [] when the
 * API isn't available or the input is too short — callers fall back to manual
 * entry + server-side geocoding.
 */
export async function fetchAddressSuggestions(input: string): Promise<AddressSuggestion[]> {
  const trimmed = input.trim();
  const places = window.google?.maps?.places as any;
  if (!places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions || trimmed.length < 3) {
    return [];
  }
  try {
    const res = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: trimmed,
      sessionToken: getSessionToken(),
      includedRegionCodes: ["us"],
    });
    const out: AddressSuggestion[] = [];
    for (const s of (res?.suggestions || []) as any[]) {
      const p = s?.placePrediction;
      if (!p) continue;
      out.push({
        id: String(p.placeId || p.place || Math.random().toString(36).slice(2)),
        primary: p.mainText?.text || p.text?.text || "",
        secondary: p.secondaryText?.text || "",
        _prediction: p,
      });
    }
    return out;
  } catch (err) {
    console.warn("[google-places] fetchAutocompleteSuggestions failed", err);
    return [];
  }
}

/** Resolve a suggestion to full address components, then rotate the session. */
export async function resolveAddressSuggestion(
  suggestion: AddressSuggestion,
): Promise<PlacesAddressComponents | null> {
  const p = suggestion._prediction as any;
  if (!p?.toPlace) return null;
  try {
    const place = p.toPlace();
    await place.fetchFields({ fields: ["addressComponents", "formattedAddress", "location"] });
    getSessionToken(true); // end the billing session
    return parsePlaceNew(place);
  } catch (err) {
    console.warn("[google-places] resolveAddressSuggestion failed", err);
    return null;
  }
}

/** Map a Places-API-New `Place` (camelCase addressComponents) to our shape. */
export function parsePlaceNew(place: any): PlacesAddressComponents {
  const components = (place?.addressComponents || []) as Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zipCode = "";

  for (const c of components) {
    const types = c.types || [];
    const long = c.longText || "";
    const short = c.shortText || "";
    if (types.includes("street_number")) streetNumber = short || long;
    if (types.includes("route")) route = long || short;
    if (types.includes("locality") || types.includes("postal_town") || types.includes("sublocality")) {
      if (!city) city = long || short;
    }
    if (!city && (types.includes("administrative_area_level_3") || types.includes("administrative_area_level_2"))) {
      city = long || short;
    }
    if (types.includes("administrative_area_level_1")) state = short || long;
    if (types.includes("postal_code")) zipCode = short || long;
  }

  const loc = place?.location;
  const lat = typeof loc?.lat === "function" ? loc.lat() : loc?.lat;
  const lng = typeof loc?.lng === "function" ? loc.lng() : loc?.lng;

  return {
    street: `${streetNumber} ${route}`.trim(),
    city,
    state,
    zipCode,
    lat: typeof lat === "number" ? lat : undefined,
    lng: typeof lng === "number" ? lng : undefined,
    formattedAddress: place?.formattedAddress || undefined,
  };
}

/** Extract the four canonical address pieces from a Google Places
 *  `PlaceResult`. Returns blank fields if the place doesn't include
 *  one — callers should treat empty city/state as a soft warning,
 *  not a hard failure. */
export function parsePlaceResult(place: google.maps.places.PlaceResult): PlacesAddressComponents {
  const components = place.address_components || [];
  let streetNumber = "";
  let route = "";
  let city = "";
  let state = "";
  let zipCode = "";

  for (const c of components) {
    const types = c.types || [];
    if (types.includes("street_number")) streetNumber = c.short_name || c.long_name || "";
    if (types.includes("route")) route = c.long_name || c.short_name || "";
    if (types.includes("locality") || types.includes("postal_town") || types.includes("sublocality")) {
      if (!city) city = c.long_name || c.short_name || "";
    }
    if (!city && (types.includes("administrative_area_level_3") || types.includes("administrative_area_level_2"))) {
      city = c.long_name || c.short_name || "";
    }
    if (types.includes("administrative_area_level_1")) state = c.short_name || c.long_name || "";
    if (types.includes("postal_code")) zipCode = c.short_name || c.long_name || "";
  }

  const street = `${streetNumber} ${route}`.trim();
  const loc = place.geometry?.location;

  return {
    street,
    city,
    state,
    zipCode,
    lat: loc?.lat?.(),
    lng: loc?.lng?.(),
    formattedAddress: place.formatted_address || undefined,
  };
}
