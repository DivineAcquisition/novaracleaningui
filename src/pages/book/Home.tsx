import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home as HomeIcon, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingHome() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();

  const handleSelect = (sizeId: string) => {
    updateBookingData({ homeSizeId: sizeId });
    setCurrentStep(3);
    navigate("/book/service");
  };

  const handleBack = () => {
    setCurrentStep(1);
    navigate("/book/zip");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="text-center space-y-2 pb-8">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <HomeIcon className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold">How big is your home?</CardTitle>
            <CardDescription className="text-base">
              Select the size that best matches your space
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {HOME_SIZE_RANGES.map((size) => (
                <Card
                  key={size.id}
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105",
                    bookingData.homeSizeId === size.id && "ring-2 ring-primary shadow-lg"
                  )}
                  onClick={() => handleSelect(size.id)}
                >
                  <CardContent className="p-6 space-y-3">
                    <div className="text-center">
                      <h3 className="text-lg font-bold text-foreground">{size.label}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{size.bedroomRange}</p>
                    </div>
                    <div className="pt-3 border-t">
                      <p className="text-xs text-muted-foreground">{size.baseHours > 0 ? `${size.baseHours} hours` : 'Custom quote'}</p>
                      {size.baseHours > 0 && (
                        <p className="text-sm text-muted-foreground mt-1">${size.standardPrice} standard</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="h-14"
              >
                <ArrowLeft className="mr-2 w-5 h-5" />
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
