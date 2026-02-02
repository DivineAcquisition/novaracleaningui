"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PromoBanner } from "@/components/booking/PromoBanner";
import { PageTransition } from "@/components/booking/PageTransition";
import { GoogleGuaranteedBadge } from "@/components/GoogleGuaranteedBadge";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
import { format } from "date-fns";
import { toast } from "sonner";

// Deep clean features
const DEEP_CLEAN_FEATURES = [
  "40-point Deep Clean checklist",
  "2-person professional team",
  "All supplies & equipment included",
  "48-hour re-clean guarantee",
];

// Recurring features
const RECURRING_FEATURES = [
  "Bi-weekly or monthly scheduling",
  "Same trusted cleaning team",
  "Priority scheduling & member perks",
  "Cancel or pause anytime",
  "48-hour re-clean guarantee",
];

export default function BookingOffer() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showDeepCleanModal, setShowDeepCleanModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [selectedService, setSelectedService] = useState<'deep' | 'recurring' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + 'T12:00:00') : undefined
  );

  // Get home size data
  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  // Calculate prices
  const prices = useMemo(() => {
    const basePrice = selectedHomeSize?.standardPrice || 150;
    const deepCleanPrice = basePrice + SERVICE_TIER_PRICING.deep.addition;
    const discountedDeepCleanPrice = deepCleanPrice - 50;
    const depositAmount = Math.round(discountedDeepCleanPrice * 0.25);

    const recurringPrice = basePrice;
    const discountedRecurringPrice = Math.round(recurringPrice * 0.85);
    const recurringDeposit = Math.round(discountedRecurringPrice * 0.25);

    return {
      deepClean: {
        original: deepCleanPrice,
        discounted: discountedDeepCleanPrice,
        deposit: depositAmount,
      },
      recurring: {
        original: recurringPrice,
        discounted: discountedRecurringPrice,
        deposit: recurringDeposit,
      },
    };
  }, [selectedHomeSize]);

  const handleSelectDeepClean = () => {
    setSelectedService('deep');
    updateBookingData({
      serviceType: 'Deep Clean',
      membershipPlan: 'none',
      promoCode: 'NEWYEAR50',
    });
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectRecurring = () => {
    setSelectedService('recurring');
    updateBookingData({
      serviceType: 'Standard Clean',
      membershipPlan: 'biweekly',
      promoCode: 'NEWYEAR15',
    });
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleContinueToCheckout = () => {
    if (!bookingData.serviceDate || !bookingData.timeSlot) {
      toast.error("Please select a date and time");
      return;
    }
    setCurrentStep(4);
    router.push("/book/checkout");
  };

  const handleBack = () => {
    setCurrentStep(2);
    router.push("/book/sqft");
  };

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-32 md:pb-8">
        <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
        <PromoBanner />

        <div className="container max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
          {/* Header Section */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold">
              Choose Your Service
            </h1>
            
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Choose your service and lock in your New Year savings.
            </p>
            
            {/* Trust Badge */}
            <GoogleGuaranteedBadge variant="compact" />
          </div>

          {/* Offer Cards */}
          <div id="offers-section" className="grid md:grid-cols-2 gap-4 md:gap-6">
            {/* Card A: Deep Clean (One-Time) */}
            <Card className="relative overflow-hidden border-2 border-primary/30 hover:border-primary/60 transition-all duration-300 hover:shadow-xl">
              <div className="absolute top-3 left-3">
                <Badge className="bg-amber-500 text-black font-bold">
                  <i className="ri-gift-fill mr-1"></i>
                  $50 Off — New Year Special
                </Badge>
              </div>
              
              <CardContent className="pt-14 pb-6 px-5 space-y-5">
                <div>
                  <h3 className="text-2xl font-bold">Deep Clean</h3>
                  <p className="text-muted-foreground">One-time reset for your home</p>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg text-muted-foreground line-through">${prices.deepClean.original}</span>
                    <span className="text-3xl font-black text-primary">${prices.deepClean.discounted}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Pay only ${prices.deepClean.deposit} today (25% deposit)
                  </p>
                </div>
                
                <ul className="space-y-2.5">
                  {DEEP_CLEAN_FEATURES.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                        <i className="ri-check-line text-primary text-xs"></i>
                      </div>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="space-y-2 pt-2">
                  <Button 
                    size="lg" 
                    className="w-full font-semibold"
                    onClick={handleSelectDeepClean}
                  >
                    Get Started — ${prices.deepClean.deposit} Today
                    <i className="ri-arrow-right-s-line ml-1"></i>
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setShowDeepCleanModal(true)}
                  >
                    What&apos;s Included?
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Card B: Recurring Maintenance (Most Popular) */}
            <div className="relative">
              {/* Most Popular Pill */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                <Badge className="bg-green-600 text-white font-bold shadow-lg px-4 py-1.5">
                  Most Popular
                </Badge>
              </div>
              
              <Card className="overflow-hidden border-2 border-green-500/30 hover:border-green-500/60 transition-all duration-300 hover:shadow-xl h-full">
                <CardContent className="pt-14 pb-6 px-5 space-y-5">
                  <div>
                    <h3 className="text-2xl font-bold">Novara Membership</h3>
                    <p className="text-muted-foreground">Keep your home guest-ready, always</p>
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-green-600">$189</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                    <p className="text-sm text-green-600 font-medium">
                      Includes 1 cleaning per month + member perks
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Pay only ${prices.recurring.deposit} today (25% deposit)
                    </p>
                  </div>
                  
                  <ul className="space-y-2.5">
                    {RECURRING_FEATURES.map((feature, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-sm">
                        <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center flex-shrink-0">
                          <i className="ri-check-line text-green-600 text-xs"></i>
                        </div>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <div className="space-y-2 pt-2">
                    <Button 
                      size="lg" 
                      className="w-full bg-green-600 hover:bg-green-600/90 font-semibold"
                      onClick={handleSelectRecurring}
                    >
                      Get Started — ${prices.recurring.deposit} Today
                      <i className="ri-arrow-right-s-line ml-1"></i>
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full"
                      onClick={() => setShowRecurringModal(true)}
                    >
                      What&apos;s Included?
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Schedule Picker */}
          {selectedService && (
            <div 
              id="schedule-section" 
              className="scroll-mt-4 animate-fade-in"
            >
              <SchedulePicker
                selectedDate={selectedDate}
                selectedTime={bookingData.timeSlot}
                onDateSelect={(date) => {
                  setSelectedDate(date);
                  updateBookingData({ 
                    serviceDate: format(date, 'yyyy-MM-dd'),
                    timeSlot: '' 
                  });
                }}
                onTimeSelect={(date, timeSlot, startTime, endTime) => {
                  updateBookingData({ 
                    serviceDate: format(date, 'yyyy-MM-dd'),
                    timeSlot,
                    startTime,
                    endTime
                  });
                  toast.success(`Scheduled for ${format(date, 'MMM d')} at ${timeSlot}`);
                }}
                onContinue={handleContinueToCheckout}
                showContinue={true}
                continueDisabled={!bookingData.serviceDate || !bookingData.timeSlot}
              />
            </div>
          )}

          {/* Back Navigation */}
          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleBack} className="text-muted-foreground">
              <i className="ri-arrow-left-line mr-2"></i>
              Back to Home Size
            </Button>
          </div>
        </div>

        {/* Deep Clean Modal */}
        <Dialog open={showDeepCleanModal} onOpenChange={setShowDeepCleanModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl">Deep Clean — What&apos;s Included</DialogTitle>
              <DialogDescription>
                Our thorough top-to-bottom cleaning for a complete home reset.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-3">
                {[
                  "40-point cleaning checklist",
                  "All rooms deep cleaned",
                  "Baseboards & door frames wiped",
                  "Light fixtures & ceiling fans dusted",
                  "Inside oven & fridge cleaned",
                  "Interior windows cleaned",
                  "Bathroom grout scrubbed",
                  "Kitchen appliances detailed",
                  "All supplies & equipment included",
                  "2-person professional team",
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <i className="ri-check-line text-primary flex-shrink-0"></i>
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full" onClick={() => { setShowDeepCleanModal(false); handleSelectDeepClean(); }}>
                Select Deep Clean
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Recurring Modal */}
        <Dialog open={showRecurringModal} onOpenChange={setShowRecurringModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl">Novara Membership — What&apos;s Included</DialogTitle>
              <DialogDescription>
                Keep your home consistently clean with regular scheduled service.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-3">
                {[
                  "Standard cleaning every visit",
                  "Dusting all surfaces",
                  "Vacuuming & mopping floors",
                  "Kitchen & bathroom cleaning",
                  "Trash removal",
                  "Bed making (linens provided)",
                  "Same trusted cleaning team",
                  "Flexible bi-weekly or monthly schedule",
                  "Priority booking slots",
                  "Easy pause or cancel anytime",
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <i className="ri-check-line text-green-600 flex-shrink-0"></i>
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full bg-green-600 hover:bg-green-600/90" onClick={() => { setShowRecurringModal(false); handleSelectRecurring(); }}>
                Select Recurring Service
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
