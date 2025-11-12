import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { validateEmail, validatePhone } from "@/lib/form-validation";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { calculatePrice } from "@/lib/pricing-system";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { US_STATES } from "@/lib/us-states";
import { toast } from "sonner";
import { ArrowRight, User, Mail, Phone, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

const BOOKING_STEPS = [
  { id: 1, name: "ZIP Code" },
  { id: 2, name: "Home Size" },
  { id: 3, name: "Service" },
  { id: 4, name: "Schedule" },
  { id: 5, name: "Contact Info" },
  { id: 6, name: "Payment" },
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

  const [errors, setErrors] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
  });

  const [touched, setTouched] = useState({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
    address: false,
    city: false,
    state: false,
  });

  const validateField = (name: string, value: string) => {
    switch (name) {
      case "firstName":
      case "lastName":
        return value.trim().length === 0 ? `${name === "firstName" ? "First" : "Last"} name is required` : "";
      case "email":
        return !validateEmail(value) ? "Please enter a valid email address" : "";
      case "phone":
        return !validatePhone(value) ? "Please enter a valid phone number" : "";
      case "address":
        return value.trim().length === 0 ? "Street address is required" : "";
      case "city":
        return value.trim().length === 0 ? "City is required" : "";
      case "state":
        return value.trim().length === 0 ? "State is required" : "";
      default:
        return "";
    }
  };

  const handleChange = (field: string, value: string) => {
    if (field === "phone") {
      const formatted = formatPhoneNumber(value);
      setFormData(prev => ({ ...prev, [field]: formatted }));
      if (touched[field as keyof typeof touched]) {
        const error = validateField(field, formatted);
        setErrors(prev => ({ ...prev, [field]: error }));
      }
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
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
    const allTouched = {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
    };
    setTouched(allTouched);

    // Validate all fields
    const newErrors = {
      firstName: validateField("firstName", formData.firstName),
      lastName: validateField("lastName", formData.lastName),
      email: validateField("email", formData.email),
      phone: validateField("phone", formData.phone),
      address: validateField("address", formData.address),
      city: validateField("city", formData.city),
      state: validateField("state", formData.state),
    };
    setErrors(newErrors);

    // Check if there are any errors
    const hasErrors = Object.values(newErrors).some(error => error !== "");
    if (hasErrors) {
      toast.error("Please fix the errors before continuing");
      return;
    }

    // Update booking context with all form data including address
    updateBookingData({
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      phone: formData.phone.replace(/\D/g, ""), // Store only digits
      address: formData.address,
      city: formData.city,
      state: formData.state,
    });

    setCurrentStep(6);
    navigate("/book/checkout");
  };

  const isFormValid = () => {
    return (
      formData.firstName.trim() !== "" &&
      formData.lastName.trim() !== "" &&
      validateEmail(formData.email) &&
      validatePhone(formData.phone) &&
      formData.address.trim() !== "" &&
      formData.city.trim() !== "" &&
      formData.state.trim() !== "" &&
      !Object.values(errors).some(error => error !== "")
    );
  };

  const handleBack = () => {
    setCurrentStep(4);
    navigate("/book/schedule");
  };

  const handlers = useBookingSwipe({
    onSwipeRight: handleBack,
    onSwipeLeft: () => {
      if (isFormValid()) {
        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      }
    },
    canSwipeLeft: isFormValid(),
    canSwipeRight: true,
  });

  const pricing = calculatePrice(
    bookingData.serviceType || "standard",
    bookingData.homeSizeId || "medium",
    bookingData.addOns || [],
    bookingData.membershipPlan || "none",
    false, // useCredit
    true // isNewCustomer
  );

  const totalSavings = pricing.membershipDiscount + pricing.newCustomerDiscount;

  const PROGRESS_STEPS = [
    { number: 1, label: "ZIP Code" },
    { number: 2, label: "Home Size" },
    { number: 3, label: "Service" },
    { number: 4, label: "Schedule" },
    { number: 5, label: "Contact" },
    { number: 6, label: "Payment" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8" {...handlers}>
      <div className="container max-w-4xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <ProgressBar currentStep={currentStep} totalSteps={6} steps={PROGRESS_STEPS} />

        {totalSavings > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 md:p-4 mb-4 md:mb-6">
            <p className="text-green-800 font-semibold text-center text-sm md:text-base">
              You're saving ${(totalSavings / 100).toFixed(2)} on this booking! 🎉
            </p>
          </div>
        )}

        <Card variant="outlined" className="shadow-card">
          <CardContent className="p-4 md:p-8">
            <div className="space-y-4 md:space-y-6">
              <div>
                <h2 className="text-lg md:text-2xl font-bold">Contact & Address Information</h2>
                <p className="text-muted-foreground mt-1 md:mt-2 text-xs md:text-sm">
                  We'll need these details to confirm your booking
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 md:space-y-6">
                {/* Contact Information */}
                <div className="space-y-3 md:space-y-4">
                  <h3 className="text-base md:text-lg font-semibold">Contact Details</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                    <div className="space-y-1.5 md:space-y-2">
                  <Label htmlFor="firstName" className="text-xs md:text-sm">
                    First Name <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="firstName"
                      value={formData.firstName}
                      onChange={(e) => handleChange("firstName", e.target.value)}
                      onBlur={() => handleBlur("firstName")}
                      className={cn("pl-9 md:pl-10 h-10 md:h-12 text-sm md:text-base", errors.firstName && touched.firstName && "border-destructive")}
                      placeholder="John"
                      required
                      aria-required="true"
                      aria-invalid={!!(errors.firstName && touched.firstName)}
                      aria-describedby={errors.firstName && touched.firstName ? "firstName-error" : undefined}
                    />
                  </div>
                  {errors.firstName && touched.firstName && (
                    <p className="text-xs md:text-sm text-destructive mt-1" id="firstName-error" role="alert">
                      {errors.firstName}
                    </p>
                  )}
                    </div>

                    <div className="space-y-2">
                  <Label htmlFor="lastName" className="text-sm">
                    Last Name <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="lastName"
                      value={formData.lastName}
                      onChange={(e) => handleChange("lastName", e.target.value)}
                      onBlur={() => handleBlur("lastName")}
                      className={cn("pl-10 h-12", errors.lastName && touched.lastName && "border-destructive")}
                      placeholder="Doe"
                      required
                      aria-required="true"
                      aria-invalid={!!(errors.lastName && touched.lastName)}
                      aria-describedby={errors.lastName && touched.lastName ? "lastName-error" : undefined}
                    />
                  </div>
                  {errors.lastName && touched.lastName && (
                    <p className="text-sm text-destructive mt-1" id="lastName-error" role="alert">
                      {errors.lastName}
                    </p>
                  )}
                    </div>
                  </div>

                  <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm">
                    Email Address <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      onBlur={() => handleBlur("email")}
                      className={cn("pl-10 h-12", errors.email && touched.email && "border-destructive")}
                      placeholder="john@example.com"
                      required
                      aria-required="true"
                      aria-invalid={!!(errors.email && touched.email)}
                      aria-describedby={errors.email && touched.email ? "email-error" : undefined}
                    />
                  </div>
                  {errors.email && touched.email && (
                    <p className="text-sm text-destructive mt-1" id="email-error" role="alert">
                      {errors.email}
                    </p>
                  )}
                  </div>

                  <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm">
                    Phone Number <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      onBlur={() => handleBlur("phone")}
                      className={cn("pl-10 h-12", errors.phone && touched.phone && "border-destructive")}
                      placeholder="(555) 123-4567"
                      required
                      aria-required="true"
                      aria-invalid={!!(errors.phone && touched.phone)}
                      aria-describedby={errors.phone && touched.phone ? "phone-error" : undefined}
                    />
                  </div>
                  {errors.phone && touched.phone && (
                    <p className="text-sm text-destructive mt-1" id="phone-error" role="alert">
                      {errors.phone}
                    </p>
                  )}
                  </div>
                </div>

                {/* Service Address */}
                <div className="space-y-4 border-t pt-6">
                  <h3 className="text-lg font-semibold">Service Address</h3>
                  
                  <div className="space-y-2">
                  <Label htmlFor="address" className="text-sm">
                    Street Address <span className="text-destructive" aria-label="required">*</span>
                  </Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleChange("address", e.target.value)}
                      onBlur={() => handleBlur("address")}
                      className={cn("pl-10 h-12", errors.address && touched.address && "border-destructive")}
                      placeholder="123 Main St"
                      required
                      aria-required="true"
                      aria-invalid={!!(errors.address && touched.address)}
                      aria-describedby={errors.address && touched.address ? "address-error" : undefined}
                    />
                  </div>
                  {errors.address && touched.address && (
                    <p className="text-sm text-destructive mt-1" id="address-error" role="alert">
                      {errors.address}
                    </p>
                  )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city" className="text-sm">
                        City <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="city"
                        value={formData.city}
                        onChange={(e) => handleChange("city", e.target.value)}
                        onBlur={() => handleBlur("city")}
                        className={cn("h-12", errors.city && touched.city && "border-destructive")}
                        placeholder="City"
                        required
                      />
                      {errors.city && touched.city && (
                        <p className="text-sm text-destructive mt-1">{errors.city}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="state" className="text-sm">
                        State <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={formData.state}
                        onValueChange={(value) => {
                          setFormData(prev => ({ ...prev, state: value }));
                          setErrors(prev => ({ ...prev, state: validateField("state", value) }));
                          setTouched(prev => ({ ...prev, state: true }));
                        }}
                      >
                        <SelectTrigger className={cn("h-12", errors.state && touched.state && "border-destructive")}>
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {US_STATES.map((state) => (
                            <SelectItem key={state.value} value={state.value}>
                              {state.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.state && touched.state && (
                        <p className="text-sm text-destructive mt-1">{errors.state}</p>
                      )}
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full h-12 md:h-14 text-base font-semibold hidden md:flex"
                  disabled={!isFormValid()}
                  aria-label={
                    !isFormValid() 
                      ? "Please complete all required fields to continue" 
                      : "Continue to payment"
                  }
                  aria-disabled={!isFormValid()}
                >
                  Continue to Payment
                  <ArrowRight className="ml-2 w-5 h-5" aria-hidden="true" />
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={PROGRESS_STEPS}
        onBack={handleBack}
        onContinue={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
        continueDisabled={!isFormValid()}
        continueText="Continue to Payment"
      />
    </div>
  );
}
