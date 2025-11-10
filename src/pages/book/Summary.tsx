import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Calendar, Clock, Home, MapPin, User, Mail, Phone, Sparkles, TrendingDown, DollarSign, ChevronDown } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM",
};

export default function BookingSummary() {
  const navigate = useNavigate();
  const { bookingData, currentStep, setCurrentStep } = useBooking();

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      setCurrentStep(5);
      navigate("/book/details");
    },
    onSwipeLeft: () => {
      navigate("/book/checkout");
    },
    step: 6,
  });

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const pricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  const handleBack = () => {
    setCurrentStep(5);
    navigate("/book/details");
  };

  const handleConfirm = () => {
    navigate("/book/checkout");
  };

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <Card className="shadow-xl animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-8">
            <CardTitle className="text-2xl md:text-3xl font-bold">Review your booking</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Please review your booking details before confirming
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 md:space-y-8">
            {/* Savings Hero Section - Enhanced */}
            {(pricing.membershipDiscount > 0 || bookingData.useCredit || pricing.newCustomerDiscount > 0) && (
              <Card className="border-2 border-green-500/30 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 animate-fade-in">
                <CardHeader className="text-center pb-3 md:pb-4">
                  <div className="flex justify-center mb-2">
                    <TrendingDown className="w-8 h-8 md:w-10 md:h-10 text-green-600 dark:text-green-400" />
                  </div>
                  <CardTitle className="text-xl md:text-2xl text-green-700 dark:text-green-400">🎉 You're Saving Big!</CardTitle>
                </CardHeader>
                <CardContent className="text-center space-y-3 md:space-y-4">
                  <div>
                    <p className="text-4xl md:text-6xl font-bold text-green-600 dark:text-green-400">
                      ${((pricing.newCustomerDiscount || 0) + (pricing.membershipDiscount || 0) + (bookingData.useCredit ? Math.min(pricing.basePrice, 150) : 0)).toFixed(2)}
                    </p>
                    <p className="text-sm md:text-base text-muted-foreground mt-1">Total savings on this booking</p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 justify-center">
                    {pricing.newCustomerDiscount > 0 && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs md:text-sm py-1 px-3">
                        🎁 ${pricing.newCustomerDiscount.toFixed(2)} New Customer Discount
                      </Badge>
                    )}
                    {pricing.membershipDiscount > 0 && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs md:text-sm py-1 px-3">
                        💎 ${pricing.membershipDiscount.toFixed(2)} Membership Discount
                      </Badge>
                    )}
                    {bookingData.useCredit && (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs md:text-sm py-1 px-3">
                        ⭐ ${Math.min(pricing.basePrice, 150).toFixed(2)} Credit Applied
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* What You Pay Today - Hero */}
            <Card className="border-2 border-primary/30 shadow-lg animate-fade-in">
              <CardHeader className="text-center bg-gradient-to-br from-primary/5 to-primary/10 pb-3 md:pb-4">
                <CardTitle className="text-lg md:text-xl flex items-center justify-center gap-2">
                  <DollarSign className="w-5 h-5 md:w-6 md:h-6 text-primary" />
                  What You Pay Today
                </CardTitle>
              </CardHeader>
              <CardContent className="text-center py-6 md:py-8 space-y-3 md:space-y-4">
                <div>
                  <p className="text-5xl md:text-6xl font-bold text-primary">
                    ${pricing.deposit.toFixed(2)}
                  </p>
                  <p className="text-base md:text-lg text-muted-foreground mt-2">
                    {pricing.deposit === 0 ? "Nothing due today! 🎉" : "Due today"}
                  </p>
                </div>
                
                {pricing.balanceDue > 0 && (
                  <div className="pt-3 md:pt-4 border-t">
                    <p className="text-sm md:text-base text-muted-foreground">
                      Balance of <span className="font-semibold text-foreground">${pricing.balanceDue.toFixed(2)}</span> due after service
                    </p>
                  </div>
                )}
                
                <Badge variant="outline" className="text-xs md:text-sm py-1 px-3">
                  ✅ Only ${pricing.deposit.toFixed(2)} to book now
                </Badge>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:gap-6 md:grid-cols-2">
              {/* Service Details */}
              <Card className="animate-fade-in">
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                    Service Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 md:space-y-3">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">Home Size</p>
                      <p className="font-medium text-sm md:text-base">{homeSize?.label}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs md:text-sm text-muted-foreground">Service Type</p>
                    <p className="font-medium text-sm md:text-base">{serviceTier?.label}</p>
                  </div>
                  {bookingData.addOns.length > 0 && (
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">Add-ons</p>
                      {bookingData.addOns.map(addon => (
                        <p key={addon} className="font-medium text-xs md:text-sm">
                          • {ADD_ONS[addon as keyof typeof ADD_ONS]?.label}
                        </p>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-xs md:text-sm text-muted-foreground">Membership</p>
                    <p className="font-medium text-sm md:text-base">{membership?.label}</p>
                    {bookingData.useCredit && (
                      <p className="text-xs text-green-600 dark:text-green-400">Using 1 credit</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Schedule Details */}
              <Card className="animate-fade-in">
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <Calendar className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                    Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 md:space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">Date</p>
                      <p className="font-medium text-sm md:text-base">
                        {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">Time Window</p>
                      <p className="font-medium text-sm md:text-base">{TIME_SLOT_LABELS[bookingData.timeSlot]}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">ZIP Code</p>
                      <p className="font-medium text-sm md:text-base">{bookingData.zipCode}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Contact Details */}
              <Card className="animate-fade-in md:col-span-2">
                <CardHeader className="pb-3 md:pb-4">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <User className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 md:space-y-3">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <p className="text-xs md:text-sm text-muted-foreground">Name</p>
                      <p className="font-medium text-sm md:text-base">{bookingData.firstName} {bookingData.lastName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <p className="font-medium text-sm md:text-base truncate">{bookingData.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <p className="font-medium text-sm md:text-base">{bookingData.phone}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Collapsible Price Breakdown */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="price-breakdown" className="border rounded-lg px-4">
                <AccordionTrigger className="text-sm md:text-base font-semibold hover:no-underline py-4">
                  <div className="flex items-center gap-2">
                    <ChevronDown className="w-4 h-4" />
                    View Detailed Price Breakdown
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <div className="space-y-3 pt-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs md:text-sm">
                        <span className="text-muted-foreground">Base Price</span>
                        <span className="font-medium">${pricing.basePrice.toFixed(2)}</span>
                      </div>
                      {pricing.serviceAddition > 0 && (
                        <div className="flex justify-between text-xs md:text-sm">
                          <span className="text-muted-foreground">{serviceTier?.label} Addition</span>
                          <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                        </div>
                      )}
                      {pricing.addOnsTotal > 0 && (
                        <div className="flex justify-between text-xs md:text-sm">
                          <span className="text-muted-foreground">Add-ons</span>
                          <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm md:text-base font-semibold">
                      <span>Subtotal</span>
                      <span>${pricing.subtotal.toFixed(2)}</span>
                    </div>
                    {pricing.newCustomerDiscount > 0 && (
                      <div className="flex justify-between text-green-600 dark:text-green-400 text-xs md:text-sm font-semibold">
                        <span>New Customer Discount</span>
                        <span>-${pricing.newCustomerDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {pricing.membershipDiscount > 0 && (
                      <div className="flex justify-between text-green-600 dark:text-green-400 text-xs md:text-sm">
                        <span>Membership Discount</span>
                        <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {bookingData.useCredit && (
                      <div className="flex justify-between text-blue-600 dark:text-blue-400 text-xs md:text-sm">
                        <span>Credit Applied</span>
                        <span>-${Math.min(pricing.basePrice, 150).toFixed(2)}</span>
                      </div>
                    )}
                    <Separator className="border-primary/30" />
                    <div className="flex justify-between text-base md:text-lg font-bold text-primary">
                      <span>Total Service Cost</span>
                      <span>${pricing.total.toFixed(2)}</span>
                    </div>
                    {bookingData.membershipPlan !== 'none' && (
                      <p className="text-xs text-muted-foreground pt-2">
                        + ${membership?.monthlyPrice}/mo membership fee (billed separately)
                      </p>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Desktop Navigation - Hidden on Mobile */}
            <div className="hidden md:flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                className="h-14"
              >
                <ArrowLeft className="mr-2 w-5 h-5" />
                Back
              </Button>
              <Button
                size="lg"
                className="flex-1 h-14 text-base font-semibold bg-gradient-primary hover:opacity-90 shadow-neon"
                onClick={handleConfirm}
              >
                Pay ${pricing.deposit.toFixed(2)} Today
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        onContinue={handleConfirm}
        showPrice={true}
        price={pricing.deposit}
        continueText={`Pay $${pricing.deposit.toFixed(2)} Today`}
      />
    </div>
  );
}
