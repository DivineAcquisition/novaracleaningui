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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Clock, Sparkles, Loader2, CreditCard, Zap, AlertCircle, RefreshCw, Gift, ChevronLeft, ChevronRight } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { calculatePrice, calculateFullPaymentWithDiscount, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS, applyPromoCode, getEstimatedHours, HOURLY_RATE, NEW_CUSTOMER_DISCOUNT } from "@/lib/pricing-system";
import { findBestPromoCode, formatPromoSavings, getPromoRecommendation, type EligiblePromo } from "@/lib/promo-auto-apply";
import { useBookingSwipe } from "@/hooks/use-booking-swipe";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { SavingsVisualizer } from "@/components/booking/SavingsVisualizer";
import { PaymentComparison } from "@/components/booking/PaymentComparison";
import { useSwipeable } from "react-swipeable";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PageTransition } from "@/components/booking/PageTransition";

// Stripe publishable key will be loaded from an Edge Function at runtime

const BOOKING_STEPS = [{
  number: 1,
  label: "Location"
}, {
  number: 2,
  label: "Home Size"
}, {
  number: 3,
  label: "Service"
}, {
  number: 4,
  label: "Checkout"
}, {
  number: 5,
  label: "Details"
}, {
  number: 6,
  label: "Confirm"
}];
const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM"
};
export default function BookingCheckout() {
  const navigate = useNavigate();
  const {
    bookingData,
    currentStep,
    updateBookingData
  } = useBooking();
  const {
    user
  } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [referralCode, setReferralCode] = useState<string>('');
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [promoCode, setPromoCode] = useState<string>('');
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [autoAppliedPromo, setAutoAppliedPromo] = useState<EligiblePromo | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const effectivePaymentOption = bookingData.paymentOption || 'deposit';
  
  // Determine checkout scenario
  const isNewMembershipSignup = bookingData.membershipPlan !== 'none' && !bookingData.useCredit;
  const isMemberUsingCredit = bookingData.useCredit === true;

  useEffect(() => {
    // Ensure default payment option for old localStorage payloads
    if (!bookingData.paymentOption) {
      updateBookingData({
        paymentOption: 'deposit'
      });
    }

    // Fetch publishable key from Edge Function (public)
    const init = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-stripe-publishable-key');
        
        if (error || !data?.key) {
          console.warn('Primary Stripe key fetch failed, attempting fallback:', error);
          
          // Fallback: direct fetch to Edge Function URL
          const response = await fetch('https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/get-stripe-publishable-key', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
            }
          });
          
          if (!response.ok) {
            throw new Error('Failed to fetch Stripe key');
          }
          
          const fallbackData = await response.json();
          if (!fallbackData?.key) {
            throw new Error('No Stripe key in fallback response');
          }
          
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

  // Check customer booking history to determine if they are a new customer
  useEffect(() => {
    const checkNewCustomer = async () => {
      if (!bookingData.email) return;
      const {
        data
      } = await supabase.from('bookings').select('id, status').eq('email', bookingData.email).in('status', ['confirmed', 'completed']).limit(1);

      // Only truly first-time customers (no confirmed/completed bookings) get the discount
      const isNew = !data || data.length === 0;
      setIsNewCustomer(isNew);

      // Auto-apply best promo code for this customer
      await autoApplyBestPromo(isNew);
    };
    checkNewCustomer();
  }, [bookingData.email]);

  // Auto-apply the best eligible promo code
  const autoApplyBestPromo = async (isNew: boolean) => {
    if (!bookingData.email || isAutoApplying) return;
    setIsAutoApplying(true);
    try {
      const subtotal = calculatePrice(bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns, bookingData.membershipPlan, bookingData.useCredit, isNew, 0).subtotal;
      const bestPromo = await findBestPromoCode(supabase, bookingData.email, isNew, subtotal);
      if (bestPromo) {
        setAutoAppliedPromo(bestPromo);
        setPromoCode(bestPromo.code);
        setPromoDiscount(bestPromo.discount);
        setPromoMessage(formatPromoSavings(bestPromo));
        updateBookingData({
          promoCode: bestPromo.code
        });
        toast.success(`${bestPromo.description} - You're saving $${bestPromo.discount.toFixed(2)}!`, {
          duration: 5000
        });
      }
    } catch (error) {
      console.error('Error auto-applying promo:', error);
    } finally {
      setIsAutoApplying(false);
    }
  };

  // Swipe gesture handlers
  const swipeHandlers = useBookingSwipe({
    onSwipeRight: () => {
      navigate("/book/offer");
    },
    step: 4
  });
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const depositPricing = calculatePrice(bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns, bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount);
  const fullPaymentPricing = calculateFullPaymentWithDiscount(bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns, bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount);
  const handleValidatePromo = async () => {
    if (!promoCode.trim()) return;
    setIsValidatingPromo(true);
    setPromoMessage(null);
    setAutoAppliedPromo(null); // Clear auto-applied promo when manually validating

    try {
      const {
        data: promo,
        error
      } = await supabase.from('promo_codes').select('*').eq('code', promoCode.toUpperCase()).eq('active', true).single();
      if (error || !promo) {
        setPromoMessage('Invalid promo code');
        setPromoDiscount(0);
        toast.error('Invalid promo code');
        return;
      }

      // Check expiration
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        setPromoMessage('This promo code has expired');
        setPromoDiscount(0);
        toast.error('This promo code has expired');
        return;
      }

      // Check eligibility
      if (promo.applies_to === 'new_customers' && !isNewCustomer) {
        setPromoMessage('This code is only for new customers');
        setPromoDiscount(0);
        toast.error('This code is only for new customers');
        return;
      }
      if (promo.applies_to === 'returning_customers' && isNewCustomer) {
        setPromoMessage('This code is only for returning customers');
        setPromoDiscount(0);
        toast.error('This code is only for returning customers');
        return;
      }

      // Calculate discount
      const subtotal = depositPricing.subtotal;
      let discount = 0;
      if (promo.type === 'percent') {
        discount = Math.round(subtotal * promo.value / 100 * 100) / 100;
      } else {
        discount = promo.value;
      }
      setPromoDiscount(discount);
      setPromoMessage(`🎉 ${promo.value}% off applied!`);
      updateBookingData({
        promoCode: promoCode.toUpperCase()
      });
      toast.success(`Promo code applied! You're saving $${discount}`);
    } catch (err) {
      console.error('Error validating promo:', err);
      setPromoMessage('Error validating promo code');
      setPromoDiscount(0);
      toast.error('Error validating promo code');
    } finally {
      setIsValidatingPromo(false);
    }
  };
  const handleRemovePromo = () => {
    setPromoCode('');
    setPromoDiscount(0);
    setPromoMessage(null);
    setAutoAppliedPromo(null);
    updateBookingData({
      promoCode: undefined
    });
    toast.info('Promo code removed');
  };
  const handleBack = () => {
    navigate("/book/offer");
  };
  const handlePaymentOptionChange = (value: 'deposit' | 'full') => {
    updateBookingData({
      paymentOption: value
    });
    setClientSecret(null); // Reset payment intent when option changes
    setInitError(null);
  };

  // Trigger haptic feedback on mobile devices
  const triggerHaptic = () => {
    if (navigator.vibrate) {
      navigator.vibrate(50); // Short, subtle vibration
    }
  };

  // Swipe gesture handlers for payment option toggle
  const paymentSwipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (effectivePaymentOption === 'deposit') {
        triggerHaptic();
        setSwipeDirection('left');
        setTimeout(() => {
          handlePaymentOptionChange('full');
          setSwipeDirection(null);
        }, 150);
      }
    },
    onSwipedRight: () => {
      if (effectivePaymentOption === 'full') {
        triggerHaptic();
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
    preventScrollOnSwipe: false
  });
  const handleMembershipCheckout = async () => {
    setIsProcessing(true);
    setInitError(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { bookingData }
      });

      if (error) throw error;

      if (data?.url) {
        // Open Stripe checkout in new tab
        window.open(data.url, '_blank');
        toast.success("Redirecting to secure checkout...");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      console.error("Membership checkout error:", error);
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
      console.debug('[PAYMENT] Creating payment intent at', new Date().toISOString());
      
      let data, error;
      
      try {
        const result = await supabase.functions.invoke("create-payment-intent", {
          body: bookingData
        });
        data = result.data;
        error = result.error;
      } catch (invokeError) {
        console.warn('[PAYMENT] Primary invoke failed, attempting fallback:', invokeError);
        
        // Fallback: direct fetch to Edge Function URL
        const response = await fetch('https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
          },
          body: JSON.stringify(bookingData)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Fallback fetch failed: ${errorText}`);
        }
        
        data = await response.json();
        error = null;
      }
      
      if (error) {
        console.error("[PAYMENT] Payment intent error:", error);
        throw new Error(error.message || "Failed to initialize payment");
      }
      
      if (!data) {
        throw new Error("No payment intent data received");
      }
      
      console.debug("[PAYMENT] Payment intent created successfully:", { 
        amount: data.amount, 
        bookingId: data.bookingId 
      });

      // CRITICAL: Always require payment verification - no auto-confirmation
      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (error: any) {
      console.error("[PAYMENT] Initialization error:", error);
      const errorMessage = error.message || "Payment service unavailable. Please try again.";
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
    // Store booking ID in booking data for property details page
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntent = urlParams.get('payment_intent');
    if (bookingId) {
      updateBookingData({
        bookingId
      });
    }
    navigate("/book/details?booking_id=" + bookingId);
  };

  // Auto-initialize payment when component mounts
  useEffect(() => {
    if (!clientSecret && !isProcessing) {
      handleInitializePayment();
    }
  }, [bookingData.paymentOption]);
  const currentAmount = bookingData.paymentOption === 'full' ? fullPaymentPricing.finalAmount : depositPricing.deposit;
  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
        <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <Card variant="outlined" className="border-primary/30 shadow-card animate-fade-in">
          <CardHeader className="text-center space-y-1.5 pb-5 md:pb-8">
            <div className="mx-auto w-12 h-12 md:w-16 md:h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-2 md:mb-4 shadow-lavender">
              <CreditCard className="w-6 h-6 md:w-8 md:h-8 text-white" />
            </div>
            <CardTitle className="text-base md:text-xl font-semibold font-jakarta">
              Secure Checkout
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              {autoAppliedPromo ? `Best discount applied! Saving you $${autoAppliedPromo.discount.toFixed(2)}` : "Review your order and complete your booking"}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-5 md:space-y-8">
            {/* Holiday Promotion Banner */}
            <Card className="border-2 border-primary/50 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 overflow-hidden relative">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIi8+PC9zdmc+')] opacity-50"></div>
              <CardContent className="p-4 md:p-6 relative z-10">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    
                    <div className="flex-1">
                      <p className="md:text-lg text-foreground font-jakarta font-bold text-sm">
                        🎄 Automatic Holiday Savings Applied!
                      </p>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        {autoAppliedPromo ? `${autoAppliedPromo.description} • Save $${autoAppliedPromo.discount.toFixed(2)}` : "We'll find the best discount for you • Up to 25% off"}
                      </p>
                    </div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="text-xs font-semibold">Ends Jan 5</Badge>
                    {autoAppliedPromo && <Badge variant="default" className="text-xs bg-green-600">Auto-Applied</Badge>}
                  </div>
                </div>
                {isAutoApplying && <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Finding best discount for you...</span>
                  </div>}
              </CardContent>
            </Card>

            {/* New Customer Discount Banner */}
            {isNewCustomer && !user && <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-50 to-emerald-50">
                <CardContent className="p-3 md:p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-green-600 flex items-center justify-center">
                      <Gift className="w-4 h-4 md:w-5 md:h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold md:text-base text-green-700">New Customer Special!</p>
                      <p className="text-xs md:text-sm text-green-600">You're saving ${NEW_CUSTOMER_DISCOUNT} on this booking 🎉</p>
                    </div>
                  </div>
                  <div className="text-base md:text-2xl font-bold text-green-700">-${NEW_CUSTOMER_DISCOUNT}</div>
                </CardContent>
              </Card>}

            {/* Referral Code Input */}
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="referralCode" className="text-sm font-medium">
                    Have a Referral Code?
                  </Label>
                  {referralValid !== null && <Badge variant={referralValid ? "default" : "destructive"} className="text-xs">
                      {referralValid ? '✓ Valid - $50 off!' : '✗ Invalid'}
                    </Badge>}
                </div>
                <div className="flex gap-2">
                  <Input id="referralCode" placeholder="Enter code (e.g., ABC12345)" value={referralCode} onChange={e => {
                  const code = e.target.value.toUpperCase();
                  setReferralCode(code);
                  setReferralValid(null);
                  updateBookingData({
                    referralCode: code
                  });
                }} maxLength={8} className="font-mono" />
                  <Button variant="outline" size="sm" disabled={!referralCode || isValidatingReferral} onClick={async () => {
                  setIsValidatingReferral(true);
                  try {
                    const {
                      data
                    } = await supabase.from('customers').select('email').eq('referral_code', referralCode).maybeSingle();
                    const isValid = !!data && data.email !== bookingData.email;
                    setReferralValid(isValid);
                    if (isValid) {
                      toast.success('Referral code applied! You saved $50');
                    } else {
                      toast.error(data ? 'Cannot use your own referral code' : 'Invalid referral code');
                    }
                  } catch (error) {
                    setReferralValid(false);
                    toast.error('Error validating code');
                  } finally {
                    setIsValidatingReferral(false);
                  }
                }}>
                    {isValidatingReferral ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
                {referralValid && <p className="text-xs text-green-600">
                    🎉 You'll save $50 on this booking!
                  </p>}
              </CardContent>
            </Card>

            {/* Promo Code Input */}
            <Card className="border-2 border-primary/30 bg-gradient-to-br from-accent/10 to-primary/10">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="promoCode" className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    {autoAppliedPromo ? 'Promo Applied' : 'Have a Different Promo Code?'}
                  </Label>
                  {promoMessage && <Badge variant={promoDiscount > 0 ? "default" : "destructive"} className="text-xs">
                      {promoDiscount > 0 ? `✓ -$${promoDiscount}` : '✗ Invalid'}
                    </Badge>}
                </div>

                {autoAppliedPromo && <Alert className="bg-green-50 border-green-200">
                    <Sparkles className="w-4 h-4 text-green-600" />
                    <AlertTitle className="text-sm font-semibold text-green-800">
                      Best discount automatically applied!
                    </AlertTitle>
                    <AlertDescription className="text-xs text-green-700">
                      Code: <strong>{autoAppliedPromo.code}</strong> - {autoAppliedPromo.description}
                    </AlertDescription>
                  </Alert>}

                <div className="flex gap-2">
                  <Input id="promoCode" placeholder={autoAppliedPromo ? "Override with different code" : "Enter promo code"} value={promoCode} onChange={e => {
                  const code = e.target.value.toUpperCase();
                  setPromoCode(code);
                  setPromoMessage(null);
                  if (!code) {
                    setPromoDiscount(0);
                    setAutoAppliedPromo(null);
                  }
                }} maxLength={15} className="font-mono text-sm" disabled={isAutoApplying} />
                  {promoCode && promoDiscount > 0 ? <Button variant="outline" size="sm" onClick={handleRemovePromo} className="shrink-0">
                      Remove
                    </Button> : <Button variant="default" size="sm" disabled={!promoCode || isValidatingPromo || isAutoApplying} onClick={handleValidatePromo} className="bg-gradient-primary hover:opacity-90 shrink-0">
                      {isValidatingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                    </Button>}
                </div>

                {promoMessage && !autoAppliedPromo && <p className={cn("text-xs font-medium", promoDiscount > 0 ? "text-green-600" : "text-destructive")}>
                    {promoMessage}
                  </p>}

                {!autoAppliedPromo && <div className="text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold mb-1.5">Available codes:</p>
                    <p>• <strong>HOLIDAY25</strong>: 25% off for new customers</p>
                    <p>• <strong>JOLLY20</strong>: 20% off for returning customers</p>
                    <p>• <strong>NEWYEAR15</strong>: 15% off any service</p>
                  </div>}
              </CardContent>
            </Card>

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
                      <div className="flex justify-between border-t border-border/40 pt-1.5 md:pt-2 mt-1.5 md:mt-2">
                        <span className="text-muted-foreground">Estimated Time</span>
                        <span className="font-semibold text-primary">
                          {getEstimatedHours(bookingData.homeSizeId)} hrs @ ${HOURLY_RATE}/hr
                        </span>
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
                newCustomerDiscount={isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0} 
                membershipDiscount={bookingData.membershipPlan ? depositPricing.membershipDiscount : 0} 
                fullPaymentDiscount={bookingData.paymentOption === 'full' ? fullPaymentPricing.discount : 0} 
                promoDiscount={promoDiscount} 
                finalPrice={bookingData.paymentOption === 'deposit' ? depositPricing.total : fullPaymentPricing.finalAmount}
                isMembershipSignup={isNewMembershipSignup}
              />

              {/* Membership Subscription Card - NEW MEMBER SIGNUP */}
              {isNewMembershipSignup && (
                <Card className="border-primary bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Membership Subscription
                      </h3>
                      <Badge variant="default" className="text-sm">
                        {MEMBERSHIP_PLANS[bookingData.membershipPlan]?.name || 'Monthly'}
                      </Badge>
                    </div>
                    
                    <div className="bg-background/80 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-semibold">Monthly Price:</span>
                        <span className="text-2xl font-bold text-primary">
                          ${(MEMBERSHIP_PLANS[bookingData.membershipPlan]?.monthlyPrice || 189).toFixed(2)}/mo
                        </span>
                      </div>
                      <Separator />
                      <div className="flex items-center gap-2 text-success">
                        <Sparkles className="w-4 h-4" />
                        <span className="font-medium">First cleaning included with membership</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm">What's Included:</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li className="flex items-start gap-2">
                          <span className="text-success">✓</span>
                          <span>{MEMBERSHIP_PLANS[bookingData.membershipPlan]?.cleansPerMonth || 1} cleaning credit{(MEMBERSHIP_PLANS[bookingData.membershipPlan]?.cleansPerMonth || 1) > 1 ? 's' : ''} per month</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-success">✓</span>
                          <span>Priority booking & scheduling</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-success">✓</span>
                          <span>Flexible reschedule options</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-success">✓</span>
                          <span>Cancel anytime</span>
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Member Using Credit - SHOW $0 */}
              {isMemberUsingCredit && (
                <Card className="border-success bg-gradient-to-br from-success/10 to-success/5">
                  <CardContent className="p-6 text-center space-y-3">
                    <div className="w-16 h-16 mx-auto rounded-full bg-success/20 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 text-success" />
                    </div>
                    <h3 className="text-2xl font-bold">Using Membership Credit</h3>
                    <div className="text-4xl font-bold text-success">$0.00</div>
                    <p className="text-sm text-muted-foreground">
                      Your membership credit covers the standard cleaning service
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Regular Customer Payment Options */}
              {!isNewMembershipSignup && !isMemberUsingCredit && (
                <>
                  {/* Payment Comparison View */}
                  <div className="space-y-3">
                    <h3 className="text-lg md:text-xl font-semibold">Compare Payment Options</h3>
                    <PaymentComparison depositPricing={depositPricing} fullPaymentPricing={fullPaymentPricing} selectedOption={effectivePaymentOption} onSelect={handlePaymentOptionChange} />
                  </div>

              {/* Member Credit Info */}
              {bookingData.useCredit && !isNewMembershipSignup && <Card className="border-success/30 bg-success/5">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-2 text-success mb-3">
                      <Sparkles className="w-5 h-5" />
                      <h4 className="font-semibold">Using Membership Credit</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your membership credit covers the standard cleaning service. No deposit required!
                    </p>
                  </CardContent>
                </Card>}
              </>
              )}

              {/* Initialization Error */}
              {initError && !isProcessing && <Alert variant="destructive" className="animate-in slide-in-from-top">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Payment Setup Failed</AlertTitle>
                  <AlertDescription className="space-y-3">
                    <p>{initError}</p>
                    <Button variant="outline" size="sm" onClick={handleRetryPayment} className="mt-2">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Try Again
                    </Button>
                  </AlertDescription>
                </Alert>}

              {/* Stripe Payment Form */}
              {stripePromise && clientSecret && paymentAmount > 0 && !initError && !isNewMembershipSignup && <Card className="border-primary/20">
                  <CardContent className="p-6">
                    <h4 className="font-semibold mb-4 flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-primary" />
                      Payment Information
                    </h4>
                    <Elements stripe={stripePromise} options={{
                  clientSecret
                }}>
            <StripePaymentForm amount={paymentAmount} onSuccess={handlePaymentSuccess} onRetry={handleRetryPayment} customerEmail={bookingData.email} />
                    </Elements>
                  </CardContent>
                </Card>}

              {/* Membership Checkout Button */}
              {isNewMembershipSignup && !isProcessing && (
                <Button 
                  onClick={handleMembershipCheckout}
                  size="lg"
                  className="w-full h-14 text-lg"
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Subscribe & Book First Clean
                    </>
                  )}
                </Button>
              )}

              {/* Member Using Credit - Confirm Button */}
              {isMemberUsingCredit && !isProcessing && (
                <Button 
                  onClick={() => navigate("/book/success")}
                  size="lg"
                  className="w-full h-14 text-lg"
                >
                  Confirm Booking
                </Button>
              )}

              {/* Loading State */}
              {isProcessing && <Card className="border-primary/20">
                  <CardContent className="p-12">
                    <div className="flex flex-col items-center justify-center space-y-4">
                      <Loader2 className="w-12 h-12 animate-spin text-primary" />
                      <p className="text-muted-foreground">Setting up secure payment...</p>
                    </div>
                  </CardContent>
                </Card>}
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
              <Button variant="outline" size="lg" onClick={handleBack} disabled={isProcessing} className="h-14">
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
      <BottomNavigation currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} onBack={handleBack} showPrice={true} price={currentAmount} continueDisabled={true} />

      <BookingFooter />
    </div>
    </PageTransition>
  );
}