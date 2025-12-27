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
import { Sparkles, Zap, Package, ArrowRight, ArrowLeft, Clock, Crown, Check, Star, TrendingUp, Gift } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours, HOURLY_RATE, MEMBERSHIP_PLANS, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { MembershipDetailsDialog } from "@/components/booking/MembershipDetailsDialog";
import { MembershipBottomSheet } from "@/components/booking/MembershipBottomSheet";
import { ServiceSkeleton } from "@/components/booking/ServiceSkeleton";
import { PageTransition } from "@/components/booking/PageTransition";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

// Service types without membership (separate section)
const SERVICES = [
  {
    id: 'standard',
    icon: Sparkles,
    name: 'Standard Clean',
    description: 'Regular maintenance cleaning',
    features: ['Dusting & vacuuming', 'Kitchen & bath', 'Mopping floors'],
    badge: 'Most Popular',
    badgeColor: 'bg-primary',
  },
  {
    id: 'deep',
    icon: Zap,
    name: 'Deep Clean',
    description: 'Thorough top-to-bottom',
    features: ['All Standard +', 'Baseboards', 'Inside appliances'],
    badge: null,
    badgeColor: null,
  },
  {
    id: 'moveInOut',
    icon: Package,
    name: 'Move-In/Out',
    description: 'Complete empty home',
    features: ['All Deep Clean +', 'Inside cabinets', 'Interior windows'],
    badge: 'Fridge & Oven Included',
    badgeColor: 'bg-success',
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isMobile = useIsMobile();

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

  // Calculate membership savings
  const membershipSavings = useMemo(() => {
    const homeSizeId = bookingData.homeSizeId;
    const basePrice = servicePrices.standard;
    
    // Calculate savings per month for Premium plan (most attractive)
    const premiumPlan = MEMBERSHIP_PLANS.premium;
    const cleansValue = premiumPlan.cleansPerMonth * basePrice;
    const monthlyCost = premiumPlan.monthlyPrice;
    const savingsPerMonth = Math.max(0, cleansValue - monthlyCost);
    
    return {
      monthlySavings: Math.round(savingsPerMonth),
      percentOff: Math.round(premiumPlan.overtimeDiscount * 100),
    };
  }, [bookingData.homeSizeId, servicePrices]);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(2);
      navigate("/book/home");
    },
    step: 3,
  });

  const handleSelect = (serviceType: string) => {
    // For moveInOut, filter out fridge & oven from add-ons (they're included)
    const filteredAddOns = serviceType === 'moveInOut' 
      ? selectedAddOns.filter(addon => addon === 'windows')
      : selectedAddOns;
    
    // Just select the service, don't auto-navigate
    updateBookingData({ 
      serviceType,
      addOns: filteredAddOns,
      membershipPlan: selectedMembership
    });
  };

  const handleContinue = () => {
    if (!bookingData.serviceType) return;
    
    // For moveInOut, filter out fridge & oven from add-ons (they're included)
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

  const handleMembershipSelect = (membershipId: keyof typeof MEMBERSHIP_PLANS) => {
    setSelectedMembership(membershipId);
    setDialogOpen(false);
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
          <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-4 md:space-y-6">
            {/* New Customer Promotion Banner */}
            {!user && (
              <Card className="bg-gradient-to-r from-success/10 via-success/5 to-background border-2 border-success/40 shadow-card animate-slide-in-left">
                <CardContent className="p-3 md:p-6">
                  <div className="flex items-center gap-2 md:gap-4">
                    <div className="flex-shrink-0 w-10 h-10 md:w-14 md:h-14 bg-success/20 rounded-full flex items-center justify-center">
                      <Gift className="w-5 h-5 md:w-7 md:h-7 text-success" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm md:text-lg font-semibold text-success font-jakarta">New Customer Special!</h3>
                      <p className="text-xs md:text-sm text-foreground mt-0.5 md:mt-1">
                        Save <span className="font-bold text-success">$30</span> on your first cleaning service. No membership required!
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Membership Banner for existing members */}
            {user && credits && <MembershipBanner />}
            
            {/* Service Selection Section */}
            <Card variant="outlined" className="animate-slide-in-right">
              <CardHeader className="text-center space-y-1.5 pb-4 px-3 md:px-6">
                <CardTitle className="text-lg md:text-2xl font-bold font-jakarta">Choose Your Service</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  {hasCredits 
                    ? 'Select a service to use your membership credit'
                    : 'Select the cleaning tier that fits your needs'}
                </CardDescription>
                {bookingData.homeSizeId && (
                  <div className="flex items-center justify-center gap-2 pt-2 text-sm font-medium text-primary">
                    <Clock className="w-4 h-4" />
                    <span>Estimated {estimatedHours} hours</span>
                  </div>
                )}
              </CardHeader>
              
              <CardContent className="space-y-6 md:space-y-8 px-3 md:px-6">
                {/* Service Cards Grid */}
                <div className="grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-3">
                  {SERVICES.map((service) => {
                    const isSelected = bookingData.serviceType === service.id;
                    const price = servicePrices[service.id as keyof typeof servicePrices];
                    
                    return (
                      <Card
                        key={service.id}
                        className={cn(
                          "card-interactive relative touch-manipulation transition-all duration-200 overflow-hidden",
                          isSelected 
                            ? "ring-2 ring-primary border-primary bg-primary/5 shadow-lg" 
                            : "hover:border-primary/50"
                        )}
                        onClick={() => handleSelect(service.id)}
                      >
                        {/* Selection Checkmark */}
                        {isSelected && (
                          <div className="absolute top-3 right-3 w-6 h-6 md:w-7 md:h-7 bg-primary rounded-full flex items-center justify-center shadow-md z-10">
                            <Check className="w-4 h-4 md:w-5 md:h-5 text-primary-foreground" strokeWidth={3} />
                          </div>
                        )}
                        
                        {/* Badge */}
                        {service.badge && (
                          <Badge className={cn(
                            "absolute -top-0 left-0 right-0 mx-auto w-fit text-[10px] md:text-xs py-0.5",
                            service.badgeColor || "bg-primary"
                          )}>
                            {service.badge}
                          </Badge>
                        )}
                        
                        <CardContent className="p-4 md:p-5 pt-5 md:pt-6">
                          <div className="flex items-start gap-3">
                            {/* Icon */}
                            <div className={cn(
                              "flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center transition-colors",
                              isSelected ? "bg-primary text-primary-foreground" : "bg-primary/10"
                            )}>
                              <service.icon className={cn(
                                "w-5 h-5 md:w-6 md:h-6",
                                isSelected ? "text-primary-foreground" : "text-primary"
                              )} />
                            </div>
                            
                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <h3 className="text-base md:text-lg font-bold">{service.name}</h3>
                              <p className="text-xs text-muted-foreground mt-0.5">{service.description}</p>
                              
                              {/* Price */}
                              <div className="mt-2 flex items-baseline gap-1">
                                <span className="text-xl md:text-2xl font-bold text-primary">${price}</span>
                                <span className="text-xs text-muted-foreground">est.</span>
                              </div>
                            </div>
                          </div>
                          
                          {/* Features */}
                          <ul className="mt-3 pt-3 border-t space-y-1.5">
                            {service.features.map((feature, idx) => (
                              <li key={idx} className="text-xs md:text-sm flex items-center gap-2">
                                <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Membership Upsell Section - Only show if no membership selected */}
                {selectedMembership === 'none' && !hasCredits && (
                  <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-accent/5 to-background overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row">
                        {/* Left side - Upsell content */}
                        <div className="flex-1 p-4 md:p-6">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-primary to-primary/70 rounded-full flex items-center justify-center">
                              <Crown className="w-4 h-4 md:w-5 md:h-5 text-primary-foreground" />
                            </div>
                            <div>
                              <h3 className="text-base md:text-lg font-bold">Save More with Membership</h3>
                              <p className="text-xs text-muted-foreground">Get consistent cleanings at lower prices</p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
                            <div className="text-center p-2 md:p-3 bg-background/60 rounded-lg border">
                              <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-success mx-auto mb-1" />
                              <p className="text-sm md:text-lg font-bold text-success">{membershipSavings.percentOff}%</p>
                              <p className="text-[10px] md:text-xs text-muted-foreground">Off Overtime</p>
                            </div>
                            <div className="text-center p-2 md:p-3 bg-background/60 rounded-lg border">
                              <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary mx-auto mb-1" />
                              <p className="text-sm md:text-lg font-bold">4</p>
                              <p className="text-[10px] md:text-xs text-muted-foreground">Cleans/Mo</p>
                            </div>
                            <div className="text-center p-2 md:p-3 bg-background/60 rounded-lg border">
                              <Clock className="w-4 h-4 md:w-5 md:h-5 text-primary mx-auto mb-1" />
                              <p className="text-sm md:text-lg font-bold">3 hrs</p>
                              <p className="text-[10px] md:text-xs text-muted-foreground">Included</p>
                            </div>
                          </div>
                          
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button 
                              onClick={() => setDialogOpen(true)}
                              className="flex-1"
                              size="sm"
                            >
                              <Crown className="w-4 h-4 mr-2" />
                              Compare Plans
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              className="text-muted-foreground"
                              onClick={() => setSelectedMembership('none')}
                            >
                              No Thanks
                            </Button>
                          </div>
                        </div>
                        
                        {/* Right side - Savings highlight (desktop only) */}
                        <div className="hidden md:flex flex-col items-center justify-center bg-primary/10 px-8 py-6 border-l">
                          <Star className="w-8 h-8 text-primary mb-2" />
                          <p className="text-2xl font-bold text-primary">Save</p>
                          <p className="text-3xl font-black text-primary">${membershipSavings.monthlySavings}</p>
                          <p className="text-sm text-muted-foreground">/month</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Selected Membership Preview - Show when membership is selected */}
                {selectedMembership && selectedMembership !== 'none' && (
                  <Card className="border-2 border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-background shadow-lg overflow-hidden">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        {/* Plan Info */}
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md">
                            <Crown className="w-6 h-6 md:w-7 md:h-7 text-primary-foreground" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-lg md:text-xl">
                                {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.label}
                              </h4>
                              <Badge className="bg-success text-success-foreground text-xs">
                                <Check className="w-3 h-3 mr-1" />
                                Selected
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.description}
                            </p>
                          </div>
                        </div>
                        
                        {/* Stats Grid */}
                        <div className="flex flex-wrap items-center gap-2 md:gap-3">
                          <div className="text-center px-3 py-2 bg-background rounded-lg border shadow-sm">
                            <p className="text-lg md:text-xl font-bold text-primary">
                              ${MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.monthlyPrice}
                            </p>
                            <p className="text-[10px] md:text-xs text-muted-foreground">/month</p>
                          </div>
                          <div className="text-center px-3 py-2 bg-background rounded-lg border shadow-sm">
                            <p className="text-lg md:text-xl font-bold">
                              {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.cleansPerMonth}
                            </p>
                            <p className="text-[10px] md:text-xs text-muted-foreground">cleans/mo</p>
                          </div>
                          <div className="text-center px-3 py-2 bg-background rounded-lg border shadow-sm">
                            <p className="text-lg md:text-xl font-bold">
                              {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.includedHours} hrs
                            </p>
                            <p className="text-[10px] md:text-xs text-muted-foreground">included</p>
                          </div>
                          <div className="text-center px-3 py-2 bg-success/10 rounded-lg border border-success/30 shadow-sm">
                            <p className="text-lg md:text-xl font-bold text-success">
                              {(MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.overtimeDiscount || 0) * 100}%
                            </p>
                            <p className="text-[10px] md:text-xs text-muted-foreground">off overtime</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDialogOpen(true)}
                            className="ml-auto"
                          >
                            Change Plan
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Add-ons Section */}
                {bookingData.serviceType && (
                  <Card className="bg-muted/30 border shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base md:text-lg font-semibold">À La Carte Add-ons</CardTitle>
                      <CardDescription className="text-xs md:text-sm">
                        {bookingData.serviceType === 'moveInOut' 
                          ? 'Fridge & Oven included. Only Windows available as add-on.'
                          : credits
                          ? `Member discount: ${credits.membership_plan === 'monthly' ? '20' : credits.membership_plan === 'biweekly' ? '25' : '30'}% off add-ons`
                          : 'Optional extras for your cleaning service'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {ADD_ONS.map((addon) => {
                          // Disable fridge & oven for Move-In/Out (they're included)
                          const isIncluded = bookingData.serviceType === 'moveInOut' && 
                            (addon.id === 'fridge' || addon.id === 'oven');
                          const isChecked = isIncluded || selectedAddOns.includes(addon.id);
                          
                          return (
                            <div
                              key={addon.id}
                              className={cn(
                                "flex items-center space-x-3 p-3 md:p-4 rounded-lg border bg-background transition-all",
                                isIncluded 
                                  ? "opacity-60 cursor-not-allowed border-success/40 bg-success/5" 
                                  : "cursor-pointer hover:border-primary hover:bg-primary/5",
                                isChecked && !isIncluded && "border-primary bg-primary/5"
                              )}
                              onClick={() => !isIncluded && handleAddOnToggle(addon.id)}
                            >
                              <Checkbox 
                                checked={isChecked}
                                disabled={isIncluded}
                                onCheckedChange={() => !isIncluded && handleAddOnToggle(addon.id)}
                                className={cn(isIncluded && "border-success data-[state=checked]:bg-success")}
                              />
                              <div className="flex-1">
                                <p className="font-medium text-sm md:text-base">
                                  {addon.label}
                                </p>
                                <p className={cn(
                                  "text-xs md:text-sm",
                                  isIncluded ? "text-success font-medium" : "text-muted-foreground"
                                )}>
                                  {isIncluded ? '✓ Included' : `+$${addon.price}`}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Desktop Navigation - Hidden on Mobile */}
                <div className="hidden md:flex gap-4 pt-4">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleBack}
                    className="h-12 md:h-14"
                  >
                    <ArrowLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                    Back
                  </Button>
                  <Button
                    size="lg"
                    onClick={handleContinue}
                    disabled={!bookingData.serviceType}
                    className="flex-1 h-12 md:h-14"
                  >
                    Continue
                    <ArrowRight className="ml-2 w-4 h-4 md:w-5 md:h-5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Mobile Bottom Navigation */}
          <BottomNavigation
            currentStep={currentStep}
            totalSteps={6}
            steps={BOOKING_STEPS}
            onBack={handleBack}
            onContinue={handleContinue}
            continueDisabled={!bookingData.serviceType}
            continueText="Continue"
          />

          <BookingFooter />

          {/* Membership Selection Dialog/Sheet */}
          {isMobile ? (
            <MembershipBottomSheet
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              selectedMembership={selectedMembership}
              onSelect={handleMembershipSelect}
            />
          ) : (
            <MembershipDetailsDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              selectedMembership={selectedMembership}
              onSelect={handleMembershipSelect}
            />
          )}
        </>
      )}
      </div>
    </PageTransition>
  );
}
