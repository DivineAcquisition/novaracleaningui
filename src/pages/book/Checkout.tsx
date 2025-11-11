import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Calendar, Clock, Sparkles, Loader2, CreditCard, Zap, AlertCircle, RefreshCw, Gift, ChevronLeft, ChevronRight } from "lucide-react";
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
import { SavingsVisualizer } from "@/components/booking/SavingsVisualizer";
import { useSwipeable } from "react-swipeable";

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
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
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

  // Check customer booking history to determine if they are a new customer
  useEffect(() => {
    const checkNewCustomer = async () => {
      if (!bookingData.email) return;
      
      const { data } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('email', bookingData.email)
        .in('status', ['confirmed', 'completed'])
        .limit(1);
      
      // Only truly first-time customers (no confirmed/completed bookings) get the discount
      setIsNewCustomer(!data || data.length === 0);
    };
    
    checkNewCustomer();
  }, [bookingData.email]);

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      navigate("/book/details");
    },
    step: 6,
  });

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  
  const depositPricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer
  );

  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer
  );

  const handleBack = () => {
    navigate("/book/summary");
  };

  const handlePaymentOptionChange = (value: 'deposit' | 'full') => {
    updateBookingData({ paymentOption: value });
    setClientSecret(null); // Reset payment intent when option changes
    setInitError(null);
  };

  // Swipe gesture handlers for payment option toggle
  const paymentSwipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (effectivePaymentOption === 'deposit') {
        setSwipeDirection('left');
        setTimeout(() => {
          handlePaymentOptionChange('full');
          setSwipeDirection(null);
        }, 150);
      }
    },
    onSwipedRight: () => {
      if (effectivePaymentOption === 'full') {
        setSwipeDirection('right');
        setTimeout(() => {
          handlePaymentOptionChange('deposit');
          setSwipeDirection(null);
        }, 150);
      }
    },
    trackMouse: false,
    trackTouch: true,
    delta: 50,
    preventScrollOnSwipe: false,
  });

  const handleInitializePayment = async () => {
    setIsProcessing(true);
    setInitError(null);
    
    try {
      console.log("Creating payment intent with booking data:", bookingData);
      
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: bookingData,
      });

      if (error) {
        console.error("Payment intent error:", error);
        throw new Error(error.message || "Failed to initialize payment");
      }

      if (!data) {
        throw new Error("No payment intent data received");
      }

      console.log("Payment intent created:", data);

      // CRITICAL: Always require payment verification - no auto-confirmation
      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (error: any) {
      console.error("Payment initialization error:", error);
      const errorMessage = error.message || "Failed to initialize payment. Please try again.";
      setInitError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryPayment = () => {
    setClientSecret(null);
    setInitError(null);
    handleInitializePayment();
  };

  const handlePaymentSuccess = () => {
    toast.success("Payment successful!");
    // Store booking ID in booking data for additional details page
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntent = urlParams.get('payment_intent');
    if (bookingId) {
      updateBookingData({ bookingId });
    }
    navigate("/book/additional-details?booking_id=" + bookingId);
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
        <Card variant="outlined" className="border-primary/30 shadow-card animate-fade-in">
          <CardHeader className="text-center space-y-2 pb-8">
            <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4 shadow-lavender">
              <CreditCard className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-lg md:text-xl font-semibold">Secure Checkout</CardTitle>
            <CardDescription className="text-sm">
              Review your order and complete your booking
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* New Customer Discount Banner */}
            {isNewCustomer && !user && (
              <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-50 to-emerald-50">
                <CardContent className="p-3 md:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-green-600 flex items-center justify-center">
                      <Gift className="w-4 h-4 md:w-5 md:h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold md:text-base text-green-700">New Customer Special!</p>
                      <p className="text-xs md:text-sm text-green-600">You're saving $60 on this booking 🎉</p>
                    </div>
                  </div>
                  <div className="text-base md:text-2xl font-bold text-green-700">-$60</div>
                </CardContent>
              </Card>
            )}

            {/* Order Summary */}
            <div className="space-y-6">
            <h3 className="text-lg md:text-xl font-semibold" id="order-summary-heading">
              Order Summary
            </h3>
              
              <div className="grid gap-4 md:grid-cols-2" role="region" aria-labelledby="order-summary-heading">
                <Card className="border-2 border-primary/30 shadow-md">
                  <CardContent className="p-4 md:p-6 space-y-2 md:space-y-3">
                    <div className="flex items-center gap-2 text-primary">
                      <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
                      <h4 className="font-semibold text-sm md:text-base">Service Details</h4>
                    </div>
                    <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm">
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

                <Card className="border-2 border-primary/30 shadow-md">
                  <CardContent className="p-4 md:p-6 space-y-2 md:space-y-3">
                    <div className="flex items-center gap-2 text-primary">
                      <Calendar className="w-4 h-4 md:w-5 md:h-5" />
                      <h4 className="font-semibold text-sm md:text-base">Schedule</h4>
                    </div>
                    <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm">
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

              {/* Savings Visualizer */}
              <SavingsVisualizer
                originalPrice={depositPricing.subtotal}
                newCustomerDiscount={isNewCustomer ? 60 : 0}
                membershipDiscount={bookingData.membershipPlan ? depositPricing.membershipDiscount : 0}
                fullPaymentDiscount={bookingData.paymentOption === 'full' ? (fullPaymentPricing.originalTotal - fullPaymentPricing.finalAmount - (isNewCustomer ? 60 : 0) - (bookingData.membershipPlan ? depositPricing.membershipDiscount : 0)) : 0}
                finalPrice={bookingData.paymentOption === 'deposit' ? depositPricing.deposit : fullPaymentPricing.finalAmount}
              />

              {/* Payment Option Selection */}
              {!bookingData.useCredit && (
                <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-secondary/5">
                  <CardContent className="p-4 md:p-6">
                    <div className="flex items-center justify-between mb-3 md:mb-4">
                      <h4 className="font-semibold text-sm md:text-base flex items-center gap-2">
                        <Zap className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                        Choose Your Payment Option
                      </h4>
                      <div className="md:hidden flex items-center gap-1 text-xs text-muted-foreground">
                        <ChevronLeft className="w-3 h-3" />
                        <span>Swipe</span>
                        <ChevronRight className="w-3 h-3" />
                      </div>
                    </div>
                    <div 
                      {...paymentSwipeHandlers}
                      className={cn(
                        "transition-transform duration-150",
                        swipeDirection === 'left' && "md:transform-none -translate-x-2",
                        swipeDirection === 'right' && "md:transform-none translate-x-2"
                      )}
                    >
                      <RadioGroup 
                        value={effectivePaymentOption} 
                        onValueChange={handlePaymentOptionChange}
                        className="space-y-3 md:space-y-4"
                      >
                        {/* Deposit Option */}
                        <div className={cn(
                          "relative flex items-start space-x-2 md:space-x-3 rounded-lg border-2 p-3 md:p-4 transition-all cursor-pointer hover:border-primary/50",
                          bookingData.paymentOption === 'deposit' 
                            ? "border-primary bg-primary/5 shadow-md" 
                            : "border-border"
                        )}>
                          <RadioGroupItem value="deposit" id="deposit" className="mt-1" />
                          <Label htmlFor="deposit" className="flex-1 cursor-pointer">
                            <div className="space-y-1.5 md:space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm md:text-base">Pay Deposit Now</span>
                                <span className="text-base md:text-lg font-bold text-primary">
                                  ${depositPricing.deposit.toFixed(2)}
                                </span>
                              </div>
                              <p className="text-xs md:text-sm text-muted-foreground">
                                Balance after: ${depositPricing.balanceDue.toFixed(2)}
                              </p>
                              {(depositPricing.membershipDiscount > 0 || depositPricing.newCustomerDiscount > 0) && (
                                <div className="text-[10px] md:text-xs space-y-0.5 pt-1.5 border-t border-border/50 mt-2">
                                  {depositPricing.newCustomerDiscount > 0 && (
                                    <div className="flex items-center justify-between text-green-600 font-semibold">
                                      <span className="flex items-center gap-1">
                                        <Gift className="w-3 h-3" />
                                        New Customer $60 Off:
                                      </span>
                                      <span>-${depositPricing.newCustomerDiscount.toFixed(2)}</span>
                                    </div>
                                  )}
                                  {depositPricing.membershipDiscount > 0 && (
                                    <div className="flex justify-between text-success">
                                      <span>Membership discount:</span>
                                      <span className="font-medium">-${depositPricing.membershipDiscount.toFixed(2)}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </Label>
                        </div>

                        {/* Full Payment Option */}
                        <div className={cn(
                          "relative flex items-start space-x-2 md:space-x-3 rounded-lg border-2 p-3 md:p-4 transition-all cursor-pointer hover:border-primary/50",
                          bookingData.paymentOption === 'full' 
                            ? "border-primary bg-primary/5 shadow-md" 
                            : "border-border"
                        )}>
                          <RadioGroupItem value="full" id="full" className="mt-1" />
                          <Label htmlFor="full" className="flex-1 cursor-pointer">
                            <div className="space-y-1.5 md:space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5 md:gap-2">
                                  <span className="font-semibold text-sm md:text-base">Pay in Full</span>
                                  <span className="text-[10px] md:text-xs font-semibold px-1.5 py-0.5 md:px-2 md:py-1 bg-success/20 text-success rounded-full">
                                    Save 10%
                                  </span>
                                </div>
                                <span className="text-base md:text-lg font-bold text-primary">
                                  ${fullPaymentPricing.finalAmount.toFixed(2)}
                                </span>
                              </div>
                              <div className="space-y-0.5 md:space-y-1 text-[10px] md:text-xs">
                                <div className="flex justify-between text-muted-foreground">
                                  <span>Original Total:</span>
                                  <span className="line-through">${fullPaymentPricing.originalTotal.toFixed(2)}</span>
                                </div>
                                {fullPaymentPricing.newCustomerDiscount > 0 && (
                                  <div className="flex items-center justify-between text-green-600 font-semibold">
                                    <span className="flex items-center gap-1">
                                      <Gift className="w-3 h-3" />
                                      New Customer $60 Off:
                                    </span>
                                    <span>-${fullPaymentPricing.newCustomerDiscount.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-success font-medium">
                                  <span>10% Full Payment Discount:</span>
                                  <span>-${fullPaymentPricing.discount.toFixed(2)}</span>
                                </div>
                                <Separator className="my-1 md:my-1.5" />
                                <div className="flex items-center justify-between gap-1 text-success font-bold pt-0.5 md:pt-1">
                                  <span className="flex items-center gap-1">
                                    <Zap className="w-3 h-3 md:w-4 md:h-4" />
                                    Total You Save:
                                  </span>
                                  <span className="text-sm md:text-base">${fullPaymentPricing.savings.toFixed(2)}</span>
                                </div>
                              </div>
                            </div>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
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

              {/* Initialization Error */}
              {initError && !isProcessing && (
                <Alert variant="destructive" className="animate-in slide-in-from-top">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Payment Setup Failed</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>{initError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetryPayment}
                      className="mt-2"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Try Again
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Stripe Payment Form */}
              {stripePromise && clientSecret && paymentAmount > 0 && !initError && (
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
              onRetry={handleRetryPayment}
              customerEmail={bookingData.email}
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
