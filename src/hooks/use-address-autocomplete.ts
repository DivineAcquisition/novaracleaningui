"use client";

// ─── useAddressAutocomplete ───────────────────────────────────────────────────
//
// Shared engine for the address fields. Loads the Google Maps JS API once,
// detects the modern Places "AutocompleteSuggestion" API, and exposes a
// debounced query + resolve pair so each field can render its OWN dropdown.
//
// Status model:
//   loading → still fetching the key / script
//   ready   → modern Places autocomplete is live (show suggestions)
//   manual  → Google unavailable (no key, old key without Places New, etc.) —
//             the field falls back to typed entry + server-side geocoding
//   blocked → the JS API key's HTTP-referrer allow-list rejected this domain
//
// Returning `manual`/`blocked` (never throwing) keeps every booking/onboarding
// flow usable even when Google isn't reachable.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAddressSuggestions,
  getLastPlacesError,
  loadGooglePlaces,
  placesAutocompleteAvailable,
  resolveAddressSuggestion,
  type AddressSuggestion,
  type PlacesAddressComponents,
} from "@/lib/google-places-loader";

export type AddressAutocompleteStatus = "loading" | "ready" | "manual" | "blocked";

const DEBOUNCE_MS = 250;

export function useAddressAutocomplete() {
  const [status, setStatus] = useState<AddressAutocompleteStatus>("loading");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Load once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const places = await loadGooglePlaces();
      if (cancelled) return;
      if (typeof window !== "undefined" && (window as { __novaraGmAuthFailed?: boolean }).__novaraGmAuthFailed) {
        setStatus("blocked");
        return;
      }
      if (!places) {
        setStatus("manual");
        return;
      }
      setStatus(placesAutocompleteAvailable() ? "ready" : "manual");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // gm_authFailure can fire shortly after load (referrer-blocked key); watch
  // briefly and flip to "blocked" so the field shows the manual-entry path.
  useEffect(() => {
    if (status !== "ready") return;
    let ticks = 0;
    const t = setInterval(() => {
      ticks += 1;
      if ((window as { __novaraGmAuthFailed?: boolean }).__novaraGmAuthFailed) {
        setStatus("blocked");
        setSuggestions([]);
        clearInterval(t);
      }
      if (ticks > 6) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [status]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSuggestions([]);
  }, []);

  const query = useCallback(
    (input: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!input || input.trim().length < 3) {
        setSuggestions([]);
        return;
      }
      const seq = ++seqRef.current;
      debounceRef.current = setTimeout(async () => {
        const results = await fetchAddressSuggestions(input);
        // Ignore out-of-order responses from earlier keystrokes.
        if (seq !== seqRef.current) return;
        setSuggestions(results);
        // Surface an actionable hint once if the API rejected the request.
        if (results.length === 0) {
          const err = getLastPlacesError();
          if (err) {
            console.error(
              "[address-autocomplete] No suggestions returned. Likely the API key isn't authorized for Places API (New) or billing/referrers aren't set. Google said:",
              err,
            );
          }
        }
      }, DEBOUNCE_MS);
    },
    [],
  );

  const resolve = useCallback(
    async (suggestion: AddressSuggestion): Promise<PlacesAddressComponents | null> => {
      seqRef.current += 1; // invalidate any in-flight query
      setSuggestions([]);
      return resolveAddressSuggestion(suggestion);
    },
    [],
  );

  return { status, suggestions, query, resolve, clear };
}
