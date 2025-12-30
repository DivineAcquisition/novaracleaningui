import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home as HomeIcon, ArrowRight, CheckCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PromoBanner } from "@/components/booking/PromoBanner";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PageTransition } from "@/components/booking/PageTransition";

const BOOKING_STEPS = [
  { number: 1, label: "Location", path: "/book/zip" },
  { number: 2, label: "Home Size", path: "/book/sqft" },
  { number: 3, label: "Service", path: "/book/offer" },
  { number: 4, label: "Checkout", path: "/book/checkout" },
  { number: 5, label: "Details", path: "/book/details" },
  { number: 6, label: "Confirm", path: "/book/confirmation" },
];

export default function BookingHome() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(1);
      navigate("/");
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
    navigate("/book/offer");
  };

  const handleBack = () => {
    setCurrentStep(1);
    navigate("/");
  };

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-muted/30 pb-32 md:pb-8" {...swipeHandlers}>
        <BookingHeader currentStep={currentStep} totalSteps={6} stepLabel="Home Size" />
        <PromoBanner />
      
        <div className="container max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
          {/* Header */}
          <div className="text-center mb-8 md:mb-10">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 bg-muted rounded-full flex items-center justify-center mb-4 md:mb-6">
              <HomeIcon className="w-7 h-7 md:w-8 md:h-8 text-foreground" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              How big is your home?
            </h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Select your home size to see instant pricing for a professional deep clean
            </p>
            
            {/* Google Guaranteed Badge */}
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 border-2 border-green-500 rounded-full bg-green-50 dark:bg-green-950/30">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">Google Guaranteed</span>
            </div>
          </div>
          
          {/* Size Selection Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-5 mb-6">
            {HOME_SIZE_RANGES.filter(size => size.id !== '5000_plus').map((size) => {
              const isSelected = bookingData.homeSizeId === size.id;
              return (
                <Card
                  key={size.id}
                  className={cn(
                    "cursor-pointer transition-all duration-200 hover:border-primary/60 bg-background relative",
                    isSelected ? "border-primary border-2 ring-2 ring-primary/20" : "border-border"
                  )}
                  onClick={() => handleSelect(size.id)}
                >
                  {isSelected && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                  <CardContent className="p-6 md:p-8 text-center">
                    <h3 className="text-lg md:text-xl font-bold text-foreground mb-1">
                      {size.label}
                    </h3>
                    <p className="text-sm text-primary">
                      {size.bedroomRange}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Custom Quote Card */}
          <Card className="bg-muted/50 border-border">
            <CardContent className="p-5 md:p-6 text-center">
              <p className="text-base md:text-lg font-medium text-primary mb-3">
                Home larger than 5,000 sq ft?
              </p>
              <Button
                variant="outline"
                onClick={() => navigate("/book/custom-quote")}
                className="bg-foreground text-background hover:bg-foreground/90 border-foreground"
              >
                Call for Custom Quote
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
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
    </PageTransition>
  );
}
