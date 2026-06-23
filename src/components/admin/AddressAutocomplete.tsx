"use client";

// ─── Admin address autocomplete (v3 — 2026-06) ────────────────────────────────
//
// Uses the modern Places API (New) via useAddressAutocomplete and renders its
// own suggestion dropdown. The legacy google.maps.places.Autocomplete widget is
// no longer served to API keys created on/after 2025-03-01 (it constructs but
// returns no predictions) — this programmatic path is the supported replacement
// and also avoids the old .pac-container z-index / focus-trap issues inside
// dialogs.
//
// Fallback chain: Google suggestion → geocode-address (Nominatim) on blur →
// pure-JS parseAddressString. A status pill makes the active path obvious.

import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiMapPinLine,
  RiTimeLine,
} from "@remixicon/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { mergeAddressParts, parseAddressString } from "@/lib/address-formatter";
import { useAddressAutocomplete, type AddressAutocompleteStatus } from "@/hooks/use-address-autocomplete";
import type { AddressSuggestion } from "@/lib/google-places-loader";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  onAddressSelect: (address: AddressComponents) => void;
  initialValue?: string;
  label?: string;
  placeholder?: string;
}

export function AddressAutocomplete({
  onAddressSelect,
  initialValue = "",
  label = "Street Address *",
  placeholder = "Start typing the customer's address…",
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const pickedRef = useRef(false);

  const { status, suggestions, query, resolve, clear } = useAddressAutocomplete();

  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  // Hydrate from parent once (e.g. lead load) without tying to keystrokes.
  useEffect(() => {
    if (!initialValue || !inputRef.current) return;
    if (!inputRef.current.value.trim()) inputRef.current.value = initialValue;
  }, [initialValue]);

  const handleHistorySelect = (item: AddressHistoryItem) => {
    setValidationError(null);
    setGeocodedLocation(null);
    if (inputRef.current) inputRef.current.value = item.street;
    pickedRef.current = true;
    onAddressSelect({
      street: item.street,
      city: item.city,
      state: item.state,
      zipCode: item.zipCode,
      lat: item.lat || 0,
      lng: item.lng || 0,
    });
    setShowHistory(false);
    setOpen(false);
    clear();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (validationError) setValidationError(null);
    if (geocodedLocation) setGeocodedLocation(null);
    pickedRef.current = false;
    if (status === "ready") {
      query(e.target.value);
      setOpen(true);
    }
  };

  const handleSuggestionPick = async (s: AddressSuggestion) => {
    setOpen(false);
    const parsed = await resolve(s);
    if (!parsed) {
      setValidationError("Could not load that address — type it in full and click Parse.");
      return;
    }
    pickedRef.current = true;
    setValidationError(null);
    setGeocodedLocation(parsed.formattedAddress || null);
    if (inputRef.current && parsed.street) inputRef.current.value = parsed.street;
    onAddressSelect({
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
      zipCode: parsed.zipCode,
      lat: parsed.lat ?? 0,
      lng: parsed.lng ?? 0,
    });
  };

  // Manual parse path — Nominatim first, then pure-JS parse.
  const parseManualEntry = async (raw?: string) => {
    const value = (raw ?? inputRef.current?.value ?? "").trim();
    if (!value) return;
    setBusy(true);
    const local = parseAddressString(value);
    try {
      const { data, error } = await supabase.functions.invoke("geocode-address", {
        body: { address: value, city: local.city, state: local.state, zip: local.zipCode },
      });
      if (error || !data) {
        emitFallback(local, value);
        return;
      }
      setGeocodedLocation(data.display_name || null);
      const remoteParsed =
        data.parsed && typeof data.parsed === "object" ? mergeAddressParts(data.parsed, local) : local;
      const finalStreet = remoteParsed.street || local.street || value;
      onAddressSelect({
        street: finalStreet,
        city: remoteParsed.city || local.city || "",
        state: remoteParsed.state || local.state || "",
        zipCode: remoteParsed.zipCode || local.zipCode || "",
        lat: typeof data.lat === "number" ? data.lat : 0,
        lng: typeof data.lng === "number" ? data.lng : 0,
      });
      if (inputRef.current && finalStreet) inputRef.current.value = finalStreet;
    } catch (err) {
      console.warn("[AddressAutocomplete:admin] geocode fallback failed", err);
      emitFallback(local, value);
    } finally {
      setBusy(false);
    }
  };

  const emitFallback = (parsed: ReturnType<typeof parseAddressString>, raw: string) => {
    onAddressSelect({
      street: parsed.street || raw,
      city: parsed.city || "",
      state: parsed.state || "",
      zipCode: parsed.zipCode || "",
      lat: 0,
      lng: 0,
    });
  };

  const handleInputBlur = async () => {
    setTimeout(() => setOpen(false), 150);
    if (pickedRef.current) return; // a suggestion/history pick already resolved
    await parseManualEntry();
  };

  return (
    <div className="space-y-2">
      {label ? (
        <div className="flex items-center justify-between">
          <Label htmlFor="address-autocomplete" className="text-xs font-semibold text-slate-700">
            {label}
          </Label>
          <div className="flex items-center gap-2">
            <StatusBadge state={status} />
            {addressHistory.length > 0 && (
              <Popover open={showHistory} onOpenChange={setShowHistory}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-xs text-slate-500 hover:text-slate-900">
                    <RiTimeLine className="w-3 h-3 mr-1" />
                    Recent
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-2" align="end">
                  <p className="text-xs font-medium text-slate-500 px-2 py-1">Recently used addresses</p>
                  <div className="space-y-1">
                    {addressHistory.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => handleHistorySelect(item)}
                        className="w-full text-left px-2 py-2 text-sm rounded-md hover:bg-slate-50"
                      >
                        <div className="flex items-start gap-2">
                          <RiMapPinLine className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          <span className="flex-1">{getHistoryItemDisplay(item)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      ) : (
        <div className="flex justify-end -mt-1">
          <StatusBadge state={status} />
        </div>
      )}

      <div className="relative">
        <Input
          ref={inputRef}
          id="address-autocomplete"
          type="text"
          placeholder={placeholder}
          defaultValue={initialValue}
          className="pr-10"
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={() => {
            setShowHistory(false);
            setValidationError(null);
            if (status === "ready" && suggestions.length > 0) setOpen(true);
          }}
          autoComplete="off"
        />
        <RiMapPinLine className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />

        {open && status === "ready" && suggestions.length > 0 && (
          <ul className="absolute z-[10000] left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSuggestionPick(s);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors flex items-start gap-2"
                >
                  <RiMapPinLine className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{s.primary}</span>
                    {s.secondary && <span className="block text-xs text-slate-500 truncate">{s.secondary}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status === "blocked" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 flex items-start gap-1.5">
          <RiErrorWarningLine className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Google Places blocked this domain. Type the address and click{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => parseManualEntry()}
              disabled={busy}
            >
              Parse manually
            </button>
            {" "}to autofill city / state / ZIP. Add{" "}
            <code className="bg-amber-100 px-1 rounded">*.novaracleaning.com/*</code>{" "}
            to the API key in Google Cloud Console.
          </span>
        </div>
      )}

      {status === "manual" && (
        <p className="text-[11px] text-slate-500">
          Type a full address (e.g. &quot;123 Main St, Frederick, MD 21703&quot;) and we&apos;ll split the parts on blur.
        </p>
      )}

      {validationError && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-700">
          <RiErrorWarningLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}

      {geocodedLocation && !validationError && (
        <div className="flex items-start gap-1.5 text-[11px] text-violet-700">
          <RiCheckboxCircleLine className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Confirmed: {geocodedLocation}</span>
        </div>
      )}
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: AddressAutocompleteStatus }) {
  const map: Record<AddressAutocompleteStatus, { label: string; cls: string; icon: JSX.Element }> = {
    loading: {
      label: "Loading Google Places…",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: <RiLoader4Line className="w-3 h-3 animate-spin" />,
    },
    ready: {
      label: "Google Places · ready",
      cls: "bg-violet-50 text-violet-700 border-violet-200",
      icon: <RiCheckboxCircleLine className="w-3 h-3" />,
    },
    manual: {
      label: "Manual parse · ready",
      cls: "bg-slate-50 text-slate-600 border-slate-200",
      icon: <RiMapPinLine className="w-3 h-3" />,
    },
    blocked: {
      label: "Domain not allow-listed",
      cls: "bg-amber-50 text-amber-800 border-amber-200",
      icon: <RiErrorWarningLine className="w-3 h-3" />,
    },
  };
  const cfg = map[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 border",
        cfg.cls,
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
