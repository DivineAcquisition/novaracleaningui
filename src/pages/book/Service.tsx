import { useState, useEffect } from "react";
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
import { Sparkles, Zap, Package, ArrowRight, ArrowLeft, Clock, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { getEstimatedHours, HOURLY_RATE, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
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

const SERVICES = [
  {
    id: 'standard',
    icon: Sparkles,
    name: 'Standard Clean',
    description: 'Perfect for regular maintenance',
    features: ['Dusting and vacuuming', 'Kitchen and bathroom cleaning', 'Mopping floors', 'Making beds'],
    badge: 'Most Popular',
  },
  {
    id: 'deep',
    icon: Zap,
    name: 'Deep Clean',
    description: 'Thorough top-to-bottom cleaning',
    features: ['Everything in Standard', 'Baseboards and window sills', 'Inside appliances', 'Detailed bathroom scrubbing'],
    badge: null,
  },
  {
    id: 'moveInOut',
    icon: Package,
    name: 'Move-In/Out',
    description: 'Complete empty home cleaning',
    features: ['Everything in Deep Clean', 'Inside all cabinets', 'Interior windows', 'All surfaces sanitized'],
    badge: null,
  },
  {
    id: 'membership',
    icon: Crown,
    name: 'Membership Plans',
    description: 'Save with monthly plans',
    features: ['Included hours each clean', 'Overtime discounts up to 35%', 'Priority scheduling'],
    badge: 'Save More',
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
  const [dialogMembershipId, setDialogMembershipId] = useState<keyof typeof MEMBERSHIP_PLANS>('essential');
  const [isLoading, setIsLoading] = useState(true);
  const isMobile = useIsMobile();

  // Simulate loading state for initial render
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(2);
      navigate("/book/home");
    },
    step: 3,
  });

  const handleSelect = (serviceType: string) => {
    if (serviceType === 'membership') {
      setDialogOpen(true);
      return;
    }
    
    // For moveInOut, filter out fridge & oven from add-ons (they're included)
    const filteredAddOns = serviceType === 'moveInOut' 
      ? selectedAddOns.filter(addon => addon === 'windows')
      : selectedAddOns;
    
    updateBookingData({ 
      serviceType,
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
          <div className="container max-w-5xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-3 md:space-y-4">
            {/* New Customer Promotion Banner */}
            {!user && (
              <Card className="bg-gradient-to-r from-success/10 via-success/5 to-background border-2 border-success/40 shadow-card animate-slide-in-left">
                <CardContent className="p-3 md:p-6">
                  <div className="flex items-center gap-2 md:gap-4">
                    <div className="flex-shrink-0 w-10 h-10 md:w-14 md:h-14 bg-success/20 rounded-full flex items-center justify-center">
                      <Sparkles className="w-5 h-5 md:w-7 md:h-7 text-success" />
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
            
            {/* Membership Banner */}
            {user && credits && <MembershipBanner />}
            
            {/* Service Selection */}
            <Card variant="outlined" className="animate-slide-in-right">
              <CardHeader className="text-center space-y-1.5 pb-4 px-3 md:px-6 md:pb-8">
                <CardTitle className="text-base md:text-xl font-semibold font-jakarta">Choose your service</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  {hasCredits 
                    ? 'Select a service to use your membership credit'
                    : 'Select the cleaning tier that fits your needs'}
                </CardDescription>
                {bookingData.homeSizeId && (
                  <div className="flex items-center justify-center gap-2 pt-2 text-sm font-medium text-primary">
                    <Clock className="w-4 h-4" />
                    <span>
                      Estimated {getEstimatedHours(bookingData.homeSizeId)} hours
                    </span>
                  </div>
                )}
              </CardHeader>
              
              <CardContent className="space-y-4 md:space-y-8 px-3 md:px-6">
                <div className="grid gap-2.5 md:gap-6 grid-cols-1 md:grid-cols-4">
                  {SERVICES.map((service) => (
                    <Card
                      key={service.id}
                      className={cn(
                        "card-interactive relative touch-manipulation min-h-[220px]",
                        bookingData.serviceType === service.id && "ring-2 ring-primary border-primary/60 shadow-lavender"
                      )}
                      onClick={() => handleSelect(service.id)}
                    >
                      {service.badge && (
                        <Badge className="absolute -top-1.5 md:-top-2 left-1/2 -translate-x-1/2 bg-primary text-xs">
                          {service.badge}
                        </Badge>
                      )}
                      <CardContent className="p-3 md:p-6 space-y-3 md:space-y-4">
                        <div className="text-center space-y-2 md:space-y-3">
                          <div className="mx-auto w-11 h-11 md:w-14 md:h-14 bg-primary/10 rounded-full flex items-center justify-center">
                            <service.icon className="w-5 h-5 md:w-7 md:h-7 text-primary" />
                          </div>
                          <div>
                            <h3 className="text-base md:text-lg font-semibold">{service.name}</h3>
                            <p className="text-xs md:text-sm text-muted-foreground mt-0.5 md:mt-1">{service.description}</p>
                          </div>
                        </div>
                        <ul className="space-y-1.5 md:space-y-2 pt-3 md:pt-4 border-t">
                          {service.features.map((feature, idx) => (
                            <li key={idx} className="text-xs md:text-sm flex items-start gap-1.5 md:gap-2">
                              <span className="text-primary mt-0.5">✓</span>
                              <span>{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Membership Tier Preview Card */}
                {selectedMembership && selectedMembership !== 'none' && (
                  <Card className="border-primary/40 bg-gradient-to-br from-primary/5 via-accent/5 to-background shadow-card">
                    <CardContent className="p-4 md:p-6">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <Crown className="w-6 h-6 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-base md:text-lg">
                                {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.label} Plan
                              </h4>
                              <Badge variant="secondary" className="text-xs">Selected</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.description}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-3 md:gap-6">
                          <div className="text-center px-3 py-2 bg-background/80 rounded-lg border">
                            <p className="text-lg md:text-xl font-bold text-primary">
                              ${MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.monthlyPrice}
                            </p>
                            <p className="text-xs text-muted-foreground">per month</p>
                          </div>
                          <div className="text-center px-3 py-2 bg-background/80 rounded-lg border">
                            <p className="text-lg md:text-xl font-bold text-primary">
                              {MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.cleansPerMonth}
                            </p>
                            <p className="text-xs text-muted-foreground">cleans/mo</p>
                          </div>
                          <div className="text-center px-3 py-2 bg-background/80 rounded-lg border">
                            <p className="text-lg md:text-xl font-bold text-success">
                              {(MEMBERSHIP_PLANS[selectedMembership as keyof typeof MEMBERSHIP_PLANS]?.overtimeDiscount || 0) * 100}%
                            </p>
                            <p className="text-xs text-muted-foreground">overtime off</p>
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

                {bookingData.serviceType && (
                  <Card className="bg-muted/50 border border-border/60 shadow-md">
                    <CardHeader>
                      <CardTitle className="text-lg font-semibold">À La Carte Add-ons</CardTitle>
                      <CardDescription>
                        {bookingData.serviceType === 'moveInOut' 
                          ? 'Fridge & Oven included. Only Windows available as add-on.'
                          : credits
                          ? `Member discount: ${credits.membership_plan === 'monthly' ? '20' : credits.membership_plan === 'biweekly' ? '25' : '30'}% off add-ons`
                          : 'Optional extras for your cleaning service'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-4 sm:grid-cols-3">
                        {ADD_ONS.map((addon) => {
                          // Disable fridge & oven for Move-In/Out (they're included)
                          const isIncluded = bookingData.serviceType === 'moveInOut' && 
                            (addon.id === 'fridge' || addon.id === 'oven');
                          
                          return (
                            <div
                              key={addon.id}
                              className={cn(
                                "flex items-center space-x-3 p-4 rounded-lg border bg-background transition-colors",
                                isIncluded 
                                  ? "opacity-50 cursor-not-allowed" 
                                  : "cursor-pointer hover:border-primary"
                              )}
                              onClick={() => !isIncluded && handleAddOnToggle(addon.id)}
                            >
                              <Checkbox 
                                checked={isIncluded || selectedAddOns.includes(addon.id)}
                                disabled={isIncluded}
                                onCheckedChange={() => !isIncluded && handleAddOnToggle(addon.id)}
                              />
                              <div className="flex-1">
                                <p className="font-medium">
                                  {addon.label}
                                  {isIncluded && <span className="ml-2 text-xs text-success">✓ Included</span>}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {isIncluded ? 'Included' : `+$${addon.price}`}
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
                <div className="hidden md:flex gap-4 pt-6">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleBack}
                    className="h-12 md:h-14"
                  >
                    <ArrowLeft className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <BookingFooter />

          {/* Membership Selection - Mobile Bottom Sheet or Desktop Dialog */}
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
