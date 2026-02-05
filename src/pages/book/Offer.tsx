import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Gift, Check, ArrowLeft, Phone, ChevronRight, MapPin, Sparkles, Star, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PageTransition } from "@/components/booking/PageTransition";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { 
  HOME_SIZE_RANGES, 
  SERVICE_TYPE_MULTIPLIERS,
  getZoneModifier, 
  MEMBERSHIP_PRICES,
  MEMBERSHIP_FIRST_CLEAN_FEE,
  ADD_ONS
} from "@/lib/pricing-system";
import { format } from "date-fns";
import { toast } from "sonner";
import SEO from "@/components/SEO";

// Service types with their features
const SERVICE_TYPES = {
  standard: {
    name: "Standard Clean",
    description: "Regular maintenance cleaning",
    multiplier: 1.0,
    features: [
      "Dusting all surfaces",
      "Vacuuming & mopping floors",
      "Kitchen & bathroom cleaning",
      "Trash removal",
      "Bed making"
    ]
  },
  deep: {
    name: "Deep Clean",
    description: "Thorough top-to-bottom cleaning",
    multiplier: 1.5,
    features: [
      "Everything in Standard, plus:",
      "Baseboards & door frames",
      "Inside cabinets wiped",
      "Light fixtures & ceiling fans",
      "Detailed bathroom scrubbing",
      "Behind & under furniture"
    ]
  },
  moveInOut: {
    name: "Move-In/Out Clean",
    description: "Complete empty home cleaning",
    multiplier: 2.0,
    includes: ["fridge", "oven"],
    features: [
      "Everything in Deep Clean, plus:",
      "Inside fridge (included)",
      "Inside oven (included)",
      "Inside all cabinets & drawers",
      "Closet interiors",
      "Garage sweeping (if applicable)"
    ]
  }
};

// Membership plans
const MEMBERSHIP_PLANS = {
  monthly: {
    id: "monthly",
    name: "Monthly",
    frequency: "1x per month",
    discount: "14-18% off",
    features: ["1 clean per month", "Same trusted team", "Priority scheduling", "Cancel anytime"]
  },
  biweekly: {
    id: "biweekly", 
    name: "Bi-Weekly",
    frequency: "2x per month",
    discount: "33-34% off",
    recommended: true,
    features: ["2 cleans per month", "Same trusted team", "Priority scheduling", "Best value", "Cancel anytime"]
  },
  weekly: {
    id: "weekly",
    name: "Weekly",
    frequency: "4x per month", 
    discount: "40-42% off",
    features: ["4 cleans per month", "Same trusted team", "VIP scheduling", "Maximum savings", "Cancel anytime"]
  }
};

export default function BookingOffer() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showServiceModal, setShowServiceModal] = useState<string | null>(null);
  const [selectedServiceType, setSelectedServiceType] = useState<'standard' | 'deep' | 'moveInOut'>('standard');
  const [selectedFrequency, setSelectedFrequency] = useState<'one_time' | 'monthly' | 'biweekly' | 'weekly'>('one_time');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + 'T12:00:00') : undefined
  );
  const [showScheduler, setShowScheduler] = useState(false);

  // Get home size data
  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  // Get zone modifier
  const zoneModifier = useMemo(() => {
    if (bookingData.pricingZone?.modifier) {
      return bookingData.pricingZone.modifier;
    }
    return bookingData.zipCode ? getZoneModifier(bookingData.zipCode) : 1.0;
  }, [bookingData.zipCode, bookingData.pricingZone]);

  // Calculate all prices
  const prices = useMemo(() => {
    if (!selectedHomeSize || selectedHomeSize.id === '5000_plus') {
      return null;
    }

    const basePrice = selectedHomeSize.standardPrice;
    const zonedBasePrice = Math.round(basePrice * zoneModifier);

    // One-time prices by service type
    const oneTime = {
      standard: zonedBasePrice,
      deep: Math.round(zonedBasePrice * SERVICE_TYPE_MULTIPLIERS.deep.multiplier),
      moveInOut: Math.round(zonedBasePrice * SERVICE_TYPE_MULTIPLIERS.moveInOut.multiplier),
    };

    // Get membership prices for this home size
    const homeSizeKey = bookingData.homeSizeId as keyof typeof MEMBERSHIP_PRICES.monthly;
    const membershipMonthly = MEMBERSHIP_PRICES.monthly[homeSizeKey];
    const membershipBiweekly = MEMBERSHIP_PRICES.biweekly[homeSizeKey];
    const membershipWeekly = MEMBERSHIP_PRICES.weekly[homeSizeKey];

    // Apply zone modifier to membership prices
    const membership = {
      monthly: membershipMonthly ? Math.round(membershipMonthly.price * zoneModifier) : 0,
      biweekly: membershipBiweekly ? Math.round(membershipBiweekly.price * zoneModifier) : 0,
      weekly: membershipWeekly ? Math.round(membershipWeekly.price * zoneModifier) : 0,
    };

    // Calculate per-clean savings for memberships
    const savings = {
      monthly: oneTime.standard - membership.monthly,
      biweeklyPerClean: Math.round((oneTime.standard * 2 - membership.biweekly) / 2),
      weeklyPerClean: Math.round((oneTime.standard * 4 - membership.weekly) / 4),
    };

    return {
      oneTime,
      membership,
      savings,
      firstCleanFee: MEMBERSHIP_FIRST_CLEAN_FEE,
      zoneModifier,
      isZoneAdjusted: zoneModifier !== 1.0,
    };
  }, [selectedHomeSize, zoneModifier, bookingData.homeSizeId]);

  // Calculate current selection price
  const currentPrice = useMemo(() => {
    if (!prices) return { total: 0, deposit: 0, perMonth: 0 };

    if (selectedFrequency === 'one_time') {
      const servicePrice = prices.oneTime[selectedServiceType];
      return {
        total: servicePrice,
        deposit: Math.round(servicePrice * 0.25),
        perMonth: 0
      };
    }

    // Membership pricing
    const membershipPrice = prices.membership[selectedFrequency as 'monthly' | 'biweekly' | 'weekly'];
    const firstCleanTotal = membershipPrice + prices.firstCleanFee;
    
    return {
      total: membershipPrice,
      deposit: Math.round(membershipPrice * 0.25),
      perMonth: membershipPrice,
      firstCleanFee: prices.firstCleanFee,
      firstCleanTotal
    };
  }, [prices, selectedServiceType, selectedFrequency]);

  // Check for custom quote requirement
  const requiresCustomQuote = selectedHomeSize?.id === '5000_plus';

  const handleServiceSelect = (service: 'standard' | 'deep' | 'moveInOut') => {
    setSelectedServiceType(service);
    setSelectedFrequency('one_time');
  };

  const handleMembershipSelect = (frequency: 'monthly' | 'biweekly' | 'weekly') => {
    setSelectedFrequency(frequency);
    setSelectedServiceType('standard'); // Memberships are standard cleans
  };

  const handleContinue = () => {
    // Update booking data
    updateBookingData({
      serviceType: selectedServiceType,
      membershipPlan: selectedFrequency === 'one_time' ? 'none' : selectedFrequency,
      frequency: selectedFrequency,
    });
    setShowScheduler(true);
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
        <div className="min-h-screen bg-background pb-32 md:pb-8">
          <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
          
          <div className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
            <Card className="border border-primary/30">
              <CardContent className="pt-8 pb-8 text-center space-y-6">
                <h1 className="text-2xl md:text-3xl font-bold">Custom Quote Required</h1>
                <p className="text-muted-foreground">
                  Homes over 5,000 sq ft require a customized quote to ensure accurate pricing.
                </p>
                
                <div className="flex items-center justify-center gap-2 text-lg font-semibold text-primary">
                  <Phone className="w-5 h-5" />
                  <a href="tel:3018005252">(301) 800-5252</a>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild size="lg" className="bg-gradient-to-r from-primary to-purple-600">
                    <a href="tel:3018005252">
                      <Phone className="w-4 h-4 mr-2" />
                      Call for Quote
                    </a>
                  </Button>
                  <Button variant="outline" size="lg" onClick={handleBack}>
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
      <SEO 
        title="Choose Your Service | One-Time or Membership | Novara Cleaning"
        description="Choose between one-time deep cleaning or save up to 40% with our membership plans. Flexible scheduling available."
      />
      <div className="min-h-screen bg-background pb-32 md:pb-8">
        <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />

        <div className="container max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* Header */}
          <div className="text-center space-y-3">
            <h1 className="text-2xl md:text-3xl font-bold">Choose Your Service</h1>
            <p className="text-muted-foreground">
              {selectedHomeSize?.label} • {selectedHomeSize?.bedroomRange}
            </p>
            
            {/* Zone Badge */}
            {bookingData.pricingZone && (
              <div className="flex items-center justify-center gap-2">
                <Badge 
                  variant="outline" 
                  className={cn(
                    "border",
                    bookingData.pricingZone.id === 'A' && "bg-amber-50 border-amber-300 text-amber-700",
                    bookingData.pricingZone.id === 'C' && "bg-green-50 border-green-300 text-green-700"
                  )}
                >
                  <MapPin className="w-3 h-3 mr-1" />
                  {bookingData.pricingZone.name} Zone
                </Badge>
                {prices?.isZoneAdjusted && (
                  <span className="text-xs text-muted-foreground">
                    {zoneModifier > 1 
                      ? `+${Math.round((zoneModifier - 1) * 100)}%`
                      : `-${Math.round((1 - zoneModifier) * 100)}%`
                    }
                  </span>
                )}
              </div>
            )}
          </div>

          {/* One-Time Services */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              One-Time Cleaning
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(SERVICE_TYPES).map(([key, service]) => {
                const serviceKey = key as 'standard' | 'deep' | 'moveInOut';
                const price = prices?.oneTime[serviceKey] || 0;
                const isSelected = selectedServiceType === serviceKey && selectedFrequency === 'one_time';
                
                return (
                  <Card 
                    key={key}
                    className={cn(
                      "cursor-pointer transition-all border",
                      isSelected 
                        ? "border-primary bg-primary/5 shadow-md" 
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => handleServiceSelect(serviceKey)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-sm">{service.name}</h3>
                          <p className="text-xs text-muted-foreground">{service.description}</p>
                        </div>
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                          isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                        )}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                      
                      <div className="mt-3">
                        <span className="text-2xl font-bold">${price}</span>
                        {serviceKey !== 'standard' && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({service.multiplier}x)
                          </span>
                        )}
                      </div>
                      
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="mt-2 h-7 text-xs w-full"
                        onClick={(e) => { e.stopPropagation(); setShowServiceModal(key); }}
                      >
                        What's included?
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Membership Plans */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500" />
              Membership Plans
              <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                Save up to 42%
              </Badge>
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => {
                const planKey = key as 'monthly' | 'biweekly' | 'weekly';
                const price = prices?.membership[planKey] || 0;
                const isSelected = selectedFrequency === planKey;
                
                return (
                  <Card 
                    key={key}
                    className={cn(
                      "cursor-pointer transition-all border relative",
                      isSelected 
                        ? "border-green-500 bg-green-500/5 shadow-md" 
                        : "border-border hover:border-green-500/50",
                      plan.recommended && "ring-2 ring-green-500/20"
                    )}
                    onClick={() => handleMembershipSelect(planKey)}
                  >
                    {plan.recommended && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                        <Badge className="bg-green-500 text-white text-[10px] px-2">
                          <Star className="w-3 h-3 mr-1" />
                          Best Value
                        </Badge>
                      </div>
                    )}
                    
                    <CardContent className="p-4 pt-5">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-sm">{plan.name}</h3>
                          <p className="text-xs text-muted-foreground">{plan.frequency}</p>
                        </div>
                        <div className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                          isSelected ? "border-green-500 bg-green-500" : "border-muted-foreground/30"
                        )}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                      
                      <div className="mt-3">
                        <span className="text-2xl font-bold text-green-600">${price}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </div>
                      
                      <Badge variant="outline" className="mt-2 text-[10px] border-green-500/30 text-green-600">
                        {plan.discount}
                      </Badge>
                      
                      <p className="text-[10px] text-muted-foreground mt-2">
                        + ${prices?.firstCleanFee} first clean fee
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Selected Summary & Continue */}
          <Card className="border border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Your Selection</p>
                  <p className="text-lg font-bold">
                    {selectedFrequency === 'one_time' 
                      ? SERVICE_TYPES[selectedServiceType].name
                      : `${MEMBERSHIP_PLANS[selectedFrequency as keyof typeof MEMBERSHIP_PLANS]?.name} Membership`
                    }
                  </p>
                  {selectedFrequency !== 'one_time' && (
                    <p className="text-xs text-muted-foreground">
                      First month: ${currentPrice.perMonth} + ${prices?.firstCleanFee} fee = ${(currentPrice.perMonth || 0) + (prices?.firstCleanFee || 0)}
                    </p>
                  )}
                </div>
                
                <div className="text-right">
                  <p className="text-3xl font-bold text-primary">
                    ${selectedFrequency === 'one_time' ? currentPrice.total : currentPrice.perMonth}
                    {selectedFrequency !== 'one_time' && <span className="text-sm font-normal">/mo</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pay ${currentPrice.deposit} deposit today
                  </p>
                </div>
              </div>
              
              {!showScheduler && (
                <Button 
                  size="lg" 
                  className="w-full mt-4 bg-gradient-to-r from-primary to-purple-600"
                  onClick={handleContinue}
                >
                  Continue to Schedule
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Schedule Picker */}
          {showScheduler && (
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
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home Size
            </Button>
          </div>
        </div>

        {/* Service Detail Modals */}
        {Object.entries(SERVICE_TYPES).map(([key, service]) => (
          <Dialog key={key} open={showServiceModal === key} onOpenChange={() => setShowServiceModal(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{service.name}</DialogTitle>
                <DialogDescription>{service.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-4">
                {service.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
                {service.includes && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      Includes: {service.includes.map(a => ADD_ONS[a as keyof typeof ADD_ONS]?.label).join(', ')}
                    </p>
                  </div>
                )}
              </div>
              <Button 
                className="w-full" 
                onClick={() => {
                  handleServiceSelect(key as 'standard' | 'deep' | 'moveInOut');
                  setShowServiceModal(null);
                }}
              >
                Select {service.name}
              </Button>
            </DialogContent>
          </Dialog>
        ))}
      </div>
    </PageTransition>
  );
}
