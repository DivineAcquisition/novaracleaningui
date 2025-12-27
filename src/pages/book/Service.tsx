import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MembershipBanner } from "@/components/booking/MembershipBanner";
import { Sparkles, Zap, Package, ArrowRight, ArrowLeft, Clock, Crown, Check, Star, ChevronDown, ChevronUp, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours, HOURLY_RATE, MEMBERSHIP_PLANS, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
// BookingFooter removed - using inline buttons
import { ServiceSkeleton } from "@/components/booking/ServiceSkeleton";
import { PageTransition } from "@/components/booking/PageTransition";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

// New Year's Special Offer - Ends Jan 31, 2025
const NEW_YEARS_OFFER_END = new Date('2025-01-31T23:59:59');
const DEEP_CLEAN_DISCOUNT = 60;

// Other service options (collapsed by default)
const OTHER_SERVICES = [
  {
    id: 'standard',
    icon: Sparkles,
    name: 'Standard Clean',
    description: 'Regular maintenance cleaning',
    features: ['Dusting & vacuuming', 'Kitchen & bath', 'Mopping floors'],
  },
  {
    id: 'moveInOut',
    icon: Package,
    name: 'Move-In/Out',
    description: 'Complete empty home cleaning',
    features: ['All Deep Clean +', 'Inside cabinets', 'Interior windows', 'Fridge & Oven Included'],
  },
];

const ADD_ONS = [
  { id: 'fridge', label: 'Inside Fridge', price: 30 },
  { id: 'oven', label: 'Inside Oven', price: 30 },
  { id: 'windows', label: 'Interior Windows', price: 40 },
];

export default function BookingService() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>(bookingData.addOns || []);
  const [selectedMembership, setSelectedMembership] = useState<string>(bookingData.membershipPlan || 'none');
  const [isLoading, setIsLoading] = useState(true);
  const [showOtherServices, setShowOtherServices] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const isMobile = useIsMobile();

  // Calculate days remaining for New Year's offer
  useEffect(() => {
    const now = new Date();
    const diff = NEW_YEARS_OFFER_END.getTime() - now.getTime();
    const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    setDaysRemaining(days);
  }, []);

  // Simulate loading state for initial render
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // Calculate estimated prices for each service
  const servicePrices = useMemo(() => {
    const homeSizeId = bookingData.homeSizeId;
    const homeSize = HOME_SIZE_RANGES.find(h => h.id === homeSizeId);
    const basePrice = homeSize?.standardPrice || 150;
    
    return {
      standard: basePrice + SERVICE_TIER_PRICING.standard.addition,
      deep: basePrice + SERVICE_TIER_PRICING.deep.addition,
      moveInOut: basePrice + SERVICE_TIER_PRICING.moveInOut.addition,
    };
  }, [bookingData.homeSizeId]);

  // Deep Clean price with $60 discount
  const deepCleanOriginalPrice = servicePrices.deep;
  const deepCleanDiscountedPrice = deepCleanOriginalPrice - DEEP_CLEAN_DISCOUNT;

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(2);
      navigate("/book/home");
    },
    step: 3,
  });

  const handleSelectEssentialMembership = () => {
    setSelectedMembership('essential');
    updateBookingData({ 
      serviceType: 'standard',
      membershipPlan: 'essential',
      addOns: selectedAddOns,
    });
  };

  const handleSelectDeepCleanOffer = () => {
    // Filter out fridge & oven from add-ons for deep clean
    const filteredAddOns = selectedAddOns.filter(addon => addon === 'windows');
    
    updateBookingData({ 
      serviceType: 'deep',
      membershipPlan: 'none',
      addOns: filteredAddOns,
      // Store the New Year's discount flag
      promoCode: 'NEWYEAR60',
    });
  };

  const handleSelectOtherService = (serviceId: string) => {
    const filteredAddOns = serviceId === 'moveInOut' 
      ? selectedAddOns.filter(addon => addon === 'windows')
      : selectedAddOns;
    
    updateBookingData({ 
      serviceType: serviceId,
      addOns: filteredAddOns,
      membershipPlan: 'none',
      promoCode: undefined, // Clear any promo for other services
    });
  };

  const handleContinue = () => {
    if (!bookingData.serviceType) return;
    
    const filteredAddOns = bookingData.serviceType === 'moveInOut' 
      ? selectedAddOns.filter(addon => addon === 'windows')
      : selectedAddOns;
    
    updateBookingData({ 
      addOns: filteredAddOns,
      membershipPlan: selectedMembership
    });
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  const handleAddOnToggle = (addonId: string) => {
    setSelectedAddOns(prev => 
      prev.includes(addonId) 
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const handleBack = () => {
    setCurrentStep(2);
    navigate("/book/home");
  };

  const estimatedHours = getEstimatedHours(bookingData.homeSizeId);
  const essentialPlan = MEMBERSHIP_PLANS.essential;

  // Check if an offer is selected
  const isEssentialSelected = bookingData.membershipPlan === 'essential';
  const isDeepCleanOfferSelected = bookingData.serviceType === 'deep' && bookingData.promoCode === 'NEWYEAR60';
  const isOtherServiceSelected = (bookingData.serviceType === 'standard' || bookingData.serviceType === 'moveInOut') && !isEssentialSelected;

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
        <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      {isLoading ? (
        <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8">
          <ServiceSkeleton />
        </div>
      ) : (
        <>
          <div className="container max-w-3xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-4 md:space-y-6">
            
            {/* New Year's Special Banner */}
            {daysRemaining > 0 && (
              <Card className="bg-gradient-to-r from-amber-500/20 via-amber-400/15 to-amber-500/20 border-2 border-amber-400/50 shadow-lg animate-slide-in-left overflow-hidden relative">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMyIgY3k9IjMiIHI9IjEuNSIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIwLjEiLz48L3N2Zz4=')] opacity-50" />
                <CardContent className="p-4 md:p-6 relative z-10">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 bg-amber-400/30 rounded-full flex items-center justify-center">
                        <PartyPopper className="w-6 h-6 md:w-7 md:h-7 text-amber-600" />
                      </div>
                      <div>
                        <h3 className="text-lg md:text-xl font-bold text-amber-700 font-jakarta">
                          🎆 New Year's Special!
                        </h3>
                        <p className="text-sm md:text-base text-amber-600/90">
                          Limited time offers - Choose one below
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-2xl md:text-3xl font-black text-amber-600">{daysRemaining}</div>
                      <div className="text-xs md:text-sm text-amber-600/80 font-medium">days left</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Membership Banner for existing members */}
            {user && credits && <MembershipBanner />}
            
            {/* Two Featured Offers */}
            <div className="space-y-4">
              
              {/* OFFER 1: Essential Membership */}
              <Card 
                className={cn(
                  "relative overflow-hidden transition-all duration-300 cursor-pointer",
                  isEssentialSelected 
                    ? "ring-2 ring-primary border-primary bg-primary/5 shadow-xl" 
                    : "border-2 border-primary/30 hover:border-primary/60 hover:shadow-lg"
                )}
                onClick={handleSelectEssentialMembership}
              >
                {/* Selection Checkmark */}
                {isEssentialSelected && (
                  <div className="absolute top-4 right-4 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg z-10 animate-scale-in">
                    <Check className="w-5 h-5 text-primary-foreground" strokeWidth={3} />
                  </div>
                )}
                
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-primary via-primary/90 to-primary py-1.5 px-4">
                  <div className="flex items-center justify-center gap-2">
                    <Crown className="w-4 h-4 text-primary-foreground" />
                    <span className="text-xs md:text-sm font-bold text-primary-foreground uppercase tracking-wide">
                      Offer 1: Start Fresh in 2025
                    </span>
                  </div>
                </div>
                
                <CardContent className="pt-12 pb-6 px-4 md:px-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Crown className="w-6 h-6 text-primary" />
                        <h3 className="text-xl md:text-2xl font-bold font-jakarta">Essential Membership</h3>
                      </div>
                      
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-3xl md:text-4xl font-black text-primary">${essentialPlan.monthlyPrice}</span>
                        <span className="text-muted-foreground">/month</span>
                      </div>
                      
                      <ul className="space-y-2">
                        {essentialPlan.features.map((feature, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm md:text-base">
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                              <Check className="w-3 h-3 text-primary" />
                            </div>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    <div className="flex flex-col items-center md:items-end gap-2">
                      <Button 
                        size="lg" 
                        className={cn(
                          "w-full md:w-auto px-8",
                          isEssentialSelected ? "bg-success hover:bg-success/90" : ""
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectEssentialMembership();
                        }}
                      >
                        {isEssentialSelected ? (
                          <>
                            <Check className="w-5 h-5 mr-2" />
                            Selected
                          </>
                        ) : (
                          <>
                            <Crown className="w-5 h-5 mr-2" />
                            Select Membership
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center md:text-right">
                        Cancel anytime
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* OFFER 2: Deep Clean $60 Off */}
              <Card 
                className={cn(
                  "relative overflow-hidden transition-all duration-300 cursor-pointer",
                  isDeepCleanOfferSelected 
                    ? "ring-2 ring-success border-success bg-success/5 shadow-xl" 
                    : "border-2 border-success/30 hover:border-success/60 hover:shadow-lg"
                )}
                onClick={handleSelectDeepCleanOffer}
              >
                {/* Selection Checkmark */}
                {isDeepCleanOfferSelected && (
                  <div className="absolute top-4 right-4 w-8 h-8 bg-success rounded-full flex items-center justify-center shadow-lg z-10 animate-scale-in">
                    <Check className="w-5 h-5 text-white" strokeWidth={3} />
                  </div>
                )}
                
                <div className="absolute top-0 left-0 right-0 bg-gradient-to-r from-success via-success/90 to-success py-1.5 px-4">
                  <div className="flex items-center justify-center gap-2">
                    <Zap className="w-4 h-4 text-white" />
                    <span className="text-xs md:text-sm font-bold text-white uppercase tracking-wide">
                      Offer 2: One-Time Fresh Start
                    </span>
                  </div>
                </div>
                
                <CardContent className="pt-12 pb-6 px-4 md:px-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-6 h-6 text-success" />
                        <h3 className="text-xl md:text-2xl font-bold font-jakarta">Deep Clean</h3>
                        <Badge className="bg-success text-white text-sm font-bold px-3">
                          $60 OFF
                        </Badge>
                      </div>
                      
                      <div className="flex items-baseline gap-2 mb-4">
                        <span className="text-xl text-muted-foreground line-through">${deepCleanOriginalPrice}</span>
                        <span className="text-3xl md:text-4xl font-black text-success">${deepCleanDiscountedPrice}</span>
                        <span className="text-muted-foreground">est.</span>
                      </div>
                      
                      <ul className="space-y-2">
                        <li className="flex items-center gap-2 text-sm md:text-base">
                          <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-success" />
                          </div>
                          <span>Top-to-bottom thorough cleaning</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm md:text-base">
                          <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-success" />
                          </div>
                          <span>Baseboards & detailed dusting</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm md:text-base">
                          <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-success" />
                          </div>
                          <span>Inside appliances</span>
                        </li>
                        <li className="flex items-center gap-2 text-sm md:text-base">
                          <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                            <Star className="w-3 h-3 text-success" />
                          </div>
                          <span className="font-medium text-success">Perfect for post-holiday refresh</span>
                        </li>
                      </ul>
                    </div>
                    
                    <div className="flex flex-col items-center md:items-end gap-2">
                      <Button 
                        size="lg" 
                        variant={isDeepCleanOfferSelected ? "default" : "outline"}
                        className={cn(
                          "w-full md:w-auto px-8 border-2",
                          isDeepCleanOfferSelected 
                            ? "bg-success hover:bg-success/90 border-success text-white" 
                            : "border-success text-success hover:bg-success hover:text-white"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectDeepCleanOffer();
                        }}
                      >
                        {isDeepCleanOfferSelected ? (
                          <>
                            <Check className="w-5 h-5 mr-2" />
                            Selected
                          </>
                        ) : (
                          <>
                            <Zap className="w-5 h-5 mr-2" />
                            Get $60 Off
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center md:text-right">
                        No commitment required
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Other Services (Collapsible) */}
            <Collapsible open={showOtherServices} onOpenChange={setShowOtherServices}>
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  className="w-full justify-between text-muted-foreground hover:text-foreground"
                >
                  <span>Other cleaning options</span>
                  {showOtherServices ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                {OTHER_SERVICES.map((service) => {
                  const isSelected = bookingData.serviceType === service.id && !isEssentialSelected && !isDeepCleanOfferSelected;
                  const price = servicePrices[service.id as keyof typeof servicePrices];
                  
                  return (
                    <Card
                      key={service.id}
                      className={cn(
                        "card-interactive relative touch-manipulation transition-all duration-200 cursor-pointer",
                        isSelected 
                          ? "ring-2 ring-primary border-primary bg-primary/5 shadow-lg" 
                          : "hover:border-primary/50"
                      )}
                      onClick={() => handleSelectOtherService(service.id)}
                    >
                      {isSelected && (
                        <div className="absolute top-3 right-3 w-6 h-6 bg-primary rounded-full flex items-center justify-center shadow-md z-10">
                          <Check className="w-4 h-4 text-primary-foreground" strokeWidth={3} />
                        </div>
                      )}
                      
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            isSelected ? "bg-primary text-primary-foreground" : "bg-primary/10"
                          )}>
                            <service.icon className={cn(
                              "w-5 h-5",
                              isSelected ? "text-primary-foreground" : "text-primary"
                            )} />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h3 className="text-base font-bold">{service.name}</h3>
                              <span className="text-lg font-bold text-primary">${price}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>

            {/* Add-ons Section - Only show if a service is selected */}
            {bookingData.serviceType && (
              <Card variant="outlined" className="animate-fade-in">
                <CardHeader className="pb-3 px-4">
                  <CardTitle className="text-base md:text-lg font-semibold">À La Carte Add-ons</CardTitle>
                  <CardDescription className="text-xs md:text-sm">
                    {bookingData.serviceType === 'moveInOut' 
                      ? 'Fridge & Oven included with Move-In/Out'
                      : 'Enhance your cleaning with extras'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid gap-2 md:gap-3 grid-cols-1 sm:grid-cols-3">
                    {ADD_ONS.map((addon) => {
                      const isIncluded = bookingData.serviceType === 'moveInOut' && addon.id !== 'windows';
                      const isChecked = isIncluded || selectedAddOns.includes(addon.id);
                      
                      return (
                        <label
                          key={addon.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer",
                            isIncluded 
                              ? "bg-success/10 border-success/30" 
                              : isChecked 
                                ? "bg-primary/5 border-primary" 
                                : "hover:border-primary/50"
                          )}
                        >
                          <Checkbox
                            checked={isChecked}
                            disabled={isIncluded}
                            onCheckedChange={() => handleAddOnToggle(addon.id)}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <div className="flex-1">
                            <span className="text-sm font-medium">{addon.label}</span>
                            {isIncluded ? (
                              <Badge variant="secondary" className="ml-2 text-[10px]">Included</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground ml-1">+${addon.price}</span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Desktop Navigation */}
            {!isMobile && (
              <div className="flex justify-between items-center gap-4 pt-4">
                <Button 
                  variant="outline" 
                  onClick={handleBack}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
                
                <Button 
                  onClick={handleContinue}
                  disabled={!bookingData.serviceType}
                  className="flex items-center gap-2 min-w-[140px]"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
          
          {/* Mobile Bottom Navigation */}
          {isMobile && (
            <BottomNavigation
              onBack={handleBack}
              onContinue={handleContinue}
              continueDisabled={!bookingData.serviceType}
              currentStep={3}
              totalSteps={6}
              steps={BOOKING_STEPS}
            />
          )}
        </>
      )}
      </div>
    </PageTransition>
  );
}
