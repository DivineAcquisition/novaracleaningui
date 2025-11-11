import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home as HomeIcon, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";

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

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(1);
      navigate("/book/zip");
    },
    step: 2,
  });

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
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8">
        <Card className="shadow-xl animate-slide-in-right">
          <CardHeader className="text-center space-y-2 pb-6 px-4 md:px-6 md:pb-8">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 bg-primary/10 rounded-full flex items-center justify-center mb-3 md:mb-4">
              <HomeIcon className="w-7 h-7 md:w-8 md:h-8 text-primary" />
            </div>
            <CardTitle className="text-xl md:text-2xl font-bold">How big is your home?</CardTitle>
            <CardDescription className="text-sm">
              Select the size that best matches your space
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 px-4 md:px-6">
            <div className="grid gap-3 md:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {HOME_SIZE_RANGES.map((size, index) => (
                <Card
                  key={size.id}
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 animate-fade-in",
                    bookingData.homeSizeId === size.id && "ring-2 ring-primary shadow-lavender"
                  )}
                  style={{ animationDelay: `${index * 0.1}s` }}
                  onClick={() => handleSelect(size.id)}
                >
                  <CardContent className="p-4 md:p-6 space-y-3">
                    <div className="text-center">
                      <h3 className="text-lg font-bold text-foreground">{size.label}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{size.bedroomRange}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Desktop Navigation - Hidden on Mobile */}
            <div className="hidden md:flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="h-12 md:h-14"
              >
                <ArrowLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
      />
    </div>
  );
}
