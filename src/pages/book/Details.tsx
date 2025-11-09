import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { MembershipBanner } from "@/components/booking/MembershipBanner";
import { ArrowRight, ArrowLeft, User, Mail, Phone, MapPin, DollarSign, Gift } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { toast } from "sonner";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS } from "@/lib/pricing-system";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

export default function BookingDetails() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  const [useCredit, setUseCredit] = useState(bookingData.useCredit || false);
  
  const [formData, setFormData] = useState({
    firstName: bookingData.firstName || "",
    lastName: bookingData.lastName || "",
    email: bookingData.email || "",
    phone: bookingData.phone || "",
    address: bookingData.address || "",
    city: bookingData.city || "",
    state: bookingData.state || "",
  });

  const pricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    useCredit
  );

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(4);
      navigate("/book/schedule");
    },
    onSwipeLeft: () => {
      if (formData.firstName && formData.lastName && formData.email && formData.phone && formData.address) {
        updateBookingData(formData);
        setCurrentStep(6);
        navigate("/book/summary");
      }
    },
    canSwipeLeft: !!(formData.firstName && formData.lastName && formData.email && formData.phone && formData.address),
    step: 5,
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone || !formData.address) {
      toast.error("Please fill in all required fields");
      return;
    }

    updateBookingData({ ...formData, useCredit });
    setCurrentStep(6);
    navigate("/book/summary");
  };

  const handleBack = () => {
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4">
        {/* Membership Banner */}
        {user && credits && <MembershipBanner />}
        
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {/* Contact Form */}
          <Card className="shadow-xl animate-fade-in">
            <CardHeader className="space-y-2">
              <CardTitle className="text-xl md:text-2xl font-bold">Your details</CardTitle>
              <CardDescription className="text-sm md:text-base">
                Please provide your contact information
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">
                      First Name <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => handleChange("firstName", e.target.value)}
                        className="pl-10 h-12"
                        placeholder="John"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">
                      Last Name <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => handleChange("lastName", e.target.value)}
                        className="pl-10 h-12"
                        placeholder="Doe"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      className="pl-10 h-12"
                      placeholder="john@example.com"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">
                    Phone Number <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      className="pl-10 h-12"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">
                    Street Address <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleChange("address", e.target.value)}
                      className="pl-10 h-12"
                      placeholder="123 Main Street"
                    />
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => handleChange("city", e.target.value)}
                      className="h-12"
                      placeholder="San Francisco"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      value={formData.state}
                      onChange={(e) => handleChange("state", e.target.value)}
                      className="h-12"
                      placeholder="CA"
                      maxLength={2}
                    />
                  </div>
                </div>

                {/* Desktop Navigation - Hidden on Mobile */}
                <div className="hidden md:flex gap-4 pt-6">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleBack}
                    className="h-14"
                  >
                    <ArrowLeft className="mr-2 w-5 h-5" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    size="lg"
                    className="flex-1 h-14 text-base font-semibold"
                  >
                    Continue to Summary
                    <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Pricing Summary - FIRST TIME SHOWING PRICES */}
          <Card className="shadow-xl border-2 border-primary/20 lg:sticky lg:top-8 h-fit animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <CardHeader className="bg-gradient-primary text-primary-foreground">
              <div className="flex items-center gap-2">
                <DollarSign className="w-6 h-6" />
                <CardTitle className="text-2xl font-bold">Pricing Summary</CardTitle>
              </div>
              <CardDescription className="text-primary-foreground/90">
                See your total costs
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6 pt-6">
              {/* Credit Usage Toggle for Members */}
              {hasCredits && (
                <Card className="bg-success/5 border-success/30">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Gift className="w-5 h-5 text-success" />
                        <div>
                          <p className="font-semibold">Use Membership Credit</p>
                          <p className="text-xs text-muted-foreground">
                            {credits?.credits_remaining} {credits?.credits_remaining === 1 ? 'credit' : 'credits'} available
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={useCredit}
                        onCheckedChange={setUseCredit}
                      />
                    </div>
                    {useCredit && (
                      <p className="text-xs text-success">
                        Covers up to $150 of your base price • ${(Math.min(pricing.basePrice, 150)).toFixed(2)} applied
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Service</p>
                  <p className="font-medium">{serviceTier?.label} • {homeSize?.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">{pricing.hours} hours @ $75/hr</p>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base Price</span>
                    <span className="font-medium">${pricing.basePrice.toFixed(2)}</span>
                  </div>
                  
                  {pricing.serviceAddition > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{serviceTier?.label} Addition</span>
                      <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                    </div>
                  )}
                  
                  {pricing.addOnsTotal > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Add-ons</span>
                      <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                    </div>
                  )}
                  
                  {bookingData.addOns.length > 0 && (
                    <div className="pl-4 space-y-1">
                      {bookingData.addOns.map(addon => (
                        <p key={addon} className="text-xs text-muted-foreground">
                          • {ADD_ONS[addon as keyof typeof ADD_ONS]?.label}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="flex justify-between text-lg font-semibold">
                  <span>Subtotal</span>
                  <span>${pricing.subtotal.toFixed(2)}</span>
                </div>

                {pricing.membershipDiscount > 0 && (
                  <div className="flex justify-between text-success">
                    <span>{membership?.label} Discount</span>
                    <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                  </div>
                )}

                {useCredit && (
                  <div className="flex justify-between text-success">
                    <span>Credit Applied</span>
                    <span>-${Math.min(pricing.basePrice, 150).toFixed(2)}</span>
                  </div>
                )}

                <Separator className="border-primary/30" />

                <div className="space-y-3 bg-primary/5 p-4 rounded-lg">
                  <div className="flex justify-between text-2xl font-bold text-primary">
                    <span>Total</span>
                    <span>${pricing.total.toFixed(2)}</span>
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Deposit (today)</span>
                      <span className="font-semibold">${pricing.deposit.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Balance (after clean)</span>
                      <span className="font-semibold">${pricing.balanceDue.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {bookingData.membershipPlan !== 'none' && (
                  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
                    <p className="font-medium mb-1">Membership: {membership?.label}</p>
                    <p>${membership?.monthlyPrice}/mo recurring charge</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        onContinue={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
        showPrice={true}
        price={pricing.total}
        continueText="Continue to Summary"
      />
    </div>
  );
}
