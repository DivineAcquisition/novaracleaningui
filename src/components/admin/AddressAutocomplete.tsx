"use client";

// ─── Admin address autocomplete (v2 — 2026-05-26) ─────────────────────
//
// Premium SaaS-styled wrapper around Google Places Autocomplete with a
// robust fallback chain so the internal booking form always gets a
// usable City / State / ZIP even when Google Places isn't reachable
// (e.g. the API key has HTTP-referrer restrictions that haven't been
// extended to admin.novaracleaning.com yet).
//
// Resolution order (best → fallback):
//   1. Google Places suggestion picked from the dropdown → returns
//      address_components → onAddressSelect with street + city + state +
//      zip + lat + lng.
//   2. User blurs the input (or pressed Enter): call geocode-address
//      Edge Function (Nominatim) which returns a `parsed` object with
//      the same shape PLUS lat/lng.
//   3. Local parseAddressString as a last resort — pulls City / State /
//      ZIP out of a freeform "123 Main St, Frederick, MD 21703" entry.
//
// A small status pill above the input makes it obvious which path is
// active so a VA never has to wonder "is Google working right now?".

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
import { loadGooglePlaces, parsePlaceResult } from "@/lib/google-places-loader";
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

type LoadState = "loading" | "ready" | "manual" | "blocked";

export function AddressAutocomplete({
  onAddressSelect,
  initialValue = "",
  label = "Street Address *",
  placeholder = "Start typing the customer's address…",
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  // Google Places must own an uncontrolled input — parent re-renders on
  // every keystroke make the field look disabled/grey and break search.
  const initialStreetRef = useRef(initialValue);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  // Wire Google's gm_authFailure once per page so referrer-blocked keys
  // produce a visible "manual entry" badge instead of a silent failure.
  useEffect(() => {
    const w = window as any;
    if (w.__novaraGmAuthFailureHooked) return;
    w.__novaraGmAuthFailureHooked = true;
    const prior = w.gm_authFailure;
    w.gm_authFailure = () => {
      console.warn(
        "[google-places] gm_authFailure — admin domain likely not allow-listed",
      );
      w.__novaraGmAuthFailed = true;
      try { prior?.(); } catch { /* ignore */ }
    };
  }, []);

  // Wire Google Places Autocomplete. Always falls back gracefully.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const places = await loadGooglePlaces();
      if (cancelled) return;
      if ((window as any).__novaraGmAuthFailed) {
        setLoadState("blocked");
        return;
      }
      if (!places) {
        setLoadState("manual");
        return;
      }
      if (!inputRef.current) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      if (!inputRef.current) {
        setLoadState("manual");
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
            setValidationError("Pick an address from the dropdown to autofill the fields");
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
            lat: parsed.lat ?? 0,
            lng: parsed.lng ?? 0,
          });
        });
        setLoadState("ready");
      } catch (err) {
        console.warn("[AddressAutocomplete:admin] Google Places init failed", err);
        setLoadState("manual");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect post-load auth failure (gm_authFailure may fire after the
  // Autocomplete is wired but before the user gets results). Poll once
  // a second for the first 6 seconds.
  useEffect(() => {
    if (loadState !== "ready") return;
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      if ((window as any).__novaraGmAuthFailed) {
        setLoadState("blocked");
        clearInterval(t);
      }
      if (ticks > 6) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [loadState]);

  const handleHistorySelect = (item: AddressHistoryItem) => {
    setValidationError(null);
    setGeocodedLocation(null);
    if (inputRef.current) inputRef.current.value = item.street;
    onAddressSelect({
      street: item.street,
      city: item.city,
      state: item.state,
      zipCode: item.zipCode,
      lat: item.lat || 0,
      lng: item.lng || 0,
    });
    setShowHistory(false);
  };

  const handleInputChange = () => {
    if (validationError) setValidationError(null);
    if (geocodedLocation) setGeocodedLocation(null);
  };

  // Hydrate from parent once (e.g. lead load) without tying to keystrokes.
  useEffect(() => {
    if (!initialValue || !inputRef.current) return;
    if (!inputRef.current.value.trim()) {
      inputRef.current.value = initialValue;
      initialStreetRef.current = initialValue;
    }
  }, [initialValue]);

  // Manual parse path — always runs whether Google loaded or not. Used by
  // onBlur when the user typed but didn't pick from the Google dropdown,
  // and by the "Parse this address" button when Google is blocked. Hits
  // geocode-address (Nominatim) first, then falls back to a pure-JS parse.
  const parseManualEntry = async (raw?: string) => {
    const value = (raw ?? inputRef.current?.value ?? "").trim();
    if (!value) return;
    setBusy(true);
    const local = parseAddressString(value);
    try {
      const { data, error } = await supabase.functions.invoke(
        "geocode-address",
        {
          body: {
            address: value,
            city: local.city,
            state: local.state,
            zip: local.zipCode,
          },
        },
      );
      if (error || !data) {
        emitFallback(local, value);
        return;
      }
      setGeocodedLocation(data.display_name || null);
      const remoteParsed =
        data.parsed && typeof data.parsed === "object"
          ? mergeAddressParts(data.parsed, local)
          : local;
      const finalStreet = remoteParsed.street || local.street || value;
      onAddressSelect({
        street: finalStreet,
        city: remoteParsed.city || local.city || "",
        state: remoteParsed.state || local.state || "",
        zipCode: remoteParsed.zipCode || local.zipCode || "",
        lat: typeof data.lat === "number" ? data.lat : 0,
        lng: typeof data.lng === "number" ? data.lng : 0,
      });
      if (inputRef.current && finalStreet) {
        inputRef.current.value = finalStreet;
      }
    } catch (err) {
      console.warn("[AddressAutocomplete:admin] geocode fallback failed", err);
      emitFallback(local, value);
    } finally {
      setBusy(false);
    }
  };

  const emitFallback = (
    parsed: ReturnType<typeof parseAddressString>,
    raw: string,
  ) => {
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
    // Only skip when the user already picked a Places suggestion.
    // If they typed manually while Google is "ready", still geocode.
    if (loadState === "ready" && geocodedLocation) return;
    await parseManualEntry();
  };

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {label ? (
        <div className="flex items-center justify-between">
          <Label htmlFor="address-autocomplete" className="text-xs font-semibold text-slate-700">
            {label}
          </Label>
          <div className="flex items-center gap-2">
            <StatusBadge state={loadState} />
            {addressHistory.length > 0 && (
              <Popover open={showHistory} onOpenChange={setShowHistory}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto py-1 px-2 text-xs text-slate-500 hover:text-slate-900"
                  >
                    <RiTimeLine className="w-3 h-3 mr-1" />
                    Recent
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-2" align="end">
                  <p className="text-xs font-medium text-slate-500 px-2 py-1">
                    Recently used addresses
                  </p>
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
          <StatusBadge state={loadState} />
        </div>
      )}

      <div className="relative">
        <Input
          ref={inputRef}
          id="address-autocomplete"
          type="text"
          placeholder={placeholder}
          defaultValue={initialStreetRef.current}
          className="pr-10"
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onFocus={() => {
            setShowHistory(false);
            setValidationError(null);
          }}
          autoComplete="off"
        />
        <RiMapPinLine className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      </div>

      {loadState === "blocked" && (
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

      {loadState !== "blocked" && loadState !== "ready" && (
        <p className="text-[11px] text-slate-500">
          Type a full address (e.g. "123 Main St, Frederick, MD 21703") and we'll
          split the parts on blur.
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

// ─── Status badge ────────────────────────────────────────────────────

function StatusBadge({ state }: { state: LoadState }) {
  const map: Record<LoadState, { label: string; cls: string; icon: JSX.Element }> = {
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
