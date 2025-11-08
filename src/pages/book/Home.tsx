import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { ArrowLeft, Home as HomeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
    // If >5,000 sqft, redirect to custom quote page
    if (sizeId === '5000_plus') {
      navigate("/book/custom-quote");
      return;
    }
    
    updateBookingData({ homeSizeId: sizeId });
    setCurrentStep(3);
    navigate("/book/service");
  };

  const handleBack = () => {
    setCurrentStep(1);
    navigate("/book/zip");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-6xl mx-auto px-3 py-4 lg:px-4 lg:py-8 pb-32 lg:pb-8">
        <Card className="animate-fade-in border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-primary to-primary/60">
                <HomeIcon className="w-5 h-5 lg:w-6 lg:h-6 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-xl lg:text-3xl">How big is your home?</CardTitle>
                <CardDescription className="text-sm lg:text-base">Select the size that best matches your space</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4 mb-6">
              {HOME_SIZE_RANGES.map((size, index) => (
                <Card
                  key={size.id}
                  className={cn(
                    "cursor-pointer hover:border-primary transition-all hover:shadow-md group active:scale-95 animate-fade-in",
                    bookingData.homeSizeId === size.id && "border-primary bg-primary/5"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => handleSelect(size.id)}
                >
                  <CardContent className="p-4 lg:p-6 space-y-2">
                    <div className="text-lg lg:text-xl font-bold group-hover:text-primary transition-colors">
                      {size.label}
                    </div>
                    <div className="text-xs lg:text-sm text-muted-foreground">
                      {size.bedroomRange}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Button
              variant="outline"
              size="lg"
              onClick={handleBack}
              className="w-full h-12 hidden lg:flex"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        onBack={handleBack}
        onContinue={() => {}}
        continueDisabled={true}
        showBack={true}
      />
    </div>
  );
}
