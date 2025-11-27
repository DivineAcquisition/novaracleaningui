import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Clock, AlertCircle } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";

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
    if ((window as any).google?.maps?.places) {
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
  const autocompleteRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [addressHistory, setAddressHistory] = useState<AddressHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load address history
  useEffect(() => {
    setAddressHistory(getAddressHistory());
  }, []);

  useEffect(() => {
    const initAutocomplete = async () => {
      try {
        // Fetch the API key from edge function with fallback
        let apiKey: string | null = null;
        
        try {
          const { data, error: keyError } = await supabase.functions.invoke("google-places-key");
          if (keyError) throw keyError;
          apiKey = data?.apiKey;
        } catch (invokeError) {
          console.warn("Function invoke failed, trying direct fetch:", invokeError);
          
          // Get session token for authorization
          const { data: { session } } = await supabase.auth.getSession();
          const authHeader = session?.access_token 
            ? `Bearer ${session.access_token}` 
            : '';
          
          // Fallback to direct fetch with authorization
          const response = await fetch(
            "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/google-places-key",
            {
              headers: {
                "Content-Type": "application/json",
                "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I",
                ...(authHeader && { "authorization": authHeader }),
              },
            }
          );
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const data = await response.json();
          apiKey = data?.apiKey;
        }
        
        if (!apiKey) throw new Error("No API key received");

        // Load Google Maps API
        await loadGoogleMapsScript(apiKey);

        if (!inputRef.current) return;

        // Initialize autocomplete
        const google = (window as any).google;
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
      if (autocompleteRef.current && (window as any).google) {
        const google = (window as any).google;
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []);

  const handlePlaceSelect = () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place || !place.address_components) {
      return;
    }

    // Clear previous validation error
    setValidationError(null);

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

    // Validate that all required fields are present
    const missingFields: string[] = [];
    if (!street) missingFields.push("street address");
    if (!city) missingFields.push("city");
    if (!state) missingFields.push("state");
    if (!zipCode) missingFields.push("ZIP code");

    if (missingFields.length > 0) {
      setValidationError(
        `Incomplete address: missing ${missingFields.join(", ")}. Please select a complete address from the suggestions.`
      );
      return;
    }

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
    // Clear validation error when selecting from history
    setValidationError(null);
    
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
      
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-48" />
        </div>
      ) : (
        <>
          <div className="relative">
            <Input
              ref={inputRef}
              id="customer-address-autocomplete"
              type="text"
              placeholder={placeholder}
              defaultValue={initialValue}
              className="pr-10"
              onFocus={() => {
                setShowHistory(false);
                setValidationError(null);
              }}
            />
            <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
          
          {apiError && (
            <div className="flex items-start gap-2 text-xs text-amber-600">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{apiError}</span>
            </div>
          )}
          
          {validationError && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}
          
          {error && (
            <div className="flex items-start gap-2 text-xs text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
