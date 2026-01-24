import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, ArrowLeft, Phone, ChevronRight, Sparkles, Shield, Star, Users, CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PageTransition } from "@/components/booking/PageTransition";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
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

// Deep clean features
const DEEP_CLEAN_FEATURES = [
  { icon: Check, text: "40-point comprehensive checklist" },
  { icon: Users, text: "2-person professional team" },
  { icon: Shield, text: "All supplies & equipment included" },
  { icon: Star, text: "48-hour satisfaction guarantee" },
];

// Membership features
const MEMBERSHIP_FEATURES = [
  { icon: CalendarCheck, text: "Flexible scheduling (bi-weekly or monthly)" },
  { icon: Users, text: "Dedicated cleaning team" },
  { icon: Sparkles, text: "Priority booking & member perks" },
  { icon: Shield, text: "Pause or cancel anytime" },
  { icon: Star, text: "48-hour re-clean guarantee" },
];

export default function BookingOffer() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showDeepCleanModal, setShowDeepCleanModal] = useState(false);
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [selectedService, setSelectedService] = useState<'deep' | 'membership' | null>(null);
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

    return {
      deepClean: {
        price: deepCleanPrice,
        deposit: Math.round(deepCleanPrice * 0.25),
      },
      membership: {
        monthlyPrice: 189,
        perClean: basePrice,
      },
    };
  }, [selectedHomeSize]);

  // Check for custom quote requirement (5000+ sq ft)
  const requiresCustomQuote = selectedHomeSize?.id === '5000_plus';

  const handleSelectDeepClean = () => {
    setSelectedService('deep');
    updateBookingData({
      serviceType: 'deep',
      membershipPlan: 'none',
      paymentOption: 'deposit', // Allow payment options for one-time
    });
    // Scroll to scheduler
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectMembership = () => {
    setSelectedService('membership');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'biweekly',
      paymentOption: 'full', // Force full payment for membership
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
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 pb-32 md:pb-8">
          <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
          
          <div className="container max-w-2xl mx-auto px-4 py-12 space-y-6">
            <Card className="border-2 border-primary/20">
              <CardContent className="pt-10 pb-10 text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                  <Phone className="w-8 h-8 text-primary" />
                </div>
                <h1 className="text-2xl md:text-3xl font-bold">Custom Quote Required</h1>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Your home requires a customized quote to ensure accurate pricing and service delivery.
                </p>
                
                <div className="grid grid-cols-2 gap-4 text-left max-w-sm mx-auto">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="font-semibold text-foreground">Deep Clean</p>
                    <p className="text-sm text-muted-foreground">Starting at $500</p>
                  </div>
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <p className="font-semibold text-foreground">Membership</p>
                    <p className="text-sm text-muted-foreground">Starting at $400/visit</p>
                  </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 text-xl font-semibold text-primary">
                  <Phone className="w-5 h-5" />
                  <a href="tel:9725590223" className="hover:underline">(972) 559-0223</a>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <Button asChild size="lg" className="h-12">
                    <a href="tel:9725590223">
                      <Phone className="w-4 h-4 mr-2" />
                      Call Now
                    </a>
                  </Button>
                  <Button variant="outline" size="lg" onClick={handleBack} className="h-12">
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
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900 pb-32 md:pb-8">
        <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />

        <div className="container max-w-5xl mx-auto px-4 py-8 md:py-12 space-y-8 md:space-y-12">
          {/* Hero Section */}
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              Premium Cleaning Services
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
              Choose Your Service
            </h1>
            <p className="text-muted-foreground text-lg md:text-xl leading-relaxed">
              Professional cleaning tailored to your needs. Select the option that works best for your home.
            </p>
          </div>

          {/* Service Cards */}
          <div id="offers-section" className="grid lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Deep Clean Card */}
            <Card 
              className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                "border-2 hover:shadow-2xl hover:shadow-primary/10",
                selectedService === 'deep' 
                  ? "border-primary ring-4 ring-primary/20 shadow-xl" 
                  : "border-slate-200 dark:border-slate-800 hover:border-primary/50"
              )}
              onClick={handleSelectDeepClean}
            >
              {/* Selection indicator */}
              {selectedService === 'deep' && (
                <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" />
                </div>
              )}
              
              <CardContent className="p-6 md:p-8 space-y-6">
                {/* Header */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">One-Time Service</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-foreground">Deep Clean</h3>
                  <p className="text-muted-foreground">A thorough top-to-bottom clean for your entire home</p>
                </div>
                
                {/* Pricing */}
                <div className="py-4 border-y border-slate-100 dark:border-slate-800">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl md:text-5xl font-bold text-foreground">${prices.deepClean.price}</span>
                    <span className="text-muted-foreground text-lg">one-time</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Or pay ${prices.deepClean.deposit} deposit today, rest after service
                  </p>
                </div>
                
                {/* Features */}
                <ul className="space-y-3">
                  {DEEP_CLEAN_FEATURES.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <feature.icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm text-foreground">{feature.text}</span>
                    </li>
                  ))}
                </ul>
                
                {/* CTA */}
                <div className="space-y-3 pt-2">
                  <Button 
                    size="lg" 
                    className={cn(
                      "w-full font-semibold h-12 text-base transition-all",
                      selectedService === 'deep' 
                        ? "bg-primary" 
                        : "bg-primary/90 group-hover:bg-primary"
                    )}
                  >
                    {selectedService === 'deep' ? 'Selected' : 'Select Deep Clean'}
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); setShowDeepCleanModal(true); }}
                  >
                    View full checklist
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Membership Card */}
            <Card 
              className={cn(
                "relative overflow-hidden transition-all duration-300 cursor-pointer group",
                "border-2 hover:shadow-2xl hover:shadow-emerald-500/10",
                selectedService === 'membership' 
                  ? "border-emerald-500 ring-4 ring-emerald-500/20 shadow-xl" 
                  : "border-slate-200 dark:border-slate-800 hover:border-emerald-500/50"
              )}
              onClick={handleSelectMembership}
            >
              {/* Popular Badge */}
              <div className="absolute top-0 right-0">
                <div className="bg-emerald-500 text-white text-xs font-bold px-4 py-1.5 rounded-bl-lg">
                  RECOMMENDED
                </div>
              </div>
              
              {/* Selection indicator */}
              {selectedService === 'membership' && (
                <div className="absolute top-4 left-4 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center">
                  <Check className="w-5 h-5 text-white" />
                </div>
              )}
              
              <CardContent className="p-6 md:p-8 space-y-6">
                {/* Header */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Membership Plan</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-foreground">Novara Membership</h3>
                  <p className="text-muted-foreground">Keep your home consistently clean with scheduled service</p>
                </div>
                
                {/* Pricing */}
                <div className="py-4 border-y border-slate-100 dark:border-slate-800">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl md:text-5xl font-bold text-foreground">${prices.membership.monthlyPrice}</span>
                    <span className="text-muted-foreground text-lg">/month</span>
                  </div>
                  <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium mt-2">
                    Includes 1 professional cleaning per month
                  </p>
                </div>
                
                {/* Features */}
                <ul className="space-y-3">
                  {MEMBERSHIP_FEATURES.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                        <feature.icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <span className="text-sm text-foreground">{feature.text}</span>
                    </li>
                  ))}
                </ul>
                
                {/* CTA */}
                <div className="space-y-3 pt-2">
                  <Button 
                    size="lg" 
                    className={cn(
                      "w-full font-semibold h-12 text-base transition-all",
                      selectedService === 'membership' 
                        ? "bg-emerald-500 hover:bg-emerald-600" 
                        : "bg-emerald-500/90 hover:bg-emerald-500 group-hover:bg-emerald-500"
                    )}
                  >
                    {selectedService === 'membership' ? 'Selected' : 'Select Membership'}
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); setShowMembershipModal(true); }}
                  >
                    View membership details
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Schedule Picker - Shows after service selection */}
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
          <div className="flex justify-center pt-4">
            <Button variant="ghost" onClick={handleBack} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home Size
            </Button>
          </div>
        </div>

        {/* Deep Clean Modal */}
        <Dialog open={showDeepCleanModal} onOpenChange={setShowDeepCleanModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Deep Clean — Full Checklist</DialogTitle>
              <DialogDescription>
                Our comprehensive 40-point cleaning for a complete home reset.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-2.5">
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
                  <div key={idx} className="flex items-center gap-3 py-1">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full h-11" onClick={() => { setShowDeepCleanModal(false); handleSelectDeepClean(); }}>
                Select Deep Clean
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Membership Modal */}
        <Dialog open={showMembershipModal} onOpenChange={setShowMembershipModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">Novara Membership — Details</DialogTitle>
              <DialogDescription>
                Keep your home consistently clean with regular scheduled service.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid gap-2.5">
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
                  <div key={idx} className="flex items-center gap-3 py-1">
                    <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full h-11 bg-emerald-500 hover:bg-emerald-600" onClick={() => { setShowMembershipModal(false); handleSelectMembership(); }}>
                Select Membership
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
