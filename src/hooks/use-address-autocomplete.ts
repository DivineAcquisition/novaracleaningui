"use client";

// ─── useAddressAutocomplete ───────────────────────────────────────────────────
//
// Shared engine for the address fields. Warms the Google Maps JS API and
// exposes a debounced query + resolve pair so each field can render its OWN
// dropdown.
//
// Suggestions come from Google when it accepts the key, otherwise from the
// keyless /api/address/suggest lookup — so the dropdown is always live and
// the status is always "ready". The other states stay in the type for the
// field components' copy.
//
// Never throws: every booking/onboarding flow stays usable when Google isn't
// reachable.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAddressSuggestions,
  getLastPlacesError,
  loadGooglePlaces,
  resolveAddressSuggestion,
  type AddressSuggestion,
  type PlacesAddressComponents,
} from "@/lib/google-places-loader";

export type AddressAutocompleteStatus = "loading" | "ready" | "manual" | "blocked";

const DEBOUNCE_MS = 250;

export function useAddressAutocomplete() {
  const status: AddressAutocompleteStatus = "ready";
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Start loading Google in the background. Typing doesn't wait on it: until
  // (or unless) Google is ready, suggestions come from the keyless lookup.
  useEffect(() => {
    void loadGooglePlaces();
  }, []);

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
            console.warn("[address-autocomplete] No suggestions returned. Google said:", err);
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
