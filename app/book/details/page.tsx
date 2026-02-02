"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const DWELLING_TYPES = [
  { id: "House", icon: "ri-home-4-line", label: "House" },
  { id: "Apartment", icon: "ri-building-2-line", label: "Apartment" },
  { id: "Condo", icon: "ri-building-line", label: "Condo" },
  { id: "Townhouse", icon: "ri-building-4-line", label: "Townhouse" },
];

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
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5 w-fit">
            <div className="w-9 h-9 rounded-xl bg-primary glow-primary-sm flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <main className="container max-w-2xl mx-auto px-4 py-8 md:py-12">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">Step 5 of 5</span>
            <span className="font-medium">Property Details</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary glow-primary-sm rounded-full transition-all duration-500" style={{ width: "100%" }} />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <i className="ri-file-list-3-line text-primary text-3xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Property Details</h1>
          <p className="text-muted-foreground">Help us prepare for your cleaning</p>
        </div>

        {/* Property Type */}
        <Card className="card-premium mb-6">
          <CardContent className="p-5">
            <Label className="text-sm font-medium mb-3 block">Property Type</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {DWELLING_TYPES.map((type) => {
                const isSelected = dwellingType === type.id;
                return (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setDwellingType(type.id)}
                    className={cn(
                      "p-4 rounded-xl border-2 text-center transition-all duration-200",
                      isSelected
                        ? "border-primary bg-primary/5 glow-primary-sm"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <i className={cn(type.icon, "text-2xl mb-2", isSelected ? "text-primary" : "text-muted-foreground")}></i>
                    <p className={cn("text-sm font-medium", isSelected && "text-primary")}>{type.label}</p>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Room Details */}
        <Card className="card-premium mb-6">
          <CardContent className="p-5">
            <Label className="text-sm font-medium mb-3 block">Room Details</Label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <i className="ri-hotel-bed-line"></i>
                  Bedrooms
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  placeholder="0"
                  className="h-12 text-lg border-2 focus:border-primary"
                />
              </div>
              <div>
                <Label className="text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <i className="ri-drop-line"></i>
                  Bathrooms
                </Label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  placeholder="0"
                  className="h-12 text-lg border-2 focus:border-primary"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Additional Info */}
        <Card className="card-premium mb-8">
          <CardContent className="p-5 space-y-5">
            {/* Pets */}
            <div className="flex items-center space-x-3 p-4 rounded-xl border border-border/50 bg-muted/30">
              <Checkbox
                id="pets"
                checked={hasPets}
                onCheckedChange={(checked) => setHasPets(checked as boolean)}
              />
              <Label htmlFor="pets" className="flex items-center gap-2 cursor-pointer">
                <i className="ri-bear-smile-line text-lg text-muted-foreground"></i>
                I have pets
              </Label>
            </div>

            {/* Access Instructions */}
            <div>
              <Label className="text-sm font-medium mb-2 flex items-center gap-2">
                <i className="ri-key-line text-muted-foreground"></i>
                Access Instructions
              </Label>
              <Textarea
                value={accessInstructions}
                onChange={(e) => setAccessInstructions(e.target.value)}
                placeholder="e.g., Code for lockbox is 1234, key under mat..."
                rows={2}
                className="border-2 focus:border-primary resize-none"
              />
            </div>

            {/* Special Instructions */}
            <div>
              <Label className="text-sm font-medium mb-2 flex items-center gap-2">
                <i className="ri-sticky-note-line text-muted-foreground"></i>
                Special Instructions (optional)
              </Label>
              <Textarea
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Any areas to focus on or avoid?"
                rows={3}
                className="border-2 focus:border-primary resize-none"
              />
            </div>
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleBack} className="h-12 px-6">
            <i className="ri-arrow-left-line mr-2"></i>
            Back
          </Button>
          <Button
            className="flex-1 h-12 glow-primary-sm"
            onClick={handleContinue}
            disabled={isProcessing || !bedrooms || !bathrooms || !dwellingType}
          >
            {isProcessing ? (
              <>
                <i className="ri-loader-4-line animate-spin mr-2"></i>
                Completing...
              </>
            ) : (
              <>
                Complete Booking
                <i className="ri-check-line ml-2"></i>
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  );
}
