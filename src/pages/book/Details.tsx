import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, User, Mail, Phone, MapPin, DollarSign } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { toast } from "sonner";
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
  const { bookingData, updateBookingData, currentStep, setCurrentStep } = useBooking();
  
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
    bookingData.useCredit
  );

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone || !formData.address) {
      toast.error("Please fill in all required fields");
      return;
    }

    updateBookingData(formData);
    setCurrentStep(6);
    navigate("/book/summary");
  };

  const handleBack = () => {
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-6xl mx-auto px-3 py-4 lg:px-4 lg:py-8 pb-32 lg:pb-8">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Contact Form */}
          <Card className="shadow-lg animate-fade-in border-border/50">
            <CardHeader className="space-y-1 pb-4">
              <CardTitle className="text-xl lg:text-2xl">Your details</CardTitle>
              <CardDescription className="text-sm lg:text-base">
                Please provide your contact information
              </CardDescription>
            </CardHeader>
            
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4 lg:space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm">
                      First Name <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
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
                    <Label htmlFor="lastName" className="text-sm">
                      Last Name <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
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
                  <Label htmlFor="email" className="text-sm">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
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
                  <Label htmlFor="phone" className="text-sm">
                    Phone Number <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
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
                  <Label htmlFor="address" className="text-sm">
                    Street Address <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 lg:w-5 lg:h-5 text-muted-foreground" />
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleChange("address", e.target.value)}
                      className="pl-10 h-12"
                      placeholder="123 Main Street"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="city" className="text-sm">City</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => handleChange("city", e.target.value)}
                      className="h-12"
                      placeholder="San Francisco"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state" className="text-sm">State</Label>
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

                <div className="hidden lg:flex gap-4 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={handleBack}
                    className="h-12"
                  >
                    <ArrowLeft className="mr-2 w-4 h-4" />
                    Back
                  </Button>
                  <Button
                    type="submit"
                    size="lg"
                    className="flex-1 h-12"
                  >
                    Continue to Summary
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Pricing Summary */}
          <Card className="shadow-lg border-2 border-primary/20 lg:sticky lg:top-8 h-fit animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <CardHeader className="bg-gradient-to-br from-primary to-primary/60 text-primary-foreground pb-4">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 lg:w-6 lg:h-6" />
                <CardTitle className="text-lg lg:text-2xl">Pricing Summary</CardTitle>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4 lg:space-y-6 pt-4 lg:pt-6">
              <div className="space-y-3 lg:space-y-4">
                <div>
                  <p className="text-xs lg:text-sm text-muted-foreground">Service</p>
                  <p className="font-medium text-sm lg:text-base">{serviceTier?.label} • {homeSize?.label}</p>
                  <p className="text-xs lg:text-sm text-muted-foreground mt-1">{pricing.hours} hours @ $75/hr</p>
                </div>

                <Separator />

                <div className="space-y-2 lg:space-y-3">
                  <div className="flex justify-between text-sm lg:text-base">
                    <span className="text-muted-foreground">Base Price</span>
                    <span className="font-medium">${pricing.basePrice.toFixed(2)}</span>
                  </div>
                  
                  {pricing.serviceAddition > 0 && (
                    <div className="flex justify-between text-sm lg:text-base">
                      <span className="text-muted-foreground">{serviceTier?.label} Addition</span>
                      <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                    </div>
                  )}
                  
                  {pricing.addOnsTotal > 0 && (
                    <div className="flex justify-between text-sm lg:text-base">
                      <span className="text-muted-foreground">Add-ons</span>
                      <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="flex justify-between font-semibold text-base lg:text-lg">
                  <span>Subtotal</span>
                  <span>${pricing.subtotal.toFixed(2)}</span>
                </div>

                {pricing.membershipDiscount > 0 && (
                  <div className="flex justify-between text-success text-sm lg:text-base">
                    <span>{membership?.label} Discount</span>
                    <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                  </div>
                )}

                {bookingData.useCredit && (
                  <div className="flex justify-between text-success text-sm lg:text-base">
                    <span>Credit Applied</span>
                    <span>-${Math.min(pricing.basePrice, 150).toFixed(2)}</span>
                  </div>
                )}

                <Separator className="border-primary/30" />

                <div className="space-y-3 bg-primary/5 p-3 lg:p-4 rounded-lg">
                  <div className="flex justify-between text-xl lg:text-2xl font-bold text-primary">
                    <span>Total</span>
                    <span>${pricing.total.toFixed(2)}</span>
                  </div>
                  
                  <div className="space-y-2 text-xs lg:text-sm">
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
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        onBack={handleBack}
        onContinue={() => handleSubmit()}
        continueDisabled={!formData.firstName || !formData.lastName || !formData.email || !formData.phone || !formData.address}
        continueLabel="Continue"
        totalPrice={pricing.total}
        showBack={true}
      />
    </div>
  );
}
