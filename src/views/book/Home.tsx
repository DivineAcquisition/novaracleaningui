"use client";
import {
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiHomeLine as HomeIcon,
  RiPhoneLine
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { HomeSizePlan } from "@/components/booking/HomeSizePlan";
import { PageTransition } from "@/components/booking/PageTransition";
import { SEO } from "@/components/SEO";

const BOOKING_STEPS = [
  { number: 1, label: "Location", path: "/book/zip" },
  { number: 2, label: "Home Size", path: "/book/sqft" },
  { number: 3, label: "Service", path: "/book/offer" },
  { number: 4, label: "Checkout", path: "/book/checkout" },
  { number: 5, label: "Details", path: "/book/details" },
  { number: 6, label: "Confirm", path: "/book/confirmation" },
];

export default function BookingHome() {
  const router = useRouter();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(1);
      router.push("/");
    },
    step: 2,
  });

  const handleSelect = (sizeId: string) => {
    // If >5,000 sqft, redirect to custom quote page
    if (sizeId === '5000_plus') {
      router.push("/book/custom-quote");
      return;
    }
    
    updateBookingData({ homeSizeId: sizeId });
    setCurrentStep(3);
    router.push("/book/offer");
  };

  const handleBack = () => {
    setCurrentStep(1);
    router.push("/");
  };

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-muted/30 md:pb-8" {...swipeHandlers}>
        <SEO title="Select Home Size" description="Choose your home size to see instant pricing for professional deep cleaning." />
        <BookingHeader currentStep={currentStep} totalSteps={6} stepLabel="Home Size" />
      
        <div className="container max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">
          {/* Header */}
          <div className="text-center mb-8 md:mb-10">
            <div className="mx-auto w-14 h-14 md:w-16 md:h-16 bg-muted rounded-full flex items-center justify-center mb-4 md:mb-6">
              <HomeIcon className="w-7 h-7 md:w-8 md:h-8 text-foreground" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              How big is your home?
            </h1>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
              <span className="font-semibold text-foreground">
                {bookingData.membershipPlan && bookingData.membershipPlan !== "none"
                  ? "Glow pricing uses this home size."
                  : "The price on the next step uses this home size."}
              </span>{" "}
              Choose the range that matches your home.
            </p>
          </div>
          
          {/* Size Selection Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-5 mb-6">
            {HOME_SIZE_RANGES.filter(size => size.id !== '5000_plus').map((size, index, sizes) => {
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
                      <RiCheckboxCircleLine className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                  <CardContent className="p-4 md:p-5 text-center">
                    <HomeSizePlan index={index} total={sizes.length} selected={isSelected} />
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
                onClick={() => router.push("/book/custom-quote")}
                className="bg-foreground text-background hover:bg-foreground/90 border-foreground"
              >
                Call for Custom Quote
                <RiArrowRightLine className="w-4 h-4 ml-2" />
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

        <BookingFooter clearMobileBar />
      </div>
    </PageTransition>
  );
}
