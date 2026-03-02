import { useState, useEffect, useMemo } from "react";
import { trackViewContent } from "@/lib/meta-pixel";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, ArrowLeft, Phone, ChevronRight, Star, Crown, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PromoBanner } from "@/components/booking/PromoBanner";
import { PageTransition } from "@/components/booking/PageTransition";
import { GoogleGuaranteedBadge } from "@/components/GoogleGuaranteedBadge";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import {
  HOME_SIZE_RANGES,
  DEPOSIT_AMOUNT,
  MEMBERSHIP_PRICES,
  getServicePrice,
} from "@/lib/pricing-system";
import { FIRST_CLEAN_PROMO } from "@/config/brand-config";
import { SEO } from "@/components/SEO";
import { format } from "date-fns";
import { toast } from "sonner";

const BOOKING_STEPS = [
  { number: 1, label: "Location", path: "/book/zip" },
  { number: 2, label: "Home Size", path: "/book/sqft" },
  { number: 3, label: "Service", path: "/book/offer" },
  { number: 4, label: "Checkout", path: "/book/checkout" },
  { number: 5, label: "Details", path: "/book/details" },
  { number: 6, label: "Confirm", path: "/book/confirmation" },
];

// Membership features
const MEMBERSHIP_FEATURES = [
  "Same trusted cleaning team",
  "Priority scheduling & member perks",
  "Cancel or pause anytime",
  "48-hour re-clean guarantee",
];

export default function BookingOffer() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [selectedService, setSelectedService] = useState<'membership' | 'promo' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + 'T12:00:00') : undefined
  );

  // Get home size data
  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  // Calculate v2 prices using the pricing system
  const prices = useMemo(() => {
    const homeSizeId = bookingData.homeSizeId || '0_999';

    // One-time prices (Zone B base — backend applies zone modifier)
    const standardPrice = getServicePrice(homeSizeId, 'standard', 'B');
    const deepCleanPrice = getServicePrice(homeSizeId, 'deep', 'B');

    // Membership prices (Zone B base)
    const memberPrices = MEMBERSHIP_PRICES[homeSizeId] || { monthly: 129, biweekly: 199, weekly: 349 };

    // Per-clean cost for bi-weekly
    const biweeklyPerClean = Math.round((memberPrices.biweekly / 2) * 100) / 100;
    const biweeklySavingsPercent = standardPrice > 0
      ? Math.round((1 - biweeklyPerClean / standardPrice) * 100)
      : 34;

    return {
      standard: standardPrice,
      deepClean: deepCleanPrice,
      membership: {
        monthly: memberPrices.monthly,
        biweekly: memberPrices.biweekly,
        weekly: memberPrices.weekly,
        biweeklyPerClean,
        biweeklySavingsPercent,
      },
    };
  }, [bookingData.homeSizeId]);

  // Check for custom quote requirement (5000+ sq ft)
  const requiresCustomQuote = selectedHomeSize?.id === '5000_plus';

  const handleSelectPromo = () => {
    setSelectedService('promo');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'none',
    });
    trackViewContent(FIRST_CLEAN_PROMO.price, '$99 First Clean Promo');
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };


  const handleSelectMembership = () => {
    setSelectedService('membership');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'biweekly',
    });
    trackViewContent(prices.membership.biweekly, 'Novara Glow Membership — Bi-Weekly');
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
          <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
          
          <div className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
            <Card className="border-2 border-primary/30">
              <CardContent className="pt-8 pb-8 text-center space-y-6">
                <h1 className="text-2xl md:text-3xl font-bold font-jakarta">Custom Quote Required</h1>
                <p className="text-muted-foreground">
                  Your home requires a customized quote to ensure accurate pricing.
                </p>
                
                <div className="flex items-center justify-center gap-2 text-lg font-semibold text-primary">
                  <Phone className="w-5 h-5" />
                  <a href="tel:+18447352070">(844) 735-2070</a>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild size="lg" className="bg-gradient-primary">
                    <a href="tel:+18447352070">
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
        <SEO title="Choose Your Service" description="Select your cleaning service type and schedule. Standard, deep clean, or Novara Glow membership." />
        <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
        <PromoBanner />

        <div className="container max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
          {/* Header Section */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold font-jakarta">
              Choose Your Service
            </h1>
            
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              One-time deep clean or recurring membership — you decide.
            </p>
            
            <GoogleGuaranteedBadge variant="compact" />
          </div>

          {/* $99 First Clean Promo Card */}
          {FIRST_CLEAN_PROMO.enabled && (
            <div className="col-span-full">
              <Card className="relative overflow-hidden border-2 border-amber-400/60 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 hover:border-amber-400 transition-all duration-300 hover:shadow-xl">
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-400/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                <CardContent className="pt-6 pb-6 px-5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-amber-500 text-white font-bold px-3 py-1">
                          <Zap className="w-3 h-3 mr-1" />
                          Limited Offer
                        </Badge>
                      </div>
                      <h3 className="text-2xl font-bold font-jakarta">{FIRST_CLEAN_PROMO.label}</h3>
                      <p className="text-muted-foreground text-sm max-w-md">
                        {FIRST_CLEAN_PROMO.description}
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-amber-600 dark:text-amber-400">${FIRST_CLEAN_PROMO.price}</span>
                        {selectedHomeSize && (
                          <span className="text-lg text-muted-foreground line-through">${prices.standard}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Button
                        size="lg"
                        className="w-full sm:w-auto bg-amber-500 hover:bg-amber-600 text-white font-semibold"
                        onClick={handleSelectPromo}
                      >
                        Claim Offer
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Offer Cards */}
          <div id="offers-section" className="max-w-xl mx-auto">
            {/* Novara Glow Membership (Most Popular) */}
            <div className="relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                <Badge className="bg-success text-white font-bold shadow-lg px-4 py-1.5">
                  Most Popular — Save {prices.membership.biweeklySavingsPercent}%
                </Badge>
              </div>
              
              <Card className="overflow-hidden border-2 border-success/30 hover:border-success/60 transition-all duration-300 hover:shadow-xl">
              <CardContent className="pt-14 pb-6 px-5 space-y-5">
                <div>
                  <h3 className="text-2xl font-bold font-jakarta">Novara Glow Membership</h3>
                  <p className="text-muted-foreground">Recurring cleaning — choose your frequency</p>
                </div>
                
                <div className="space-y-2">
                  {/* Bi-Weekly highlight */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-success">${prices.membership.biweekly}</span>
                    <span className="text-muted-foreground">/month</span>
                  </div>
                  <p className="text-sm text-success font-medium">
                    Bi-Weekly: 2 cleans/month at ${prices.membership.biweeklyPerClean}/clean
                  </p>

                  {/* Other frequency options */}
                  <div className="flex gap-2 pt-1">
                    <Badge variant="secondary" className="text-[10px]">
                      Monthly: ${prices.membership.monthly}/mo
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Weekly: ${prices.membership.weekly}/mo
                    </Badge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Pay only ${DEPOSIT_AMOUNT} deposit today
                  </p>
                </div>
                
                <ul className="space-y-2.5">
                  {MEMBERSHIP_FEATURES.map((feature, idx) => (
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
                    onClick={handleSelectMembership}
                  >
                    Get Started — ${DEPOSIT_AMOUNT} Today
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setShowMembershipModal(true)}
                  >
                    What's Included?
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
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

        {/* Membership Modal */}
        <Dialog open={showMembershipModal} onOpenChange={setShowMembershipModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-jakarta">Novara Glow Membership</DialogTitle>
              <DialogDescription>
                Recurring cleaning at a fraction of the one-time price.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Frequency options */}
              <div className="grid gap-3">
                <div className="p-3 rounded-lg border bg-success/5 border-success/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Star className="w-4 h-4 text-success" />
                      <span className="font-semibold text-sm">Bi-Weekly (2x/month)</span>
                      <Badge className="bg-success/10 text-success border-0 text-[10px]">Best Value</Badge>
                    </div>
                    <span className="font-bold text-success">${prices.membership.biweekly}/mo</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">Monthly (1x/month)</span>
                    </div>
                    <span className="font-bold">${prices.membership.monthly}/mo</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">Weekly (4x/month)</span>
                    </div>
                    <span className="font-bold">${prices.membership.weekly}/mo</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid gap-3">
                {[
                  "Same trusted cleaning team every visit",
                  "Priority scheduling",
                  "Free add-ons included",
                  "Cancel or pause anytime",
                  "48-hour re-clean guarantee",
                  "No long-term contracts",
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-success flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full bg-success hover:bg-success/90" onClick={() => { setShowMembershipModal(false); handleSelectMembership(); }}>
                Get Started with Glow Membership
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
