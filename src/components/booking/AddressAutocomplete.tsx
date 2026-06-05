"use client";

import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiMapPinLine,
  RiTimeLine
} from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getAddressHistory,
  saveAddressToHistory,
  getHistoryItemDisplay,
  type AddressHistoryItem,
} from "@/lib/address-history";
import { formatAddress, parseAddressString, mergeAddressParts } from "@/lib/address-formatter";
import { loadGooglePlaces, parsePlaceResult } from "@/lib/google-places-loader";

interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat?: number;
  lng?: number;
}

interface AddressAutocompleteProps {
  onAddressSelect: (address: AddressComponents) => void;
  initialValue?: string;
  label?: string;
  placeholder?: string;
  error?: string;
}

export function AddressAutocomplete({
  onAddressSelect,
  initialValue = "",
  label = "Street Address *",
  placeholder = "Start typing address...",
  error,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  // Google Places Autocomplete must own the input (uncontrolled). Parent
  // state updates on every keystroke cause React/Google to fight and the
  // field appears disabled/greyed out.
  const initialStreetRef = useRef(initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [googleBlocked, setGoogleBlocked] = useState(false);

  // Load address history
  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  // Referrer-restricted keys call gm_authFailure instead of showing suggestions.
  useEffect(() => {
    if (window.__novaraGmAuthFailureHooked) return;
    window.__novaraGmAuthFailureHooked = true;
    const prior = (window as { gm_authFailure?: () => void }).gm_authFailure;
    (window as { gm_authFailure?: () => void }).gm_authFailure = () => {
      console.warn("[google-places] gm_authFailure — domain likely not allow-listed");
      window.__novaraGmAuthFailed = true;
      try {
        prior?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Wire up Google Places Autocomplete. Falls back silently to the
  // Nominatim onBlur path when the API key isn't configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const places = await loadGooglePlaces();
      if (cancelled) return;
      if (window.__novaraGmAuthFailed) {
        setGoogleBlocked(true);
        setGoogleLoaded(false);
        return;
      }
      if (!places || !inputRef.current) {
        setGoogleLoaded(false);
        return;
      }
      try {
        const ac = new places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "us" },
          fields: ["address_components", "geometry", "formatted_address"],
          types: ["address"],
        });
        autocompleteRef.current = ac;
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place || !place.address_components) {
            setValidationError("Pick an address from the list to validate");
            return;
          }
          const parsed = parsePlaceResult(place);
          setValidationError(null);
          setGeocodedLocation(parsed.formattedAddress || null);
          if (inputRef.current && parsed.street) {
            inputRef.current.value = parsed.street;
          }
          onAddressSelect({
            street: parsed.street,
            city: parsed.city,
            state: parsed.state,
            zipCode: parsed.zipCode,
            lat: parsed.lat,
            lng: parsed.lng,
          });
        });
        setGoogleLoaded(true);
      } catch (err) {
        console.warn("[AddressAutocomplete] Google Places init failed", err);
        setGoogleLoaded(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // gm_authFailure can fire after Autocomplete is wired but before the user types.
  useEffect(() => {
    if (!googleLoaded || googleBlocked) return;
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      if (window.__novaraGmAuthFailed) {
        setGoogleBlocked(true);
        setGoogleLoaded(false);
        clearInterval(t);
      }
      if (ticks > 6) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [googleLoaded, googleBlocked]);

  const handleHistorySelect = (item: AddressHistoryItem) => {
    // Clear validation error when selecting from history
    setValidationError(null);
    setGeocodedLocation(null);
    
    // Update input via ref for uncontrolled input
    if (inputRef.current) {
      inputRef.current.value = item.street;
    }
    
    onAddressSelect({
      street: item.street,
      city: item.city,
      state: item.state,
      zipCode: item.zipCode,
    });

    setShowHistory(false);
  };

  const handleInputChange = () => {
    // Avoid re-rendering on every keystroke — Google Places fights React
    // updates and the street field can look disabled/grey.
    if (validationError) setValidationError(null);
    if (geocodedLocation) setGeocodedLocation(null);
  };

  // Hydrate street from parent once (booking row load); do not tie to keystrokes.
  useEffect(() => {
    if (!initialValue || !inputRef.current) return;
    if (!inputRef.current.value.trim()) {
      inputRef.current.value = initialValue;
      initialStreetRef.current = initialValue;
    }
  }, [initialValue]);

  const handleInputBlur = async () => {
    // Only skip manual geocode when the user already picked a Places
    // suggestion (place_changed set geocodedLocation). If they typed
    // manually while Google is loaded, we still need to parse/geocode.
    if (googleLoaded && !googleBlocked && geocodedLocation) return;
    const value = inputRef.current?.value?.trim();
    if (!value) return;

    // Locally parse the typed string first — this is the safety net that
    // pulls City / State / ZIP out of a cram-everything-in-Street entry
    // (e.g. "123 Main St, Frederick, MD 21703") even if geocode fails.
    const locallyParsed = parseAddressString(value);

    try {
      console.log('[AddressAutocomplete] Attempting geocode for:', value);

      const { data, error } = await supabase.functions.invoke('geocode-address', {
        body: {
          address: value,
          city: "",
          state: "",
          zip: "",
        },
      });

      if (error || !data) {
        console.warn('[AddressAutocomplete] Geocode missed — using local parse', { error });
        emitParsed(locallyParsed);
        return;
      }

      console.log('[AddressAutocomplete] Geocode response:', data);
      setGeocodedLocation(data.display_name || null);

      // Prefer geocoded parts (more reliable), fall back to the
      // local parse for any blank component.
      const parsed = data.parsed && typeof data.parsed === 'object'
        ? mergeAddressParts(data.parsed, locallyParsed)
        : locallyParsed;

      onAddressSelect({
        street: parsed.street || value,
        city: parsed.city || "",
        state: parsed.state || "",
        zipCode: parsed.zipCode || "",
        lat: data.lat,
        lng: data.lng,
      });

      // Reflect the cleaned street back into the input so the user
      // sees the canonical version (and Street alone, not the full
      // mush they typed).
      if (inputRef.current && parsed.street) {
        inputRef.current.value = parsed.street;
      }
    } catch (err) {
      console.error('[AddressAutocomplete] Geocode failed:', err);
      emitParsed(locallyParsed);
    }
  };

  function emitParsed(parsed: ReturnType<typeof parseAddressString>) {
    onAddressSelect({
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
    });
    if (inputRef.current && parsed.street) {
      inputRef.current.value = parsed.street;
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="customer-address-autocomplete">{label}</Label>
        {addressHistory.length > 0 && (
          <Popover open={showHistory} onOpenChange={setShowHistory}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <RiTimeLine className="w-3 h-3 mr-1" />
                Recent
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="end">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground px-2 py-1">
                  Recently Used Addresses
                </p>
                {addressHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistorySelect(item)}
                    className="w-full text-left px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <RiMapPinLine className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <span className="flex-1">{getHistoryItemDisplay(item)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      
      <div className="relative">
        <Input
          ref={inputRef}
          id="customer-address-autocomplete"
          type="text"
          placeholder={placeholder}
          defaultValue={initialStreetRef.current}
          className="pr-10"
          onChange={handleInputChange}
          autoComplete="off"
          onBlur={handleInputBlur}
          onFocus={() => {
            setShowHistory(false);
            setValidationError(null);
          }}
        />
        <RiMapPinLine className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>
      
      {validationError && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <RiErrorWarningLine className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}
      
      {error && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <RiErrorWarningLine className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      
      {geocodedLocation && !validationError && !error && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <RiCheckboxCircleLine className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
          <span>Confirmed: {geocodedLocation}</span>
        </div>
      )}
    </div>
  );
}
