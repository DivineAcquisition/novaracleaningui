import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Home as HomeIcon, ArrowRight, ArrowLeft, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { HOME_SIZE_RANGES, getEstimatedHours, HOURLY_RATE } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { BookingFooter } from "@/components/booking/BookingFooter";


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
      
      <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8">
        <Card variant="outlined" className="animate-slide-in-right">
          <CardHeader className="text-center space-y-1.5 pb-4 px-3 md:px-6 md:pb-8">
            <div className="mx-auto w-12 h-12 md:w-16 md:h-16 bg-primary/10 rounded-full flex items-center justify-center mb-2 md:mb-4">
              <HomeIcon className="w-6 h-6 md:w-8 md:h-8 text-primary" />
            </div>
            <CardTitle className="text-base md:text-xl font-semibold font-jakarta">How big is your home?</CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Select the size that best matches your space
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4 md:space-y-6 px-3 md:px-6">
            <div className="grid grid-cols-1 gap-3 md:gap-4">
              {HOME_SIZE_RANGES.map((size) => {
                const isSelected = bookingData.homeSizeId === size.id;
                return (
                  <Card
                    key={size.id}
                    className={cn(
                      "cursor-pointer transition-all duration-200 hover:border-primary/60",
                      isSelected && "border-primary shadow-lavender"
                    )}
                    onClick={() => handleSelect(size.id)}
                  >
                    <CardContent className="p-4 md:p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="text-base md:text-lg font-semibold text-foreground mb-1">
                            {size.label}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            {size.bedroomRange}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-primary bg-primary/10 px-3 py-1.5 rounded-full">
                          <Clock className="w-4 h-4" />
                          <span className="text-sm font-medium">
                            ~{getEstimatedHours(size.id)} hrs
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
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
        continueDisabled={!bookingData.homeSizeId}
        continueText="Continue"
      />

      <BookingFooter />
    </div>
  );
}
