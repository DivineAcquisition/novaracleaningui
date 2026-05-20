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
  }
}

const SCRIPT_ID = "novara-google-maps-js";

/** Load Google Maps JS + Places library. Returns the `places` namespace
 *  when ready, or null if the API key is unavailable. */
export function loadGooglePlaces(): Promise<typeof google.maps.places | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
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
      const onReady = () => {
        if (window.google?.maps?.places) {
          window.__novaraGooglePlacesReady = true;
          resolve(window.google.maps.places);
        } else {
          console.warn("[google-places] Script loaded but window.google.maps.places missing");
          resolve(null);
        }
      };

      window.__novaraGooglePlacesCallback = onReady;

      if (existing) {
        if (window.__novaraGooglePlacesReady) {
          onReady();
        } else {
          existing.addEventListener("load", onReady, { once: true });
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
        `&libraries=places&callback=__novaraGooglePlacesCallback&loading=async&v=weekly`;
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
