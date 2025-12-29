import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Gift, Sparkles, CalendarCheck, Check, ArrowLeft, Phone, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { PageTransition } from "@/components/booking/PageTransition";
import { GoogleGuaranteedBadge } from "@/components/GoogleGuaranteedBadge";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, DEPOSIT_AMOUNT } from "@/lib/pricing-system";
import { format } from "date-fns";
import { toast } from "sonner";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Checkout" },
  { number: 5, label: "Details" },
  { number: 6, label: "Confirm" },
];

// New Year's Special - Ends Jan 7, 2025
const OFFER_END_DATE = new Date('2025-01-07T23:59:59');
const DEEP_CLEAN_DISCOUNT = 50;
const RECURRING_DISCOUNT_PERCENT = 15;

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
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showDeepCleanModal, setShowDeepCleanModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
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
    const discountedDeepCleanPrice = deepCleanPrice - DEEP_CLEAN_DISCOUNT;
    const depositAmount = Math.round(discountedDeepCleanPrice * 0.25);

    const recurringPrice = basePrice; // Standard clean for recurring
    const discountedRecurringPrice = Math.round(recurringPrice * (1 - RECURRING_DISCOUNT_PERCENT / 100));
    const recurringDeposit = Math.round(discountedRecurringPrice * 0.25);
    const recurringSavings = recurringPrice - discountedRecurringPrice;

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
        savings: recurringSavings,
      },
    };
  }, [selectedHomeSize]);

  // Calculate days remaining
  useEffect(() => {
    const now = new Date();
    const diff = OFFER_END_DATE.getTime() - now.getTime();
    const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    setDaysRemaining(days);
  }, []);

  // Check for custom quote requirement (5000+ sq ft)
  const requiresCustomQuote = selectedHomeSize?.id === '5000_plus';

  const handleSelectDeepClean = () => {
    setSelectedService('deep');
    updateBookingData({
      serviceType: 'deep',
      membershipPlan: 'none',
      promoCode: 'NEWYEAR50',
    });
    // Scroll to scheduler
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectRecurring = () => {
    setSelectedService('recurring');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'biweekly',
      promoCode: 'NEWYEAR15',
    });
    // Scroll to scheduler
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
    navigate("/book/checkout");
  };

  const handleBack = () => {
    setCurrentStep(2);
    navigate("/book/sqft");
  };

  // Custom Quote View
  if (requiresCustomQuote) {
    return (
      <PageTransition direction="forward">
        <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
          <ProgressBar currentStep={3} totalSteps={6} steps={BOOKING_STEPS} />
          
          <div className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
            <Card className="border-2 border-primary/30">
              <CardContent className="pt-8 pb-8 text-center space-y-6">
                <h1 className="text-2xl md:text-3xl font-bold font-jakarta">Custom Quote Required</h1>
                <p className="text-muted-foreground">
                  Your home requires a customized quote to ensure accurate pricing.
                </p>
                
                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="font-semibold">Deep Clean</p>
                    <p className="text-sm text-muted-foreground">Starting at $500</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="font-semibold">Recurring Service</p>
                    <p className="text-sm text-muted-foreground">Starting at $400/visit</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 text-lg font-semibold text-primary">
                  <Phone className="w-5 h-5" />
                  <a href="tel:9725590223">(972) 559-0223</a>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild size="lg" className="bg-gradient-primary">
                    <a href="tel:9725590223">
                      <Phone className="w-4 h-4 mr-2" />
                      Call Now
                    </a>
                  </Button>
                  <Button variant="ghost" size="lg" onClick={handleBack}>
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
        {/* Sticky Promo Banner */}
        <div className="sticky top-0 z-50 bg-[hsl(220,50%,15%)] border-b-2 border-amber-500/50 py-3 px-4">
          <div className="container max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Gift className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div className="text-white text-center sm:text-left">
                <span className="font-bold">New Year Special: $50 Off Your First Clean + 15% Off Recurring Service</span>
                <span className="block sm:inline sm:ml-2 text-sm text-amber-200">Book by Jan 7th to claim your discount</span>
              </div>
            </div>
            <Button 
              size="sm" 
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold whitespace-nowrap"
              onClick={() => document.getElementById('offers-section')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Claim My Discount
            </Button>
          </div>
        </div>

        <ProgressBar currentStep={3} totalSteps={6} steps={BOOKING_STEPS} />

        <div className="container max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
          {/* Header Section */}
          <div className="text-center space-y-4">
            <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30 px-4 py-1.5">
              <Sparkles className="w-4 h-4 mr-2" />
              New Year Special — Ends Jan 7th
            </Badge>
            
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold font-jakarta">
              Start 2025 With a Spotless Home
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
                  <Gift className="w-3 h-3 mr-1" />
                  $50 Off — New Year Special
                </Badge>
              </div>
              
              <CardContent className="pt-14 pb-6 px-5 space-y-5">
                <div>
                  <h3 className="text-2xl font-bold font-jakarta">Deep Clean</h3>
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
                        <Check className="w-3 h-3 text-primary" />
                      </div>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="space-y-2 pt-2">
                  <Button 
                    size="lg" 
                    className="w-full bg-gradient-primary font-semibold"
                    onClick={handleSelectDeepClean}
                  >
                    Get Started — ${prices.deepClean.deposit} Today
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setShowDeepCleanModal(true)}
                  >
                    What's Included?
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Card B: Recurring Maintenance (Most Popular) */}
            <Card className="relative overflow-hidden border-2 border-success/30 hover:border-success/60 transition-all duration-300 hover:shadow-xl">
              {/* Most Popular Pill */}
              <div className="absolute -top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                <Badge className="bg-success text-white font-bold shadow-lg px-4 py-1">
                  Most Popular
                </Badge>
              </div>
              
              <div className="absolute top-3 left-3">
                <Badge className="bg-amber-500 text-black font-bold">
                  <CalendarCheck className="w-3 h-3 mr-1" />
                  15% Off — Recurring Service
                </Badge>
              </div>
              
              <CardContent className="pt-14 pb-6 px-5 space-y-5">
                <div>
                  <h3 className="text-2xl font-bold font-jakarta">Recurring Maintenance</h3>
                  <p className="text-muted-foreground">Keep your home guest-ready, always</p>
                </div>
                
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg text-muted-foreground line-through">${prices.recurring.original}</span>
                    <span className="text-3xl font-black text-success">${prices.recurring.discounted}</span>
                    <span className="text-muted-foreground">/visit</span>
                  </div>
                  <p className="text-sm text-success font-medium">
                    You save ${prices.recurring.savings} every visit!
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Pay only ${prices.recurring.deposit} today (25% deposit)
                  </p>
                </div>
                
                <ul className="space-y-2.5">
                  {RECURRING_FEATURES.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <div className="w-5 h-5 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-success" />
                      </div>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                
                <div className="space-y-2 pt-2">
                  <Button 
                    size="lg" 
                    className="w-full bg-success hover:bg-success/90 font-semibold"
                    onClick={handleSelectRecurring}
                  >
                    Get Started — ${prices.recurring.deposit} Today
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setShowRecurringModal(true)}
                  >
                    What's Included?
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Schedule Picker - Shows after service selection with animation */}
          {selectedService && (
            <div 
              id="schedule-section" 
              className="scroll-mt-4 animate-fade-in"
              style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
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
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home Size
            </Button>
          </div>
        </div>

        {/* Deep Clean Modal */}
        <Dialog open={showDeepCleanModal} onOpenChange={setShowDeepCleanModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-jakarta">Deep Clean — What's Included</DialogTitle>
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
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
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
              <DialogTitle className="text-xl font-jakarta">Recurring Maintenance — What's Included</DialogTitle>
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
                    <Check className="w-4 h-4 text-success flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full bg-success hover:bg-success/90" onClick={() => { setShowRecurringModal(false); handleSelectRecurring(); }}>
                Select Recurring Service
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
