import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Sparkles, Loader2, CreditCard, AlertCircle, RefreshCw, ChevronDown } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { calculatePrice, calculateFullPaymentWithDiscount, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS, getEstimatedHours, NEW_CUSTOMER_DISCOUNT } from "@/lib/pricing-system";
import { findBestPromoCode, formatPromoSavings, type EligiblePromo } from "@/lib/promo-auto-apply";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PageTransition } from "@/components/booking/PageTransition";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Checkout" },
  { number: 5, label: "Details" },
  { number: 6, label: "Confirm" }
];

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM"
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
  
  // Promo/Referral state
  const [promoInput, setPromoInput] = useState('');
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [isPromoOpen, setIsPromoOpen] = useState(false);
  const [autoAppliedPromo, setAutoAppliedPromo] = useState<EligiblePromo | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);

  const effectivePaymentOption = bookingData.paymentOption || 'deposit';
  const isNewMembershipSignup = bookingData.membershipPlan !== 'none' && !bookingData.useCredit;
  const isMemberUsingCredit = bookingData.useCredit === true;

  // Initialize Stripe
  useEffect(() => {
    if (!bookingData.paymentOption) {
      updateBookingData({ paymentOption: 'deposit' });
    }

    const init = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-stripe-publishable-key');
        
        if (error || !data?.key) {
          const response = await fetch('https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/get-stripe-publishable-key', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
            }
          });
          
          if (!response.ok) throw new Error('Failed to fetch Stripe key');
          const fallbackData = await response.json();
          if (!fallbackData?.key) throw new Error('No Stripe key in response');
          setStripePromise(loadStripe(fallbackData.key));
          return;
        }
        
        setStripePromise(loadStripe(data.key));
      } catch (err: any) {
        console.error('Stripe initialization failed:', err);
        setInitError('Unable to load payment system. Please try again.');
      }
    };
    init();
  }, []);

  // Check if new customer and auto-apply best promo
  useEffect(() => {
    const checkNewCustomer = async () => {
      if (!bookingData.email) return;
      const { data } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('email', bookingData.email)
        .in('status', ['confirmed', 'completed'])
        .limit(1);

      const isNew = !data || data.length === 0;
      setIsNewCustomer(isNew);
      await autoApplyBestPromo(isNew);
    };
    checkNewCustomer();
  }, [bookingData.email]);

  const autoApplyBestPromo = async (isNew: boolean) => {
    if (!bookingData.email || isAutoApplying) return;
    setIsAutoApplying(true);
    try {
      const subtotal = calculatePrice(
        bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns,
        bookingData.membershipPlan, bookingData.useCredit, isNew, 0
      ).subtotal;
      
      const bestPromo = await findBestPromoCode(supabase, bookingData.email, isNew, subtotal);
      if (bestPromo) {
        setAutoAppliedPromo(bestPromo);
        setAppliedPromoCode(bestPromo.code);
        setPromoDiscount(bestPromo.discount);
        updateBookingData({ promoCode: bestPromo.code });
        toast.success(`${bestPromo.description} auto-applied!`);
      }
    } catch (error) {
      console.error('Error auto-applying promo:', error);
    } finally {
      setIsAutoApplying(false);
    }
  };

  // Swipe handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => navigate("/book/offer"),
    step: 4
  });

  // Get pricing data
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const depositPricing = calculatePrice(
    bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns,
    bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount
  );
  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns,
    bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount
  );

  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setIsValidatingPromo(true);

    try {
      const { data: promo, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', promoInput.toUpperCase())
        .eq('active', true)
        .single();

      if (error || !promo) {
        toast.error('Invalid promo code');
        return;
      }

      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        toast.error('This promo code has expired');
        return;
      }

      if (promo.applies_to === 'new_customers' && !isNewCustomer) {
        toast.error('This code is only for new customers');
        return;
      }

      const subtotal = depositPricing.subtotal;
      let discount = promo.type === 'percent' 
        ? Math.round(subtotal * promo.value / 100 * 100) / 100 
        : promo.value;

      setPromoDiscount(discount);
      setAppliedPromoCode(promoInput.toUpperCase());
      setAutoAppliedPromo(null);
      updateBookingData({ promoCode: promoInput.toUpperCase() });
      toast.success(`Promo applied! Saving $${discount.toFixed(2)}`);
      setIsPromoOpen(false);
    } catch (err) {
      toast.error('Error validating promo code');
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setPromoInput('');
    setPromoDiscount(0);
    setAppliedPromoCode(null);
    setAutoAppliedPromo(null);
    updateBookingData({ promoCode: undefined });
    toast.info('Promo code removed');
  };

  const handleBack = () => navigate("/book/offer");

  const handleMembershipCheckout = async () => {
    setIsProcessing(true);
    setInitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { bookingData }
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, '_blank');
        toast.success("Redirecting to secure checkout...");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      setInitError(error.message || "Failed to create checkout session");
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInitializePayment = async () => {
    setIsProcessing(true);
    setInitError(null);
    try {
      let data, error;
      
      try {
        const result = await supabase.functions.invoke("create-payment-intent", {
          body: bookingData
        });
        data = result.data;
        error = result.error;
      } catch (invokeError) {
        const response = await fetch('https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
          },
          body: JSON.stringify(bookingData)
        });
        
        if (!response.ok) throw new Error('Payment initialization failed');
        data = await response.json();
        error = null;
      }
      
      if (error || !data) throw new Error(error?.message || "No payment intent data received");

      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (error: any) {
      setInitError(error.message || "Payment service unavailable. Please try again.");
      toast.error(error.message || "Payment setup failed");
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
    if (bookingId) {
      updateBookingData({ bookingId });
    }
    navigate("/book/details?booking_id=" + bookingId);
  };

  // Auto-initialize payment
  useEffect(() => {
    if (!clientSecret && !isProcessing) {
      handleInitializePayment();
    }
  }, [bookingData.paymentOption]);

  const currentAmount = effectivePaymentOption === 'full' 
    ? fullPaymentPricing.finalAmount 
    : depositPricing.deposit;

  const totalSavings = (isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0) + 
    (depositPricing.membershipDiscount || 0) + 
    (effectivePaymentOption === 'full' ? fullPaymentPricing.discount : 0) + 
    promoDiscount;

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
        <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
        
        <div className="container max-w-lg mx-auto px-4 py-6">
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mb-3">
                <CreditCard className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg font-semibold">Secure Checkout</CardTitle>
            </CardHeader>
            
            <CardContent className="space-y-5">
              {/* Compact Order Summary */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium">{serviceTier?.label} • {homeSize?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">
                    {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "MMM d, yyyy")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Time</span>
                  <span className="font-medium">{TIME_SLOT_LABELS[bookingData.timeSlot]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Duration</span>
                  <span className="font-medium">{getEstimatedHours(bookingData.homeSizeId)} hours</span>
                </div>
              </div>

              <Separator />

              {/* Pricing Breakdown */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>${depositPricing.subtotal.toFixed(2)}</span>
                </div>
                
                {isNewCustomer && (
                  <div className="flex justify-between text-green-600">
                    <span>New Customer Discount</span>
                    <span>-${NEW_CUSTOMER_DISCOUNT.toFixed(2)}</span>
                  </div>
                )}
                
                {depositPricing.membershipDiscount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Membership Discount</span>
                    <span>-${depositPricing.membershipDiscount.toFixed(2)}</span>
                  </div>
                )}
                
                {effectivePaymentOption === 'full' && fullPaymentPricing.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Pay in Full Discount (10%)</span>
                    <span>-${fullPaymentPricing.discount.toFixed(2)}</span>
                  </div>
                )}
                
                {promoDiscount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span className="flex items-center gap-1">
                      Promo: {appliedPromoCode}
                      {autoAppliedPromo && <Badge variant="secondary" className="text-[10px] px-1">Auto</Badge>}
                    </span>
                    <span>-${promoDiscount.toFixed(2)}</span>
                  </div>
                )}

                <Separator className="my-2" />
                
                <div className="flex justify-between font-bold text-base">
                  <span>{effectivePaymentOption === 'deposit' ? 'Deposit Due Today' : 'Total Due Today'}</span>
                  <span className="text-primary">${currentAmount.toFixed(2)}</span>
                </div>
                
                {effectivePaymentOption === 'deposit' && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Balance due after service</span>
                    <span>${depositPricing.balanceDue.toFixed(2)}</span>
                  </div>
                )}
                
                {totalSavings > 0 && (
                  <div className="text-center pt-1">
                    <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                      Total Savings: ${totalSavings.toFixed(2)}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Collapsible Promo Code Input */}
              {!appliedPromoCode && (
                <Collapsible open={isPromoOpen} onOpenChange={setIsPromoOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full text-sm text-primary hover:underline">
                    <span>Have a promo or referral code?</span>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", isPromoOpen && "rotate-180")} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Enter code"
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                        className="font-mono text-sm"
                        maxLength={15}
                      />
                      <Button 
                        onClick={handleApplyPromo} 
                        disabled={!promoInput || isValidatingPromo}
                        size="sm"
                      >
                        {isValidatingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              
              {appliedPromoCode && (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-green-700">
                    <Sparkles className="w-4 h-4" />
                    <span className="font-medium">{appliedPromoCode}</span>
                    <span className="text-green-600">-${promoDiscount.toFixed(2)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={handleRemovePromo} className="text-xs h-7">
                    Remove
                  </Button>
                </div>
              )}

              <Separator />

              {/* Membership Signup Flow */}
              {isNewMembershipSignup && (
                <div className="space-y-4">
                  <div className="bg-primary/5 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Membership: {membership?.label}</span>
                      <Badge>${membership?.monthlyPrice}/mo</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {membership?.cleansPerMonth} cleaning credit/month • Cancel anytime
                    </p>
                  </div>
                  
                  <Button 
                    onClick={handleMembershipCheckout}
                    size="lg"
                    className="w-full"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Processing...</>
                    ) : (
                      'Subscribe & Book First Clean'
                    )}
                  </Button>
                </div>
              )}

              {/* Member Using Credit */}
              {isMemberUsingCredit && (
                <div className="text-center space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <Sparkles className="w-8 h-8 text-green-600 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-green-700">$0.00</p>
                    <p className="text-sm text-green-600">Covered by membership credit</p>
                  </div>
                  <Button 
                    onClick={() => navigate("/book/success")}
                    size="lg"
                    className="w-full"
                  >
                    Confirm Booking
                  </Button>
                </div>
              )}

              {/* Regular Payment Flow */}
              {!isNewMembershipSignup && !isMemberUsingCredit && (
                <>
                  {/* Error State */}
                  {initError && !isProcessing && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
                      <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                      <p className="text-sm text-destructive mb-3">{initError}</p>
                      <Button variant="outline" size="sm" onClick={handleRetryPayment}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Try Again
                      </Button>
                    </div>
                  )}

                  {/* Loading State */}
                  {isProcessing && (
                    <div className="text-center py-8">
                      <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">Setting up secure payment...</p>
                    </div>
                  )}

                  {/* Stripe Payment Form */}
                  {stripePromise && clientSecret && paymentAmount > 0 && !initError && !isProcessing && (
                    <Elements stripe={stripePromise} options={{ clientSecret }}>
                      <StripePaymentForm 
                        amount={paymentAmount} 
                        onSuccess={handlePaymentSuccess} 
                        onRetry={handleRetryPayment} 
                        customerEmail={bookingData.email} 
                      />
                    </Elements>
                  )}
                </>
              )}

              {/* Security Badge */}
              <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground pt-2">
                <span>🔒 Secure</span>
                <span>•</span>
                <span>Encrypted</span>
                <span>•</span>
                <span>PCI Compliant</span>
              </div>

              {/* Desktop Back Button */}
              <div className="hidden md:block pt-4">
                <Button variant="outline" onClick={handleBack} disabled={isProcessing}>
                  <ArrowLeft className="mr-2 w-4 h-4" />
                  Back
                </Button>
              </div>

              <p className="text-center text-[10px] text-muted-foreground">
                By completing payment, you agree to our Terms of Service and Privacy Policy
              </p>
            </CardContent>
          </Card>
        </div>

        <BottomNavigation 
          currentStep={currentStep} 
          totalSteps={6} 
          steps={BOOKING_STEPS} 
          onBack={handleBack} 
          showPrice={true} 
          price={currentAmount} 
          continueDisabled={true} 
        />

        <BookingFooter />
      </div>
    </PageTransition>
  );
}
