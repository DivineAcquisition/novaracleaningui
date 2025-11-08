import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
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
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-md mx-auto px-3 py-4 lg:px-4 lg:py-8 pb-32 lg:pb-8">
        <Card className="animate-fade-in border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-primary to-primary/60">
                <MapPin className="w-5 h-5 lg:w-6 lg:h-6 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-xl lg:text-3xl">Where do you need cleaning?</CardTitle>
                <CardDescription className="text-sm lg:text-base">Enter your ZIP code to check availability</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="zipCode" className="text-sm lg:text-base">ZIP Code</Label>
                <Input
                  id="zipCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  placeholder="Enter 5-digit ZIP code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  className="text-lg h-12"
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full h-12 hidden lg:flex"
                disabled={zipCode.length !== 5 || isValidating}
              >
                {isValidating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Continue'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        onContinue={() => handleSubmit()}
        continueDisabled={zipCode.length !== 5 || isValidating}
        continueLabel={isValidating ? "Checking..." : "Continue"}
        showBack={false}
      />
    </div>
  );
}
