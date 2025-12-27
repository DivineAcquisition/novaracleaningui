import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { HOME_SIZE_RANGES, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { toast } from "sonner";
import { ArrowLeft, Check, Sparkles, Star, Clock, Calendar, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";
import { GoogleGuaranteedBadge } from "@/components/booking/GoogleGuaranteedBadge";
import { CleaningShowcaseCarousel } from "@/components/booking/CleaningShowcaseCarousel";
import { ServiceDetailsModal } from "@/components/booking/ServiceDetailsModal";
import { BookingFooter } from "@/components/booking/BookingFooter";

// New Year Promo Configuration
const NEW_YEAR_PROMO = {
  deepCleanDiscount: 50,
  recurringDiscount: 0.15,
  expirationDate: "2025-01-07",
};

export default function BookingOffer() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [selectedOffer, setSelectedOffer] = useState<"deep_clean" | "recurring" | null>(null);
  const offersRef = useRef<HTMLDivElement>(null);

  // Get home size pricing
  const homeSize = HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
  const baseDeepPrice = homeSize ? homeSize.standardPrice + 50 : 200; // Deep clean adds $50
  const maintenancePrice = homeSize ? homeSize.standardPrice : 150;

  // Calculate promo prices
  const discountedDeepPrice = baseDeepPrice - NEW_YEAR_PROMO.deepCleanDiscount;
  const discountedRecurringPrice = Math.round(maintenancePrice * (1 - NEW_YEAR_PROMO.recurringDiscount));
  const recurringSavings = Math.round(maintenancePrice * NEW_YEAR_PROMO.recurringDiscount);

  // Redirect if missing data
  useEffect(() => {
    if (!bookingData.zipCode) {
      toast.error("Please enter your ZIP code first");
      navigate("/book/zip");
      return;
    }
    if (!bookingData.homeSizeId) {
      toast.error("Please select your home size first");
      navigate("/book/sqft");
    }
  }, [bookingData.zipCode, bookingData.homeSizeId, navigate]);

  const scrollToOffers = () => {
    offersRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleOfferSelect = (offer: "deep_clean" | "recurring") => {
    setSelectedOffer(offer);

    // Update booking context
    if (offer === "deep_clean") {
      updateBookingData({
        serviceType: "deep",
        promoCode: "NEWYEAR2025",
      });
    } else {
      updateBookingData({
        serviceType: "standard",
        promoCode: "NEWYEAR2025",
      });
    }

    // Navigate after brief pause
    setTimeout(() => {
      setCurrentStep(4);
      navigate("/book/schedule");
    }, 200);
  };

  const handleBack = () => {
    navigate("/book/sqft");
  };

  // Calculate days until promo expires
  const daysUntilExpiry = Math.max(
    0,
    Math.ceil((new Date(NEW_YEAR_PROMO.expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Sticky Promo Banner */}
      <div className="sticky top-0 z-50 bg-primary text-primary-foreground">
        <div className="container max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-yellow-300" />
              <div>
                <p className="font-semibold text-sm md:text-base">
                  New Year Special – Save Up to $50!
                </p>
                <p className="text-xs opacity-90">
                  Offer expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={scrollToOffers}
              className="shrink-0"
            >
              Claim My Discount
            </Button>
          </div>
        </div>
      </div>

      <BookingProgressBar currentStep={3} totalSteps={6} />

      <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <Badge variant="outline" className="gap-1.5">
            <Clock className="h-3 w-3" />
            Expires {NEW_YEAR_PROMO.expirationDate}
          </Badge>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Start 2025 With a Spotless Home
          </h1>
          <div className="flex justify-center">
            <GoogleGuaranteedBadge />
          </div>
        </div>

        {/* Offer Cards */}
        <div ref={offersRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
          {/* Deep Clean Card */}
          <Card
            onClick={() => handleOfferSelect("deep_clean")}
            className={cn(
              "relative cursor-pointer transition-all duration-200 hover:shadow-lg",
              selectedOffer === "deep_clean"
                ? "border-primary shadow-lg"
                : "border-border"
            )}
          >
            <CardHeader className="pb-2">
              <Badge className="w-fit bg-yellow-500 hover:bg-yellow-500 text-yellow-950">
                ${NEW_YEAR_PROMO.deepCleanDiscount} Off — New Year Special
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">Deep Clean</h3>
                <p className="text-sm text-muted-foreground">
                  One-time thorough cleaning
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-primary">
                    ${discountedDeepPrice}
                  </span>
                  <span className="text-lg text-muted-foreground line-through">
                    ${baseDeepPrice}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  ${DEPOSIT_AMOUNT} deposit • Balance due after service
                </p>
              </div>

              <ul className="space-y-2">
                {[
                  "Top-to-bottom deep cleaning",
                  "Inside appliances",
                  "Baseboards & details",
                  "Perfect for first-time cleans",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <ServiceDetailsModal serviceType="deep" />
            </CardContent>
          </Card>

          {/* Recurring Card */}
          <Card
            onClick={() => handleOfferSelect("recurring")}
            className={cn(
              "relative cursor-pointer transition-all duration-200 hover:shadow-lg",
              selectedOffer === "recurring"
                ? "border-primary shadow-lg"
                : "border-border"
            )}
          >
            {/* Most Popular Badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
              <Badge className="bg-primary hover:bg-primary gap-1">
                <Star className="h-3 w-3 fill-current" />
                Most Popular
              </Badge>
            </div>

            <CardHeader className="pb-2 pt-6">
              <Badge variant="outline" className="w-fit border-primary text-primary">
                15% Off — Recurring Service
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">
                  Recurring Maintenance
                </h3>
                <p className="text-sm text-muted-foreground">
                  Bi-weekly cleaning service
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-primary">
                    ${discountedRecurringPrice}
                  </span>
                  <span className="text-lg text-muted-foreground line-through">
                    ${maintenancePrice}
                  </span>
                  <span className="text-sm text-muted-foreground">/visit</span>
                </div>
                <p className="text-sm text-green-600 font-medium">
                  Save ${recurringSavings} every visit
                </p>
              </div>

              <ul className="space-y-2">
                {[
                  "Consistent cleaning schedule",
                  "Same trusted cleaner",
                  "Easy rescheduling",
                  "No long-term contract",
                  "Cancel anytime",
                ].map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <ServiceDetailsModal serviceType="standard" />
            </CardContent>
          </Card>
        </div>

        {/* Back Button */}
        <div className="flex justify-center">
          <Button variant="ghost" onClick={handleBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Home Size
          </Button>
        </div>

        {/* Trust Badges */}
        <div className="flex flex-wrap justify-center gap-4 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4 text-primary" />
            Satisfaction Guaranteed
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4 text-primary" />
            Flexible Scheduling
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Star className="h-4 w-4 text-primary" />
            4.9★ Average Rating
          </div>
        </div>

        {/* Showcase Carousel */}
        <div className="animate-fade-in">
          <CleaningShowcaseCarousel />
        </div>
      </div>

      <BookingFooter />
    </div>
  );
}
