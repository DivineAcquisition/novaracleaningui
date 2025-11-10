import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, ArrowLeft, User, Mail, Phone, Sparkles } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { toast } from "sonner";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { calculatePrice } from "@/lib/pricing-system";

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
  });

  const pricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(4);
      navigate("/book/schedule");
    },
    onSwipeLeft: () => {
      if (formData.firstName && formData.lastName && formData.email && formData.phone) {
        updateBookingData(formData);
        setCurrentStep(6);
        navigate("/book/checkout");
      }
    },
    canSwipeLeft: !!(formData.firstName && formData.lastName && formData.email && formData.phone),
    step: 5,
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone) {
      toast.error("Please fill in all fields");
      return;
    }

    updateBookingData(formData);
    setCurrentStep(6);
    navigate("/book/checkout");
  };

  const handleBack = () => {
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-2xl mx-auto px-3 md:px-4 py-4 md:py-8">
        {/* Savings Banner */}
        {(pricing.newCustomerDiscount > 0 || pricing.membershipDiscount > 0) && (
          <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 shadow-xl mb-6 animate-fade-in">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-3">
                <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
                <h3 className="text-xl font-bold text-green-700 dark:text-green-400">You're Saving Big!</h3>
              </div>
              <div className="text-4xl font-bold text-green-600 dark:text-green-400 mb-4">
                ${((pricing.newCustomerDiscount || 0) + (pricing.membershipDiscount || 0)).toFixed(2)}
              </div>
              <div className="space-y-1 text-sm">
                {pricing.newCustomerDiscount > 0 && (
                  <p className="text-muted-foreground">
                    ✨ New Customer Discount: ${pricing.newCustomerDiscount.toFixed(2)}
                  </p>
                )}
                {pricing.membershipDiscount > 0 && (
                  <p className="text-muted-foreground">
                    🎁 Member Savings: ${pricing.membershipDiscount.toFixed(2)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-xl animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-6">
            <CardTitle className="text-2xl md:text-3xl font-bold">Contact Information</CardTitle>
            <CardDescription className="text-sm md:text-base">
              We'll use this to send your booking confirmation
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-sm md:text-base">
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
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-sm md:text-base">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    className="h-12"
                    placeholder="Doe"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm md:text-base">
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
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm md:text-base">
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
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 md:h-14 text-base font-semibold hidden md:flex"
                disabled={!formData.firstName || !formData.lastName || !formData.email || !formData.phone}
              >
                Continue to Payment
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        onContinue={() => {
          if (formData.firstName && formData.lastName && formData.email && formData.phone) {
            updateBookingData(formData);
            setCurrentStep(6);
            navigate("/book/checkout");
          } else {
            toast.error("Please fill in all fields");
          }
        }}
        continueText="Continue to Payment"
      />
    </div>
  );
}
