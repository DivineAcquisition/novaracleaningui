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
import { formatPhoneNumber, getRawPhoneNumber, isValidPhoneNumber } from "@/lib/input-formatters";
import { validateEmail, validateName, validatePhone } from "@/lib/form-validation";
import { cn } from "@/lib/utils";

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

  const [errors, setErrors] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });

  const [touched, setTouched] = useState({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
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

  const validateField = (field: string, value: string) => {
    let validation;
    switch (field) {
      case "firstName":
        validation = validateName(value, "First name");
        break;
      case "lastName":
        validation = validateName(value, "Last name");
        break;
      case "email":
        validation = validateEmail(value);
        break;
      case "phone":
        validation = validatePhone(value);
        break;
      default:
        validation = { isValid: true };
    }
    return validation.error || "";
  };

  const handleChange = (field: string, value: string) => {
    if (field === "phone") {
      const formatted = formatPhoneNumber(value);
      setFormData(prev => ({ ...prev, [field]: formatted }));
      // Validate on change if already touched
      if (touched[field as keyof typeof touched]) {
        const error = validateField(field, formatted);
        setErrors(prev => ({ ...prev, [field]: error }));
      }
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
      // Validate on change if already touched
      if (touched[field as keyof typeof touched]) {
        const error = validateField(field, value);
        setErrors(prev => ({ ...prev, [field]: error }));
      }
    }
  };

  const handleBlur = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    const value = formData[field as keyof typeof formData];
    const error = validateField(field, value);
    setErrors(prev => ({ ...prev, [field]: error }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Mark all fields as touched
    setTouched({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    });

    // Validate all fields
    const newErrors = {
      firstName: validateField("firstName", formData.firstName),
      lastName: validateField("lastName", formData.lastName),
      email: validateField("email", formData.email),
      phone: validateField("phone", formData.phone),
    };

    setErrors(newErrors);

    // Check if there are any errors
    const hasErrors = Object.values(newErrors).some(error => error !== "");
    if (hasErrors) {
      toast.error("Please fix the errors before continuing");
      return;
    }

    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone) {
      toast.error("Please fill in all fields");
      return;
    }

    if (!isValidPhoneNumber(formData.phone)) {
      toast.error("Please enter a valid 10-digit phone number");
      return;
    }

    // Store the raw phone number (digits only) for backend
    updateBookingData({
      ...formData,
      phone: getRawPhoneNumber(formData.phone)
    });
    setCurrentStep(6);
    navigate("/book/checkout");
  };

  const isFormValid = () => {
    return formData.firstName && formData.lastName && formData.email && formData.phone &&
           !errors.firstName && !errors.lastName && !errors.email && !errors.phone;
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
                <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-green-600 dark:text-green-400" />
                <h3 className="text-lg md:text-xl font-bold text-green-700 dark:text-green-400">You're Saving Big!</h3>
              </div>
              <div className="text-2xl md:text-4xl font-bold text-green-600 dark:text-green-400 mb-4">
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
            <CardTitle className="text-xl md:text-2xl font-bold">Contact Information</CardTitle>
            <CardDescription className="text-sm">
              We'll use this to send your booking confirmation
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName" className="text-sm">
                    First Name <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) => handleChange("firstName", e.target.value)}
                      onBlur={() => handleBlur("firstName")}
                      className={cn("pl-10 h-12", errors.firstName && touched.firstName && "border-destructive")}
                      placeholder="John"
                      required
                    />
                  </div>
                  {errors.firstName && touched.firstName && (
                    <p className="text-sm text-destructive mt-1">{errors.firstName}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-sm">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    onBlur={() => handleBlur("lastName")}
                    className={cn("h-12", errors.lastName && touched.lastName && "border-destructive")}
                    placeholder="Doe"
                    required
                  />
                  {errors.lastName && touched.lastName && (
                    <p className="text-sm text-destructive mt-1">{errors.lastName}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm">
                  Email <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange("email", e.target.value)}
                    onBlur={() => handleBlur("email")}
                    className={cn("pl-10 h-12", errors.email && touched.email && "border-destructive")}
                    placeholder="john@example.com"
                    required
                  />
                </div>
                {errors.email && touched.email && (
                  <p className="text-sm text-destructive mt-1">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm">
                  Phone Number <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange("phone", e.target.value)}
                    onBlur={() => handleBlur("phone")}
                    className={cn("pl-10 h-12", errors.phone && touched.phone && "border-destructive")}
                    placeholder="(555) 123-4567"
                    required
                  />
                </div>
                {errors.phone && touched.phone && (
                  <p className="text-sm text-destructive mt-1">{errors.phone}</p>
                )}
              </div>

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 md:h-14 text-base font-semibold hidden md:flex"
                disabled={!isFormValid()}
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
        onContinue={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
        continueDisabled={!isFormValid()}
        continueText="Continue to Payment"
      />
    </div>
  );
}
