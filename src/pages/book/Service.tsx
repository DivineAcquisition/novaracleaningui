import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MembershipBanner } from "@/components/booking/MembershipBanner";
import { Sparkles, Zap, Package, ArrowRight, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";

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
    name: 'Standard',
    description: 'Base hourly cleaning service',
    features: ['All rooms cleaned', 'Dusting & vacuuming', 'Bathroom & kitchen cleaning', 'Trash removal'],
    badge: 'Most Popular',
  },
  {
    id: 'deep',
    icon: Zap,
    name: 'Deep Clean',
    description: '+$50 on Standard',
    features: ['Everything in Standard', 'Baseboards & trim', 'Window sills', 'Extra attention to detail'],
    badge: null,
  },
  {
    id: 'moveInOut',
    icon: Package,
    name: 'Move-In/Out Cleaning',
    description: '+$120 (includes fridge & oven)',
    features: ['Everything in Deep', 'Inside Fridge ✓ Included', 'Inside Oven ✓ Included', 'Cabinet interiors', 'Interior Windows (optional)'],
    badge: 'Moving Special',
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
    
    updateBookingData({ 
      serviceType,
      addOns: filteredAddOns 
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

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8 animate-fade-in" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-4">
        {/* New Customer Promotion Banner */}
        {!user && (
          <Card className="bg-gradient-to-r from-success/10 via-success/5 to-background border-2 border-success/30 shadow-lg animate-slide-in-left">
            <CardContent className="p-4 md:p-6">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 bg-success/20 rounded-full flex items-center justify-center">
                  <Sparkles className="w-6 h-6 md:w-7 md:h-7 text-success" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base md:text-lg font-bold text-success">New Customer Special!</h3>
                  <p className="text-sm text-foreground mt-1">
                    Save <span className="font-bold text-success">$60</span> on your first cleaning service. No membership required!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Membership Banner */}
        {user && credits && <MembershipBanner />}
        
        <Card className="shadow-xl animate-slide-in-right">
          <CardHeader className="text-center space-y-2 pb-6 px-4 md:px-6 md:pb-8">
            <CardTitle className="text-xl md:text-2xl font-bold">Choose your service</CardTitle>
            <CardDescription className="text-sm">
              {hasCredits 
                ? 'Select a service to use your membership credit'
                : 'Select the cleaning tier that fits your needs'}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 md:space-y-8 px-4 md:px-6">
            <div className="grid gap-3 md:gap-6 grid-cols-1 md:grid-cols-3">
              {SERVICES.map((service) => (
                <Card
                  key={service.id}
                  className={cn(
                    "cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 relative",
                    bookingData.serviceType === service.id && "ring-2 ring-primary shadow-lg"
                  )}
                  onClick={() => handleSelect(service.id)}
                >
                  {service.badge && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary">
                      {service.badge}
                    </Badge>
                  )}
                  <CardContent className="p-4 md:p-6 space-y-4">
                    <div className="text-center space-y-3">
                      <div className="mx-auto w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                        <service.icon className="w-7 h-7 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold">{service.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
                      </div>
                    </div>
                    <ul className="space-y-2 pt-4 border-t">
                      {service.features.map((feature, idx) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                          <span className="text-primary mt-0.5">✓</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>

            {bookingData.serviceType && (
              <Card className="bg-muted/50">
                <CardHeader>
                  <CardTitle className="text-lg">À La Carte Add-ons</CardTitle>
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
    </div>
  );
}
