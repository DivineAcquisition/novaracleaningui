import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ArrowRight, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBooking } from "@/contexts/BookingContext";
import { US_STATES } from "@/lib/us-states";

const DWELLING_TYPES = [
  { value: 'house', label: 'House' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'condo', label: 'Condo' },
  { value: 'office_space', label: 'Office Space' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'mansion', label: 'Mansion' },
];

const PETS_OPTIONS = [
  { value: 'none', label: 'No Pets' },
  { value: 'dog', label: 'Dog(s)' },
  { value: 'cat', label: 'Cat(s)' },
  { value: 'multiple', label: 'Multiple Pets' },
  { value: 'other', label: 'Other Pets' },
];

const FLOORING_TYPES = [
  { value: 'hardwood', label: 'Hardwood' },
  { value: 'carpet', label: 'Carpet' },
  { value: 'tile', label: 'Tile' },
  { value: 'laminate', label: 'Laminate' },
  { value: 'vinyl', label: 'Vinyl/LVP' },
  { value: 'mixed', label: 'Mixed Flooring' },
  { value: 'other', label: 'Other' },
];

export default function PropertyDetails() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const { bookingData } = useBooking();
  
  const [address, setAddress] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [state, setState] = useState<string>("");
  const [bedrooms, setBedrooms] = useState<string>("");
  const [bathrooms, setBathrooms] = useState<string>("");
  const [dwellingType, setDwellingType] = useState<string>("");
  const [flooringType, setFlooringType] = useState<string>("");
  const [pets, setPets] = useState<string>("none");
  const [accessNotes, setAccessNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!bookingId) {
      toast.error("No booking ID found");
      navigate("/");
    }
  }, [bookingId, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!address || !city || !state || !bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (!bookingId) {
      toast.error("Invalid booking");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          address,
          city,
          state,
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
          flooring_type: flooringType || null,
          pets,
          access_notes: accessNotes || null,
        })
        .eq("id", bookingId);

      if (error) throw error;

      toast.success("Details saved successfully!");
      navigate("/book/confirmation?booking_id=" + bookingId);
    } catch (error) {
      console.error("Error saving details:", error);
      toast.error("Failed to save details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero px-3 md:px-4 py-5 sm:py-8 md:py-12 flex items-center justify-center">
      <Card variant="outlined" className="max-w-lg w-full shadow-card animate-fade-in">
        <CardHeader className="text-center space-y-2 sm:space-y-4 pb-4 sm:pb-6 px-4 sm:px-6">
          <div className="mx-auto w-12 h-12 sm:w-16 sm:h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 sm:w-10 sm:h-10 text-primary" />
          </div>
          <CardTitle className="text-base sm:text-lg md:text-xl font-semibold">Property & Address Details</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Complete your booking with property information
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 sm:px-6">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            {/* Service Address */}
            <div className="space-y-3 sm:space-y-4">
              <h3 className="text-sm sm:text-base md:text-lg font-semibold">Service Address</h3>
              
              <div className="space-y-1 sm:space-y-2">
                <Label htmlFor="address" className="text-xs sm:text-sm">
                  Street Address <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <MapPin className="absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                  <Input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="pl-8 sm:pl-10 h-10 sm:h-12 text-sm sm:text-base"
                    placeholder="123 Main St"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="city" className="text-xs sm:text-sm">
                    City <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="h-10 sm:h-12 text-sm sm:text-base"
                    placeholder="City"
                    required
                  />
                </div>

                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="state" className="text-xs sm:text-sm">
                    State <span className="text-destructive">*</span>
                  </Label>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger id="state" className="h-10 sm:h-12 text-sm sm:text-base">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 sm:space-y-2 col-span-2 sm:col-span-1">
                  <Label htmlFor="zip" className="text-xs sm:text-sm">ZIP Code</Label>
                  <Input
                    id="zip"
                    value={bookingData.zipCode}
                    className="h-10 sm:h-12 bg-muted text-sm sm:text-base"
                    disabled
                  />
                </div>
              </div>
            </div>

            {/* Property Details */}
            <div className="space-y-3 sm:space-y-4 border-t pt-4 sm:pt-6">
              <h3 className="text-sm sm:text-base md:text-lg font-semibold">Property Information</h3>
            
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="bedrooms" className="text-xs sm:text-sm">
                    Bedrooms <span className="text-destructive">*</span>
                  </Label>
                  <Select value={bedrooms} onValueChange={setBedrooms}>
                    <SelectTrigger id="bedrooms" className="h-10 sm:h-12 text-sm sm:text-base">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} {num === 1 ? 'bed' : 'beds'}
                        </SelectItem>
                      ))}
                      <SelectItem value="10+">10+ beds</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="bathrooms" className="text-xs sm:text-sm">
                    Bathrooms <span className="text-destructive">*</span>
                  </Label>
                  <Select value={bathrooms} onValueChange={setBathrooms}>
                    <SelectTrigger id="bathrooms" className="h-10 sm:h-12 text-sm sm:text-base">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num} {num === 1 ? 'bath' : 'baths'}
                        </SelectItem>
                      ))}
                      <SelectItem value="5+">5+ baths</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label htmlFor="dwellingType" className="text-xs sm:text-sm">
                  Dwelling Type <span className="text-destructive">*</span>
                </Label>
                <Select value={dwellingType} onValueChange={setDwellingType}>
                  <SelectTrigger id="dwellingType" className="h-10 sm:h-12 text-sm sm:text-base">
                    <SelectValue placeholder="Select dwelling type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DWELLING_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="flooringType" className="text-xs sm:text-sm">
                    Flooring Type
                  </Label>
                  <Select value={flooringType} onValueChange={setFlooringType}>
                    <SelectTrigger id="flooringType" className="h-10 sm:h-12 text-sm sm:text-base">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {FLOORING_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1 sm:space-y-2">
                  <Label htmlFor="pets" className="text-xs sm:text-sm">
                    Pets <span className="text-destructive">*</span>
                  </Label>
                  <Select value={pets} onValueChange={setPets}>
                    <SelectTrigger id="pets" className="h-10 sm:h-12 text-sm sm:text-base">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {PETS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1 sm:space-y-2">
                <Label htmlFor="accessNotes" className="text-xs sm:text-sm">
                  Access Notes
                </Label>
                <Textarea
                  id="accessNotes"
                  value={accessNotes}
                  onChange={(e) => setAccessNotes(e.target.value)}
                  placeholder="Gate code, parking instructions..."
                  className="min-h-[60px] sm:min-h-[80px] resize-none text-sm sm:text-base"
                />
                <p className="text-[10px] sm:text-xs text-muted-foreground">
                  Optional: Provide entry instructions
                </p>
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || !address || !city || !state || !bedrooms || !bathrooms || !dwellingType}
              className="w-full h-11 sm:h-12 md:h-14 text-sm sm:text-base font-semibold"
            >
              {isSubmitting ? "Saving..." : "Complete Booking"}
              <ArrowRight className="ml-2 w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
