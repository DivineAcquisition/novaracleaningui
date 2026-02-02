"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageTransition } from "@/components/booking/PageTransition";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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

function PropertyDetailsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  
  const [bedrooms, setBedrooms] = useState<string>("");
  const [bathrooms, setBathrooms] = useState<string>("");
  const [dwellingType, setDwellingType] = useState<string>("");
  const [flooringType, setFlooringType] = useState<string>("");
  const [pets, setPets] = useState<string>("none");
  const [accessNotes, setAccessNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all required fields");
      return;
    }

    const currentBookingId = bookingId || bookingData.bookingId;
    if (!currentBookingId) {
      toast.error("Invalid booking");
      router.push("/book/sqft");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
          flooring_type: flooringType || null,
          pets,
          access_notes: accessNotes || null,
          status: "confirmed",
        })
        .eq("id", currentBookingId);

      if (error) throw error;

      updateBookingData({
        bedrooms: parseInt(bedrooms),
        bathrooms: parseFloat(bathrooms),
        dwellingType,
      });

      toast.success("Details saved successfully!");
      setCurrentStep(6);
      router.push("/book/confirmation?booking_id=" + currentBookingId);
    } catch (error) {
      console.error("Error saving details:", error);
      toast.error("Failed to save details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 px-3 md:px-4 py-8 md:py-12 flex items-center justify-center">
        <Card className="max-w-lg w-full shadow-lg animate-fade-in">
          <CardHeader className="text-center space-y-4 pb-6">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <i className="ri-checkbox-circle-line text-primary text-3xl"></i>
            </div>
            <CardTitle className="text-lg md:text-xl font-semibold">Property & Address Details</CardTitle>
            <CardDescription className="text-sm">
              Complete your booking with property information
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Property Details */}
              <div className="space-y-4">
                <h3 className="text-base md:text-lg font-semibold flex items-center gap-2">
                  <i className="ri-home-4-line text-primary"></i>
                  Property Information
                </h3>
              
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bedrooms">
                      Bedrooms <span className="text-destructive">*</span>
                    </Label>
                    <Select value={bedrooms} onValueChange={setBedrooms}>
                      <SelectTrigger id="bedrooms" className="h-12">
                        <SelectValue placeholder="Select bedrooms" />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                          <SelectItem key={num} value={num.toString()}>
                            {num} {num === 1 ? 'bedroom' : 'bedrooms'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bathrooms">
                      Bathrooms <span className="text-destructive">*</span>
                    </Label>
                    <Select value={bathrooms} onValueChange={setBathrooms}>
                      <SelectTrigger id="bathrooms" className="h-12">
                        <SelectValue placeholder="Select bathrooms" />
                      </SelectTrigger>
                      <SelectContent>
                        {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((num) => (
                          <SelectItem key={num} value={num.toString()}>
                            {num} {num === 1 ? 'bathroom' : 'bathrooms'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dwellingType">
                    Dwelling Type <span className="text-destructive">*</span>
                  </Label>
                  <Select value={dwellingType} onValueChange={setDwellingType}>
                    <SelectTrigger id="dwellingType" className="h-12">
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

                <div className="space-y-2">
                  <Label htmlFor="flooringType">Primary Flooring Type</Label>
                  <Select value={flooringType} onValueChange={setFlooringType}>
                    <SelectTrigger id="flooringType" className="h-12">
                      <SelectValue placeholder="Select flooring type" />
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

                <div className="space-y-2">
                  <Label htmlFor="pets">Pets at Property</Label>
                  <Select value={pets} onValueChange={setPets}>
                    <SelectTrigger id="pets" className="h-12">
                      <SelectValue placeholder="Select pets" />
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

                <div className="space-y-2">
                  <Label htmlFor="accessNotes">Access Notes</Label>
                  <Textarea
                    id="accessNotes"
                    value={accessNotes}
                    onChange={(e) => setAccessNotes(e.target.value)}
                    placeholder="Gate code, key location, parking instructions, or any special entry instructions..."
                    className="min-h-[80px] resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional: Provide entry instructions for our cleaning team
                  </p>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || !bedrooms || !bathrooms || !dwellingType}
                className="w-full h-12 md:h-14 text-base font-semibold"
              >
                {isSubmitting ? (
                  <>
                    <i className="ri-loader-4-line animate-spin mr-2"></i>
                    Saving...
                  </>
                ) : (
                  <>
                    Complete Booking
                    <i className="ri-arrow-right-line ml-2"></i>
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageTransition>
  );
}

export default function PropertyDetails() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <i className="ri-loader-4-line text-3xl animate-spin text-primary"></i>
      </div>
    }>
      <PropertyDetailsContent />
    </Suspense>
  );
}
