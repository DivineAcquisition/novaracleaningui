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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Load address history
  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  // Wire up Google Places Autocomplete. Falls back silently to the
  // Nominatim onBlur path when the API key isn't configured.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const places = await loadGooglePlaces();
      if (cancelled) return;
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
    // Clear validation error on input change
    setValidationError(null);
    setGeocodedLocation(null);
  };

  const handleInputBlur = async () => {
    // When Google Places is active, place_changed already pushed
    // the validated address. Skip the legacy onBlur geocode so we
    // don't clobber the canonical street with a partial parse.
    if (googleLoaded) return;
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
          defaultValue={initialValue}
          className="pr-10"
          onChange={handleInputChange}
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
