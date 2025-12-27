import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { toast } from "sonner";
import { Home, CheckCircle, Phone, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";
import { GoogleGuaranteedBadge } from "@/components/booking/GoogleGuaranteedBadge";
import { CleaningShowcaseCarousel } from "@/components/booking/CleaningShowcaseCarousel";
import { ReviewsWidget } from "@/components/booking/ReviewsWidget";
import { BookingFooter } from "@/components/booking/BookingFooter";

// Filter out 5000+ for the grid (that's the custom quote option)
const SIZE_OPTIONS = HOME_SIZE_RANGES.filter(size => size.id !== '5000_plus');

export default function BookingSqft() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [selectedSize, setSelectedSize] = useState(bookingData.homeSizeId || "");

  // Redirect if no ZIP code
  useEffect(() => {
    if (!bookingData.zipCode) {
      toast.error("Please enter your ZIP code first");
      navigate("/book/zip");
    }
  }, [bookingData.zipCode, navigate]);

  const handleSizeSelect = (sizeId: string) => {
    setSelectedSize(sizeId);
    updateBookingData({ homeSizeId: sizeId });

    // Auto-navigate after brief pause to show selection
    setTimeout(() => {
      setCurrentStep(3);
      navigate("/book/offer");
    }, 300);
  };

  const handleCustomQuote = () => {
    navigate("/book/custom-quote");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <BookingProgressBar currentStep={2} totalSteps={6} />

      <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <GoogleGuaranteedBadge />
          </div>
          <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
            <Home className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            How big is your home?
          </h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            Select your approximate square footage to get an instant price estimate
          </p>
        </div>

        {/* Size Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SIZE_OPTIONS.map((size) => {
            const isSelected = selectedSize === size.id;
            return (
              <Card
                key={size.id}
                onClick={() => handleSizeSelect(size.id)}
                className={cn(
                  "relative cursor-pointer transition-all duration-300 hover:scale-105",
                  isSelected
                    ? "border-primary border-2 bg-primary/5 shadow-lg"
                    : "border-border hover:border-primary/50 hover:shadow-md"
                )}
              >
                {isSelected && (
                  <div className="absolute -top-3 -right-3 z-10">
                    <div className="bg-primary text-primary-foreground rounded-full p-1">
                      <CheckCircle className="h-5 w-5" />
                    </div>
                  </div>
                )}
                <CardContent className="p-4 text-center space-y-2">
                  <p className="text-lg font-semibold text-foreground">
                    {size.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {size.bedroomRange}
                  </p>
                  <div className="pt-2 border-t border-border">
                    <p className="text-sm text-muted-foreground">Starting at</p>
                    <p className="text-xl font-bold text-primary">
                      ${size.standardPrice}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Custom Quote Card */}
        <Card
          onClick={handleCustomQuote}
          className="border-dashed border-2 border-muted-foreground/30 cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-md hover:scale-[1.02]"
        >
          <CardContent className="p-6 text-center space-y-3">
            <div className="inline-flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" />
              <span className="font-semibold">5,000+ sq ft</span>
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-muted-foreground">
              Large estates and custom homes require a personalized quote
            </p>
            <Button variant="outline" className="gap-2">
              <Phone className="h-4 w-4" />
              Get Custom Quote
            </Button>
          </CardContent>
        </Card>

        {/* Showcase Carousel */}
        <div className="animate-fade-in">
          <CleaningShowcaseCarousel />
        </div>

        {/* Reviews */}
        <div className="animate-fade-in">
          <ReviewsWidget />
        </div>
      </div>

      <BookingFooter />
    </div>
  );
}
