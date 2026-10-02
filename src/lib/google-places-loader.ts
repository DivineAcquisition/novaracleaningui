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

  const loadPromise = (async () => {
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

      // libraries=places (no loading=async) attaches AutocompleteService before
      // this callback. Do not call importLibrary("places") first: that loads
      // Places API (New), which this key is not permitted to call, and it can
      // hide the legacy service the dropdown actually uses.
      const onReady = async () => {
        if (window.__novaraGmAuthFailed) {
          resolve(null);
          return;
        }
        try {
          const places = window.google?.maps?.places as { AutocompleteService?: unknown; AutocompleteSuggestion?: unknown } | undefined;
          if (places?.AutocompleteService || places?.AutocompleteSuggestion) {
            window.__novaraGooglePlacesReady = true;
            resolve(window.google.maps.places);
            return;
          }
          if (window.google?.maps?.importLibrary) {
            await window.google.maps.importLibrary("places");
          }
          if (window.google?.maps?.places) {
            window.__novaraGooglePlacesReady = true;
            resolve(window.google.maps.places);
            return;
          }
          console.warn("[google-places] Places library loaded but namespace missing");
          resolve(null);
        } catch (err) {
          console.warn("[google-places] Places library failed", err);
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
      // Do not set loading=async. With that flag Google ignores `libraries=places`,
      // so the legacy AutocompleteService never attaches. This key is allowed to
      // call Places from the booking site, but Places API (New) returns
      // PERMISSION_DENIED, so suggestions have to come from the legacy service.
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
        `&libraries=places&callback=__novaraGooglePlacesCallback&v=weekly`;
      script.onerror = () => {
        console.warn("[google-places] Script load failed");
        resolve(null);
      };
      document.head.appendChild(script);
    });
  })();

  window.__novaraGooglePlacesPromise = loadPromise.then((places) => {
    if (!places) delete window.__novaraGooglePlacesPromise;
    return places;
  });

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

// Surfaced for diagnostics — the last error from a suggestion fetch (e.g.
// REQUEST_DENIED when the API key isn't authorized for Places API New). The
// hook logs a one-time, actionable console error when this is set.
let lastPlacesError: string | null = null;
export function getLastPlacesError(): string | null {
  return lastPlacesError;
}

function placesNs(): any {
  return window.google?.maps?.places as any;
}

/** True when the modern AutocompleteSuggestion API is present (Places New). */
export function newPlacesAutocompleteAvailable(): boolean {
  return !!placesNs()?.AutocompleteSuggestion;
}

/**
 * True when EITHER the modern (AutocompleteSuggestion) or the legacy
 * (AutocompleteService) predictions API is present. We try modern first and
 * fall back to legacy so the dropdown works regardless of which Places API the
 * project's key is authorized for.
 */
export function placesAutocompleteAvailable(): boolean {
  const p = placesNs();
  return !!(p?.AutocompleteSuggestion || p?.AutocompleteService);
}

// Once Google refuses a request (PERMISSION_DENIED, REQUEST_DENIED, …) stop
// asking for the rest of the page. Every keystroke would otherwise wait on a
// request we already know fails before reaching the keyless lookup.
let newPlacesDisabled = false;
let legacyPlacesDisabled = false;
const LEGACY_TIMEOUT_MS = 3000;

function getSessionToken(reset = false): unknown {
  const places = placesNs();
  if (!places?.AutocompleteSessionToken) return undefined;
  if (reset || !sessionToken) sessionToken = new places.AutocompleteSessionToken();
  return sessionToken;
}

// ─── Legacy programmatic services (fallback for older keys) ───────────────────

let legacyAutocompleteService: any = null;
let legacyPlacesService: any = null;
function getLegacyAutocompleteService(): any {
  const p = placesNs();
  if (!p?.AutocompleteService) return null;
  if (!legacyAutocompleteService) legacyAutocompleteService = new p.AutocompleteService();
  return legacyAutocompleteService;
}
function getLegacyPlacesService(): any {
  const p = placesNs();
  if (!p?.PlacesService) return null;
  if (!legacyPlacesService) legacyPlacesService = new p.PlacesService(document.createElement("div"));
  return legacyPlacesService;
}

/** Try the modern API. Returns null (not []) to signal "fall back to legacy". */
async function fetchNewSuggestions(input: string): Promise<AddressSuggestion[] | null> {
  const places = placesNs();
  if (newPlacesDisabled || !places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) return null;
  try {
    const res = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
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
        _prediction: { kind: "new", p },
      });
    }
    return out;
  } catch (err) {
    newPlacesDisabled = true;
    lastPlacesError = (err as Error)?.message || String(err);
    console.warn(
      "[google-places] Places API (New) request failed — check the API key is authorized for 'Places API (New)' and billing is enabled:",
      lastPlacesError,
    );
    return null; // fall back to legacy
  }
}

/** Legacy AutocompleteService.getPlacePredictions (callback → promise). */
function fetchLegacySuggestions(input: string): Promise<AddressSuggestion[]> {
  const svc = legacyPlacesDisabled ? null : getLegacyAutocompleteService();
  if (!svc) return Promise.resolve([]);
  return new Promise((resolve) => {
    // A refused key can leave the callback unanswered; don't hang the dropdown.
    const timer = setTimeout(() => resolve([]), LEGACY_TIMEOUT_MS);
    svc.getPlacePredictions(
      { input, componentRestrictions: { country: "us" }, types: ["address"] },
      (preds: any[], statusStr: string) => {
        clearTimeout(timer);
        if (statusStr !== "OK") {
          if (statusStr !== "ZERO_RESULTS") {
            legacyPlacesDisabled = true;
            lastPlacesError = `legacy AutocompleteService status: ${statusStr}`;
            console.warn("[google-places] legacy getPlacePredictions:", statusStr);
          }
          resolve([]);
          return;
        }
        resolve(
          (preds || []).map((pr) => ({
            id: String(pr.place_id),
            primary: pr.structured_formatting?.main_text || pr.description || "",
            secondary: pr.structured_formatting?.secondary_text || "",
            _prediction: { kind: "legacy", placeId: pr.place_id },
          })),
        );
      },
    );
  });
}

// ─── Keyless fallback (/api/address/*) ────────────────────────────────────────
//
// Photon suggestions + US Census geocoding, served by our own API routes. This
// is what keeps the dropdown working when Google refuses the key.

interface ServerAddressMatch {
  id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
  secondary: string;
  label: string;
}

async function fetchServerSuggestions(input: string): Promise<AddressSuggestion[]> {
  try {
    const res = await fetch(`/api/address/suggest?q=${encodeURIComponent(input)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: ServerAddressMatch[] };
    return (data.suggestions || []).map((m) => ({
      id: m.id,
      primary: m.street,
      secondary: m.secondary,
      _prediction: { kind: "server", match: m },
    }));
  } catch (err) {
    console.warn("[address-lookup] suggestions failed", err);
    return [];
  }
}

/**
 * Geocode an address the user typed without picking a suggestion. Returns
 * null when nothing matched, so callers can try the edge function / local parse.
 */
export async function geocodeTypedAddress(line: string): Promise<PlacesAddressComponents | null> {
  const q = line.trim();
  if (q.length < 3 || typeof window === "undefined") return null;
  try {
    const res = await fetch(`/api/address/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const { match } = (await res.json()) as { match?: ServerAddressMatch | null };
    if (!match) return null;
    return {
      street: match.street,
      city: match.city,
      state: match.state,
      zipCode: match.zipCode,
      lat: match.lat,
      lng: match.lng,
      formattedAddress: match.label,
    };
  } catch (err) {
    console.warn("[address-lookup] geocode failed", err);
    return null;
  }
}

/**
 * Fetch US address autocomplete suggestions for `input`. Tries Google (Places
 * API New, then the legacy service) and falls back to the keyless lookup, so
 * the dropdown fills whether or not Google accepts the key.
 */
export async function fetchAddressSuggestions(input: string): Promise<AddressSuggestion[]> {
  const trimmed = input.trim();
  if (trimmed.length < 3) return [];
  lastPlacesError = null;

  if (placesNs()) {
    const fromNew = await fetchNewSuggestions(trimmed);
    if (fromNew && fromNew.length > 0) return fromNew;

    const fromLegacy = await fetchLegacySuggestions(trimmed);
    if (fromLegacy.length > 0) return fromLegacy;
  }

  return fetchServerSuggestions(trimmed);
}

/** Resolve a suggestion to full address components, then rotate the session. */
export async function resolveAddressSuggestion(
  suggestion: AddressSuggestion,
): Promise<PlacesAddressComponents | null> {
  const pred = suggestion._prediction as any;

  // Keyless suggestion → Census for the exact point; keep the street the user saw.
  if (pred?.kind === "server") {
    const m = pred.match as ServerAddressMatch;
    const exact = await geocodeTypedAddress(m.label);
    return {
      street: m.street,
      city: m.city || exact?.city || "",
      state: m.state || exact?.state || "",
      zipCode: m.zipCode || exact?.zipCode || "",
      lat: exact?.lat ?? m.lat,
      lng: exact?.lng ?? m.lng,
      formattedAddress: m.label,
    };
  }

  // Google can serve predictions but refuse the details call; geocode the
  // text of the suggestion instead of failing the pick.
  const fromGoogle = await resolveGoogleSuggestion(pred);
  if (fromGoogle) return fromGoogle;
  return geocodeTypedAddress([suggestion.primary, suggestion.secondary].filter(Boolean).join(", "));
}

async function resolveGoogleSuggestion(pred: any): Promise<PlacesAddressComponents | null> {
  // Legacy prediction → PlacesService.getDetails.
  if (pred?.kind === "legacy") {
    const svc = getLegacyPlacesService();
    if (!svc) return null;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), LEGACY_TIMEOUT_MS);
      svc.getDetails(
        { placeId: pred.placeId, fields: ["address_components", "geometry", "formatted_address"] },
        (place: google.maps.places.PlaceResult | null) => {
          clearTimeout(timer);
          resolve(place ? parsePlaceResult(place) : null);
        },
      );
    });
  }

  // Modern prediction → place.fetchFields.
  const p = pred?.p ?? pred;
  if (!p?.toPlace) return null;
  try {
    const place = p.toPlace();
    await place.fetchFields({ fields: ["addressComponents", "formattedAddress", "location"] });
    getSessionToken(true); // end the billing session
    return parsePlaceNew(place);
  } catch (err) {
    lastPlacesError = (err as Error)?.message || String(err);
    console.warn("[google-places] resolveAddressSuggestion failed:", lastPlacesError);
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
  const latRaw = typeof loc?.lat === "function" ? loc.lat() : (loc?.lat ?? loc?.latitude);
  const lngRaw = typeof loc?.lng === "function" ? loc.lng() : (loc?.lng ?? loc?.longitude);
  const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);

  return {
    street: `${streetNumber} ${route}`.trim(),
    city,
    state,
    zipCode,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
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
