import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Calendar, Clock, Sparkles, Loader2, CreditCard, Zap } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { calculatePrice, calculateFullPaymentWithDiscount, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";

// Stripe publishable key will be loaded from an Edge Function at runtime

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

export default function BookingCheckout() {
  const navigate = useNavigate();
  const { bookingData, currentStep, updateBookingData } = useBooking();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const effectivePaymentOption = bookingData.paymentOption || 'deposit';

  useEffect(() => {
    // Ensure default payment option for old localStorage payloads
    if (!bookingData.paymentOption) {
      updateBookingData({ paymentOption: 'deposit' });
    }

    // Fetch publishable key from Edge Function (public)
    const init = async () => {
      const { data, error } = await supabase.functions.invoke('get-stripe-publishable-key');
      if (error || !data?.key) {
        console.error('Stripe key missing or error', error || data);
        toast.error('Payments are temporarily unavailable. Please contact support.');
        return;
      }
      setStripePromise(loadStripe(data.key));
    };
    init();
  }, []);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      navigate("/book/summary");
    },
    canSwipeLeft: false,
    step: 7,
  });

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  
  const depositPricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  const handleBack = () => {
    navigate("/book/summary");
  };

  const handlePaymentOptionChange = (value: 'deposit' | 'full') => {
    updateBookingData({ paymentOption: value });
    setClientSecret(null); // Reset payment intent when option changes
  };

  const handleInitializePayment = async () => {
    setIsProcessing(true);
    
    try {
      console.log("Creating payment intent with booking data:", bookingData);
      
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: bookingData,
      });

      if (error) {
        console.error("Payment intent error:", error);
        throw error;
      }

      if (!data) {
        throw new Error("No payment intent data received");
      }

      console.log("Payment intent created:", data);

      // If no payment required (member using credit), go directly to success
      if (!data.requiresPayment) {
        toast.success("Booking confirmed!");
        navigate("/book/success");
        return;
      }

      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
    } catch (error: any) {
      console.error("Payment initialization error:", error);
      toast.error(error.message || "Failed to initialize payment. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentSuccess = () => {
    toast.success("Payment successful!");
    navigate("/book/success");
  };

  // Auto-initialize payment when component mounts
  useEffect(() => {
    if (!clientSecret && !isProcessing) {
      handleInitializePayment();
    }
  }, [bookingData.paymentOption]);

  const currentAmount = bookingData.paymentOption === 'full' 
    ? fullPaymentPricing.finalAmount 
    : depositPricing.deposit;

  return (
    <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <Card className="shadow-xl border-primary/20 animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-8">
            <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4 shadow-lavender">
              <CreditCard className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl md:text-3xl font-bold">Secure Checkout</CardTitle>
            <CardDescription className="text-sm md:text-base">
              Review your order and complete your booking
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* Order Summary */}
            <div className="space-y-6">
              <h3 className="text-xl font-bold">Order Summary</h3>
              
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-primary/20">
                  <CardContent className="p-6 space-y-3">
                    <div className="flex items-center gap-2 text-primary">
                      <Sparkles className="w-5 h-5" />
                      <h4 className="font-semibold">Service Details</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Service</span>
                        <span className="font-medium">{serviceTier?.label}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Home Size</span>
                        <span className="font-medium">{homeSize?.label}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Membership</span>
                        <span className="font-medium">{membership?.label}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-primary/20">
                  <CardContent className="p-6 space-y-3">
                    <div className="flex items-center gap-2 text-primary">
                      <Calendar className="w-5 h-5" />
                      <h4 className="font-semibold">Schedule</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Date</span>
                        <span className="font-medium">
                          {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "MMM d, yyyy")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Time Window</span>
                        <span className="font-medium">{TIME_SLOT_LABELS[bookingData.timeSlot]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ZIP Code</span>
                        <span className="font-medium">{bookingData.zipCode}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Payment Option Selection */}
              {!bookingData.useCredit && (
                <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5">
                  <CardContent className="p-6">
                    <h4 className="font-semibold mb-4 flex items-center gap-2">
                      <Zap className="w-5 h-5 text-primary" />
                      Choose Your Payment Option
                    </h4>
                    <RadioGroup 
                      value={effectivePaymentOption} 
                      onValueChange={handlePaymentOptionChange}
                      className="space-y-4"
                    >
                      {/* Deposit Option */}
                      <div className={cn(
                        "relative flex items-start space-x-3 rounded-lg border-2 p-4 transition-all cursor-pointer hover:border-primary/50",
                        bookingData.paymentOption === 'deposit' 
                          ? "border-primary bg-primary/5" 
                          : "border-border"
                      )}>
                        <RadioGroupItem value="deposit" id="deposit" className="mt-1" />
                        <Label htmlFor="deposit" className="flex-1 cursor-pointer">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold">Pay Deposit Now</span>
                              <span className="text-lg font-bold text-primary">
                                ${depositPricing.deposit.toFixed(2)}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Balance due after cleaning: ${depositPricing.balanceDue.toFixed(2)}
                            </p>
                          </div>
                        </Label>
                      </div>

                      {/* Full Payment Option */}
                      <div className={cn(
                        "relative flex items-start space-x-3 rounded-lg border-2 p-4 transition-all cursor-pointer hover:border-primary/50",
                        bookingData.paymentOption === 'full' 
                          ? "border-primary bg-primary/5" 
                          : "border-border"
                      )}>
                        <RadioGroupItem value="full" id="full" className="mt-1" />
                        <Label htmlFor="full" className="flex-1 cursor-pointer">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">Pay in Full</span>
                                <span className="text-xs font-semibold px-2 py-1 bg-success/20 text-success rounded-full">
                                  Save 10%
                                </span>
                              </div>
                              <span className="text-lg font-bold text-primary">
                                ${fullPaymentPricing.finalAmount.toFixed(2)}
                              </span>
                            </div>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between text-muted-foreground">
                                <span>Original Total:</span>
                                <span className="line-through">${fullPaymentPricing.originalTotal.toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between text-success font-medium">
                                <span>10% Discount:</span>
                                <span>-${fullPaymentPricing.discount.toFixed(2)}</span>
                              </div>
                              <div className="flex items-center gap-1 text-success font-medium pt-1">
                                <Zap className="w-4 h-4" />
                                <span>You save ${fullPaymentPricing.savings.toFixed(2)}!</span>
                              </div>
                            </div>
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </CardContent>
                </Card>
              )}

              {/* Member Credit Info */}
              {bookingData.useCredit && (
                <Card className="border-success/30 bg-success/5">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2 text-success mb-3">
                      <Sparkles className="w-5 h-5" />
                      <h4 className="font-semibold">Using Membership Credit</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your membership credit covers the base service. No deposit required!
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Stripe Payment Form */}
              {stripePromise && clientSecret && paymentAmount > 0 && (
                <Card className="border-primary/20">
                  <CardContent className="p-6">
                    <h4 className="font-semibold mb-4 flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary" />
                      Payment Information
                    </h4>
                    <Elements stripe={stripePromise} options={{ clientSecret }}>
                      <StripePaymentForm 
                        amount={paymentAmount}
                        onSuccess={handlePaymentSuccess}
                      />
                    </Elements>
                  </CardContent>
                </Card>
              )}

              {/* Loading State */}
              {isProcessing && (
                <Card className="border-primary/20">
                  <CardContent className="p-12">
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <Loader2 className="w-12 h-12 animate-spin text-primary" />
                      <p className="text-muted-foreground">Setting up secure payment...</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Security Badge */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="text-success">✓</span>
                <span>Secure Payment</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <span className="text-success">✓</span>
                <span>Encrypted</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <span className="text-success">✓</span>
                <span>PCI Compliant</span>
              </div>
            </div>

            {/* Action Buttons - Desktop Only */}
            <div className="hidden md:flex gap-4 pt-6">
              <Button
                variant="outline"
                size="lg"
                onClick={handleBack}
                disabled={isProcessing}
                className="h-14"
              >
                <ArrowLeft className="mr-2 w-5 h-5" />
                Back
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              By completing payment, you agree to our Terms of Service and Privacy Policy
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Navigation */}
      <BottomNavigation
        currentStep={currentStep}
        totalSteps={6}
        steps={BOOKING_STEPS}
        onBack={handleBack}
        showPrice={true}
        price={currentAmount}
        continueDisabled={true}
      />
    </div>
  );
}
