"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Clock, AlertCircle, CheckCircle } from "lucide-react";
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
import { formatAddress } from "@/lib/address-formatter";

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
  placeholder = "Start typing address...",
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [geocodedLocation, setGeocodedLocation] = useState<string | null>(null);

  // Load address history
  useEffect(() => {
    setAddressHistory(getAddressHistory());
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
      lat: item.lat || 0,
      lng: item.lng || 0,
    });

    setShowHistory(false);
  };

  const handleInputChange = () => {
    // Clear validation error on input change
    setValidationError(null);
    setGeocodedLocation(null);
  };

  const handleInputBlur = async () => {
    const value = inputRef.current?.value?.trim();
    if (value) {
      try {
        // Try to geocode the manually entered address
        console.log('[AddressAutocomplete] Attempting geocode fallback for:', value);
        
        const { data, error } = await supabase.functions.invoke('geocode-address', {
          body: { 
            address: value,
            city: "",
            state: "",
            zip: ""
          }
        });

        if (error) {
          console.error('[AddressAutocomplete] Geocode error:', error);
          // Still accept the address with default coordinates
          onAddressSelect({
            street: value,
            city: "",
            state: "",
            zipCode: "",
            lat: 0,
            lng: 0,
          });
        } else if (data) {
          console.log('[AddressAutocomplete] Geocode success:', data);
          setGeocodedLocation(data.display_name || null);
          onAddressSelect({
            street: value,
            city: "",
            state: "",
            zipCode: "",
            lat: data.lat || 0,
            lng: data.lng || 0,
          });
        }
      } catch (error) {
        console.error('[AddressAutocomplete] Geocode fallback failed:', error);
        // Still accept the address with default coordinates
        onAddressSelect({
          street: value,
          city: "",
          state: "",
          zipCode: "",
          lat: 0,
          lng: 0,
        });
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="address-autocomplete">{label}</Label>
        {addressHistory.length > 0 && (
          <Popover open={showHistory} onOpenChange={setShowHistory}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <Clock className="w-3 h-3 mr-1" />
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
                      <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
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
          }}
        />
        <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>
      
      {validationError && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{validationError}</span>
        </div>
      )}
      
      {geocodedLocation && !validationError && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
          <span>Confirmed: {geocodedLocation}</span>
        </div>
      )}
    </div>
  );
}
