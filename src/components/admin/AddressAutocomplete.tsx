import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError("Failed to load address autocomplete. You can still enter the address manually.");
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
    if (!place || !place.address_components || !place.geometry?.location) {
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

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    onAddressSelect({
      street,
      city,
      state,
      zipCode,
      lat,
      lng,
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="address-autocomplete">{label}</Label>
      <div className="relative">
        <Input
          ref={inputRef}
          id="address-autocomplete"
          type="text"
          placeholder={loading ? "Loading..." : placeholder}
          defaultValue={initialValue}
          disabled={loading}
          className="pr-10"
        />
        <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      </div>
      {loading && (
        <p className="text-xs text-muted-foreground">
          Loading Google Places autocomplete...
        </p>
      )}
      {error && (
        <p className="text-xs text-amber-600">
          {error}
        </p>
      )}
    </div>
  );
}
