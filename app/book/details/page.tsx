"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, ArrowLeft, Home, Bed, Bath, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DWELLING_TYPES = ["House", "Apartment", "Condo", "Townhouse"];

export default function BookingDetails() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();

  const [isProcessing, setIsProcessing] = useState(false);
  const [bedrooms, setBedrooms] = useState(bookingData.bedrooms?.toString() || "");
  const [bathrooms, setBathrooms] = useState(bookingData.bathrooms?.toString() || "");
  const [dwellingType, setDwellingType] = useState(bookingData.dwellingType || "");
  const [hasPets, setHasPets] = useState(false);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");

  const handleContinue = async () => {
    if (!bedrooms || !bathrooms || !dwellingType) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await supabase
        .from("bookings")
        .update({
          bedrooms: parseInt(bedrooms),
          bathrooms: parseFloat(bathrooms),
          dwelling_type: dwellingType,
          special_instructions: specialInstructions,
          access_instructions: accessInstructions,
          has_pets: hasPets,
          status: "confirmed",
        })
        .eq("id", bookingData.bookingId);

      if (error) throw error;

      updateBookingData({
        bedrooms: parseInt(bedrooms),
        bathrooms: parseFloat(bathrooms),
        dwellingType,
      });

      setCurrentStep(6);
      router.push("/book/confirmation");
    } catch (error: any) {
      console.error("Details error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setCurrentStep(4);
    router.push("/book/checkout");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step 5 of 5</span>
            <span>Property Details</span>
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full" style={{ width: "100%" }} />
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="w-5 h-5" />
              Property Details
            </CardTitle>
            <CardDescription>Help us prepare for your cleaning</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Property Type */}
            <div className="space-y-3">
              <Label>Property Type</Label>
              <RadioGroup
                value={dwellingType}
                onValueChange={setDwellingType}
                className="grid grid-cols-2 gap-3"
              >
                {DWELLING_TYPES.map((type) => (
                  <div key={type} className="flex items-center">
                    <RadioGroupItem value={type} id={type} className="peer sr-only" />
                    <Label
                      htmlFor={type}
                      className="flex w-full items-center justify-center p-3 border rounded-lg cursor-pointer hover:bg-muted/50 peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5"
                    >
                      {type}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Rooms */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bedrooms" className="flex items-center gap-2">
                  <Bed className="w-4 h-4" />
                  Bedrooms
                </Label>
                <Input
                  id="bedrooms"
                  type="number"
                  min="0"
                  max="10"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bathrooms" className="flex items-center gap-2">
                  <Bath className="w-4 h-4" />
                  Bathrooms
                </Label>
                <Input
                  id="bathrooms"
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Pets */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="pets"
                checked={hasPets}
                onCheckedChange={(checked) => setHasPets(checked as boolean)}
              />
              <Label htmlFor="pets">I have pets</Label>
            </div>

            {/* Access Instructions */}
            <div className="space-y-2">
              <Label htmlFor="access">Access Instructions</Label>
              <Textarea
                id="access"
                value={accessInstructions}
                onChange={(e) => setAccessInstructions(e.target.value)}
                placeholder="e.g., Code for lockbox is 1234, key under mat..."
                rows={2}
              />
            </div>

            {/* Special Instructions */}
            <div className="space-y-2">
              <Label htmlFor="special">Special Instructions (optional)</Label>
              <Textarea
                id="special"
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Any areas to focus on or avoid?"
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button
            className="flex-1"
            onClick={handleContinue}
            disabled={isProcessing || !bedrooms || !bathrooms || !dwellingType}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                Complete Booking
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
