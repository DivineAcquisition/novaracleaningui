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
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-2xl mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <MapPin className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold">Where do you need cleaning?</CardTitle>
            <CardDescription className="text-base">
              Enter your ZIP code to check availability in your area
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="zipCode" className="text-base font-medium">
                  ZIP Code
                </Label>
                <Input
                  id="zipCode"
                  type="text"
                  placeholder="Enter 5-digit ZIP code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  className="h-14 text-lg"
                  maxLength={5}
                  autoFocus
                />
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full h-14 text-base font-semibold"
                disabled={zipCode.length !== 5 || isValidating}
              >
                {isValidating ? "Checking availability..." : "Continue"}
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                We currently service the San Francisco Bay Area
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
