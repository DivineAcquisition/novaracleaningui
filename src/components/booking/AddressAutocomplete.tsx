"use client";

// ─── Address autocomplete (customer/booking) ──────────────────────────────────
//
// Uses the modern Places API (New) via useAddressAutocomplete and renders its
// OWN suggestion dropdown (the legacy google.maps.places.Autocomplete widget is
// no longer served to new API keys, which is why the old dropdown never
// appeared). Falls back to typed entry + server-side geocoding (Nominatim) on
// blur when Google is unavailable or the domain isn't allow-listed.

import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiMapPinLine,
  RiTimeLine,
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
  getHistoryItemDisplay,
  type AddressHistoryItem,
} from "@/lib/address-history";
import { parseAddressString, mergeAddressParts } from "@/lib/address-formatter";
import { useAddressAutocomplete } from "@/hooks/use-address-autocomplete";
import type { AddressSuggestion } from "@/lib/google-places-loader";

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
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pickedRef = useRef(false);

  const { status, suggestions, query, resolve, clear } = useAddressAutocomplete();

  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  const emit = (addr: AddressComponents) => onAddressSelect(addr);

  const handleHistorySelect = (item: AddressHistoryItem) => {
    setValidationError(null);
    setGeocodedLocation(null);
    if (inputRef.current) inputRef.current.value = item.street;
    pickedRef.current = true;
    emit({
      street: item.street,
      city: item.city,
      state: item.state,
      zipCode: item.zipCode,
    });
    setShowHistory(false);
    setOpen(false);
    clear();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (validationError) setValidationError(null);
    if (geocodedLocation) setGeocodedLocation(null);
    pickedRef.current = false;
    const value = e.target.value;
    if (status === "ready") {
      query(value);
      setOpen(true);
    }
  };

  const handleSuggestionPick = async (s: AddressSuggestion) => {
    setOpen(false);
    const parsed = await resolve(s);
    if (!parsed) {
      setValidationError("Could not load that address — try typing it in full.");
      return;
    }
    pickedRef.current = true;
    setValidationError(null);
    setGeocodedLocation(parsed.formattedAddress || null);
    if (inputRef.current && parsed.street) inputRef.current.value = parsed.street;
    emit({
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      lat: parsed.lat,
      lng: parsed.lng,
    });
  };

  // Hydrate from parent once (booking row load).
  useEffect(() => {
    if (!initialValue || !inputRef.current) return;
    if (!inputRef.current.value.trim()) inputRef.current.value = initialValue;
  }, [initialValue]);

  const handleInputBlur = async () => {
    // Let a suggestion click (mousedown) win the race before we close.
    setTimeout(() => setOpen(false), 150);
    if (pickedRef.current) return; // user already chose a suggestion/history
    const value = inputRef.current?.value?.trim();
    if (!value) return;

    const locallyParsed = parseAddressString(value);
    try {
      const { data, error: geoErr } = await supabase.functions.invoke("geocode-address", {
        body: { address: value, city: "", state: "", zip: "" },
      });
      if (geoErr || !data) {
        emitParsed(locallyParsed);
        return;
      }
      setGeocodedLocation(data.display_name || null);
      const parsed =
        data.parsed && typeof data.parsed === "object"
          ? mergeAddressParts(data.parsed, locallyParsed)
          : locallyParsed;
      emit({
        street: parsed.street || value,
        city: parsed.city || "",
        state: parsed.state || "",
        zipCode: parsed.zipCode || "",
        lat: data.lat,
        lng: data.lng,
      });
      if (inputRef.current && parsed.street) inputRef.current.value = parsed.street;
    } catch (err) {
      console.warn("[AddressAutocomplete] Geocode failed:", err);
      emitParsed(locallyParsed);
    }
  };

  function emitParsed(parsed: ReturnType<typeof parseAddressString>) {
    emit({
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
    });
    if (inputRef.current && parsed.street) inputRef.current.value = parsed.street;
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
          autoComplete="off"
          onBlur={handleInputBlur}
          onFocus={() => {
            setShowHistory(false);
            setValidationError(null);
            if (status === "ready" && suggestions.length > 0) setOpen(true);
          }}
        />
        <RiMapPinLine className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />

        {open && status === "ready" && suggestions.length > 0 && (
          <ul className="absolute z-[10000] left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  // mousedown fires before the input's blur, so the pick wins.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSuggestionPick(s);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-start gap-2"
                >
                  <RiMapPinLine className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{s.primary}</span>
                    {s.secondary && <span className="block text-xs text-muted-foreground truncate">{s.secondary}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(status === "manual" || status === "blocked") && (
        <p className="text-[11px] text-muted-foreground">
          Type your full street address (e.g. 123 Main St, Frederick, MD 21703) — we&apos;ll verify it automatically.
        </p>
      )}

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
