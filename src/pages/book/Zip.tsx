import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingZip() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [zipCode, setZipCode] = useState(bookingData.zipCode || "");
  const [isValidating, setIsValidating] = useState(false);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    canSwipeRight: false, // First step, can't go back
    step: 1,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (zipCode.length !== 5 || !/^\d+$/.test(zipCode)) {
      toast.error("Please enter a valid 5-digit ZIP code");
      return;
    }

    setIsValidating(true);
    
    // Simulate ZIP validation
    setTimeout(() => {
      updateBookingData({ zipCode });
      setCurrentStep(2);
      navigate("/book/home");
      setIsValidating(false);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-2xl mx-auto px-3 md:px-6 py-4 md:py-8">
        <Card variant="outlined" className="animate-slide-in-right">
          <CardHeader className="text-center space-y-1.5 pb-4 px-3 md:px-6 md:pb-8">
            <div className="mx-auto w-12 h-12 md:w-16 md:h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2 md:mb-4">
              <MapPin className="w-6 h-6 md:w-8 md:h-8 text-primary" />
            </div>
            <CardTitle className="text-lg md:text-2xl font-bold">Where do you need cleaning?</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Enter your ZIP code to check availability in your area
            </CardDescription>
          </CardHeader>
          
          <CardContent className="px-3 md:px-6">
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
              <div className="space-y-1.5 md:space-y-2">
                <Label htmlFor="zipCode" className="text-xs md:text-sm font-medium">
                  ZIP Code
                </Label>
                <Input
                  id="zipCode"
                  type="text"
                  placeholder="Enter 5-digit ZIP code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  className="h-11 md:h-14 text-sm md:text-lg"
                  maxLength={5}
                  autoFocus
                />
              </div>

              {/* Desktop Submit Button */}
              <Button
                type="submit"
                size="lg"
                className="hidden md:flex w-full h-12 md:h-14 text-sm md:text-base font-semibold"
                disabled={zipCode.length !== 5 || isValidating}
              >
                {isValidating ? "Checking availability..." : "Continue"}
                <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
              </Button>

              <p className="text-center text-xs md:text-sm text-muted-foreground">
                We currently service the San Francisco Bay Area
              </p>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onContinue={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
        continueDisabled={zipCode.length !== 5 || isValidating}
        continueText={isValidating ? "Checking..." : "Continue"}
      />
    </div>
  );
}
