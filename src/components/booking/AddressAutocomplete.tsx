import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Clock } from "lucide-react";
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
}

interface AddressAutocompleteProps {
  onAddressSelect: (address: AddressComponents) => void;
  initialValue?: string;
  label?: string;
  placeholder?: string;
  error?: string;
}

// Helper function to load Google Maps script
function loadGoogleMapsScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.google && window.google.maps && window.google.maps.places) {
      resolve();
      return;
    }

    // Create script element
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    
    document.head.appendChild(script);
  });
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
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load address history
  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  useEffect(() => {
    const initAutocomplete = async () => {
      try {
        // Fetch the API key from edge function
        const { data, error: keyError } = await supabase.functions.invoke("google-places-key");
        
        if (keyError) throw keyError;
        if (!data?.apiKey) throw new Error("No API key received");

        // Load Google Maps API
        await loadGoogleMapsScript(data.apiKey);

        if (!inputRef.current) return;

        // Initialize autocomplete
        autocompleteRef.current = new google.maps.places.Autocomplete(
          inputRef.current,
          {
            componentRestrictions: { country: "us" },
            fields: ["address_components", "geometry", "formatted_address"],
            types: ["address"],
          }
        );

        // Listen for place selection
        autocompleteRef.current.addListener("place_changed", handlePlaceSelect);

        setLoading(false);
      } catch (err) {
        console.error("Error initializing Google Places:", err);
        setApiError("Failed to load address autocomplete. You can still enter the address manually.");
        setLoading(false);
      }
    };

    initAutocomplete();

    return () => {
      if (autocompleteRef.current && window.google) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []);

  const handlePlaceSelect = () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place || !place.address_components) {
      return;
    }

    // Parse address components
    let street = "";
    let city = "";
    let state = "";
    let zipCode = "";

    place.address_components.forEach((component) => {
      const types = component.types;

      if (types.includes("street_number")) {
        street = component.long_name;
      }
      if (types.includes("route")) {
        street += (street ? " " : "") + component.short_name;
      }
      if (types.includes("locality")) {
        city = component.long_name;
      }
      if (types.includes("administrative_area_level_1")) {
        state = component.short_name;
      }
      if (types.includes("postal_code")) {
        zipCode = component.long_name;
      }
    });

    // Format address before saving
    const formattedAddress = formatAddress({
      street,
      city,
      state,
      zipCode,
    });

    // Save to history (without lat/lng for customer bookings)
    saveAddressToHistory(formattedAddress);

    // Update history state
    setAddressHistory(getAddressHistory());

    onAddressSelect(formattedAddress);
  };

  const handleHistorySelect = (item: AddressHistoryItem) => {
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
          id="customer-address-autocomplete"
          type="text"
          placeholder={loading ? "Loading..." : placeholder}
          defaultValue={initialValue}
          disabled={loading}
          className="pr-10"
          onFocus={() => setShowHistory(false)}
        />
        <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>
      {loading && (
        <p className="text-xs text-muted-foreground">
          Loading address autocomplete...
        </p>
      )}
      {apiError && (
        <p className="text-xs text-amber-600">
          {apiError}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
