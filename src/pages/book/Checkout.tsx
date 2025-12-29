import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Sparkles, Loader2, CreditCard, AlertCircle, RefreshCw, Gift, Calendar, Clock, MapPin, Shield, Tag, PartyPopper, Crown, TrendingUp, ChevronDown } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { PaymentComparison } from "@/components/booking/PaymentComparison";
import { SavingsVisualizer } from "@/components/booking/SavingsVisualizer";
import { Skeleton } from "@/components/ui/skeleton";
import { calculatePrice, calculateFullPaymentWithDiscount, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, getEstimatedHours, NEW_CUSTOMER_DISCOUNT } from "@/lib/pricing-system";
import { findBestPromoCode, formatPromoSavings, getPromoRecommendation, type EligiblePromo } from "@/lib/promo-auto-apply";
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
  
  // Referral Code state
  const [referralInput, setReferralInput] = useState('');
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [appliedReferralCode, setAppliedReferralCode] = useState<string | null>(null);
  const [referralDiscount, setReferralDiscount] = useState(0);
  
  // Promo Code state
  const [promoInput, setPromoInput] = useState('');
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [autoAppliedPromo, setAutoAppliedPromo] = useState<EligiblePromo | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const [showPromoSuggestions, setShowPromoSuggestions] = useState(false);
  const [discountSectionOpen, setDiscountSectionOpen] = useState(false);

  const isScheduleSelected = !!bookingData.serviceDate && !!bookingData.timeSlot;

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
        toast.success(`🎉 ${bestPromo.description} auto-applied! Saving $${bestPromo.discount.toFixed(2)}`);
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
    bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount + referralDiscount
  );
  
  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns,
    bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount + referralDiscount
  );

  // Handle Referral Code
  const handleApplyReferral = async () => {
    if (!referralInput.trim()) return;
    setIsValidatingReferral(true);

    try {
      const { data: referral, error } = await supabase
        .from('referrals')
        .select('*')
        .eq('code', referralInput.toUpperCase())
        .eq('status', 'pending')
        .single();

      if (error || !referral) {
        toast.error('Invalid or already used referral code');
        return;
      }

      const discount = (referral.credit_cents || 2000) / 100;
      setReferralDiscount(discount);
      setAppliedReferralCode(referralInput.toUpperCase());
      updateBookingData({ referralCode: referralInput.toUpperCase() });
      toast.success(`Referral applied! $${discount.toFixed(2)} off`);
    } catch (err) {
      toast.error('Error validating referral code');
    } finally {
      setIsValidatingReferral(false);
    }
  };

  const handleRemoveReferral = () => {
    setReferralInput('');
    setReferralDiscount(0);
    setAppliedReferralCode(null);
    updateBookingData({ referralCode: undefined });
    toast.info('Referral code removed');
  };

  // Handle Promo Code
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
      toast.success(`🎉 Promo applied! Saving $${discount.toFixed(2)}`);
      setShowPromoSuggestions(false);
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

  const handlePaymentOptionChange = (option: 'deposit' | 'full') => {
    updateBookingData({ paymentOption: option });
    setClientSecret(null);
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
    if (isProcessing) return; // Prevent duplicate calls
    
    setIsProcessing(true);
    setInitError(null);
    
    try {
      console.log('[Checkout] Initializing payment intent...');
      
      // Primary: Use supabase.functions.invoke
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: bookingData
      });
      
      if (error) {
        console.error('[Checkout] Supabase invoke error:', error);
        
        // Fallback: Direct fetch with proper headers
        console.log('[Checkout] Attempting direct fetch fallback...');
        const response = await fetch('https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-payment-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
          },
          body: JSON.stringify(bookingData)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Checkout] Fallback fetch failed:', response.status, errorText);
          throw new Error(`Payment initialization failed: ${response.status}`);
        }
        
        const fallbackData = await response.json();
        console.log('[Checkout] Fallback successful:', fallbackData);
        setClientSecret(fallbackData.clientSecret);
        setPaymentAmount(fallbackData.amount);
        setBookingId(fallbackData.bookingId);
        return;
      }
      
      if (!data?.clientSecret) {
        throw new Error("No payment intent data received");
      }

      console.log('[Checkout] Payment intent created:', data);
      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (error: any) {
      console.error('[Checkout] Payment init error:', error);
      setInitError(error.message || "Payment service unavailable. Please try again.");
      toast.error("Payment setup failed. Please try again.");
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

  // Initialize payment when all required fields are present
  useEffect(() => {
    // Gate payment initialization until we have required data
    const hasRequiredData = bookingData.email && bookingData.homeSizeId && bookingData.serviceDate && bookingData.timeSlot;
    
    if (!hasRequiredData) {
      console.log('[Checkout] Waiting for required data before initializing payment');
      return;
    }
    
    const timer = setTimeout(() => {
      if (!clientSecret && !isProcessing && !initError) {
        handleInitializePayment();
      }
    }, 100);
    
    return () => clearTimeout(timer);
  }, [bookingData.paymentOption, bookingData.email, bookingData.serviceDate, bookingData.timeSlot]);

  const currentAmount = effectivePaymentOption === 'full' 
    ? fullPaymentPricing.finalAmount 
    : depositPricing.deposit;

  const totalSavings = (isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0) + 
    (depositPricing.membershipDiscount || 0) + 
    (effectivePaymentOption === 'full' ? fullPaymentPricing.discount : 0) + 
    promoDiscount + referralDiscount;

  const addOnLabels = bookingData.addOns?.map(id => ADD_ONS[id as keyof typeof ADD_ONS]?.label).filter(Boolean) || [];

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8" {...swipeHandlers}>
        <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
        
        <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
          
          {/* Holiday Promotion Banner */}
          {promoDiscount > 0 && appliedPromoCode && (
            <div className="relative overflow-hidden bg-gradient-to-r from-red-500 via-green-600 to-red-500 rounded-xl p-4 text-white shadow-lg">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjEpIi8+PC9zdmc+')] opacity-30"></div>
              <div className="relative flex items-center justify-center gap-3">
                <PartyPopper className="w-6 h-6 animate-bounce" />
                <div className="text-center">
                  <p className="font-bold text-lg">🎄 Holiday Savings Applied!</p>
                  <p className="text-sm opacity-90">
                    {appliedPromoCode} • Saving ${promoDiscount.toFixed(2)}
                    {autoAppliedPromo && " (Auto-applied)"}
                  </p>
                </div>
                <PartyPopper className="w-6 h-6 animate-bounce" />
              </div>
            </div>
          )}


          {/* Membership Upsell Banner - Show when no membership selected */}
          {bookingData.membershipPlan === 'none' && !isMemberUsingCredit && (
            <Card className="border-amber-300 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-50 dark:from-amber-950/30 dark:via-yellow-950/20 dark:to-amber-950/30 overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg">
                      <Crown className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-bold text-amber-900 dark:text-amber-100">Become a Member & Save More!</h4>
                      <Badge className="bg-amber-500 text-white text-[10px]">Popular</Badge>
                    </div>
                    <p className="text-sm text-amber-800 dark:text-amber-200 mb-3">
                      Join thousands of happy members saving up to <span className="font-bold">30% on every clean</span>
                    </p>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="bg-white/60 dark:bg-black/20 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">$189</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">Essential</p>
                        <p className="text-[10px] text-muted-foreground">1 clean/mo</p>
                      </div>
                      <div className="bg-white/80 dark:bg-black/30 rounded-lg p-2 text-center border-2 border-amber-400 relative">
                        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                          <Badge className="bg-primary text-[8px] px-1.5 py-0">Best Value</Badge>
                        </div>
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">$289</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">Standard</p>
                        <p className="text-[10px] text-muted-foreground">2 cleans/mo</p>
                      </div>
                      <div className="bg-white/60 dark:bg-black/20 rounded-lg p-2 text-center">
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">$389</p>
                        <p className="text-[10px] text-amber-600 dark:text-amber-400">Premium</p>
                        <p className="text-[10px] text-muted-foreground">4 cleans/mo</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 mb-3">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>Members save an average of <strong>$45/month</strong></span>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => navigate('/book/offer')}
                      className="w-full border-amber-400 text-amber-700 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-300 dark:hover:bg-amber-950/50"
                    >
                      <Crown className="w-4 h-4 mr-2" />
                      View Membership Plans
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-primary rounded-full mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl md:text-3xl font-bold">Secure Checkout</h1>
            <p className="text-muted-foreground mt-1">Review your order and complete payment</p>
          </div>

          {/* Order Summary Grid */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Service Details Card */}
            <Card className="border-primary/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Service Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service Type</span>
                  <span className="font-medium">{serviceTier?.label || 'Standard'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Home Size</span>
                  <span className="font-medium">{homeSize?.label || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Duration</span>
                  <span className="font-medium">{getEstimatedHours(bookingData.homeSizeId)} hours</span>
                </div>
                {addOnLabels.length > 0 && (
                  <div className="pt-2 border-t">
                    <span className="text-muted-foreground text-xs">Add-ons:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {addOnLabels.map((label, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{label}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {membership && bookingData.membershipPlan !== 'none' && (
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Membership</span>
                      <Badge className="bg-primary/10 text-primary text-xs">{membership.label}</Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Schedule Summary Card */}
            <Card className="border-primary/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {bookingData.serviceDate && bookingData.timeSlot ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5" />
                        Date
                      </span>
                      <span className="font-medium">
                        {format(new Date(bookingData.serviceDate + 'T12:00:00'), "EEEE, MMM d, yyyy")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        Time
                      </span>
                      <span className="font-medium">
                        {bookingData.timeSlot}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5" />
                        Location
                      </span>
                      <span className="font-medium">ZIP {bookingData.zipCode}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-muted-foreground">No schedule selected</p>
                    <Button variant="outline" size="sm" onClick={() => navigate('/book/offer')}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Go Back to Select Date & Time
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Gate: Show skeleton/message if schedule not selected */}
          {!isScheduleSelected && (
            <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardContent className="py-8 text-center space-y-4">
                <Calendar className="w-12 h-12 text-amber-500 mx-auto" />
                <div>
                  <h3 className="font-semibold text-lg">Schedule Required</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    Please select a date and time for your cleaning before proceeding to payment.
                  </p>
                </div>
                <Button onClick={() => navigate('/book/offer')} className="bg-gradient-primary">
                  <Calendar className="w-4 h-4 mr-2" />
                  Select Your Appointment
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Show payment sections only when schedule is selected */}
          {isScheduleSelected && (
            <>
              {/* Savings Visualizer */}
              <SavingsVisualizer
                originalPrice={depositPricing.subtotal + (isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0)}
                newCustomerDiscount={isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0}
                membershipDiscount={depositPricing.membershipDiscount || 0}
                fullPaymentDiscount={effectivePaymentOption === 'full' ? fullPaymentPricing.discount : 0}
                promoDiscount={promoDiscount + referralDiscount}
                finalPrice={currentAmount}
                isMembershipSignup={isNewMembershipSignup}
              />
          <div className="space-y-3">
            <h3 className="font-semibold text-lg">Choose Payment Option</h3>
            <PaymentComparison
              depositPricing={{
                deposit: depositPricing.deposit,
                balanceDue: depositPricing.balanceDue,
                subtotal: depositPricing.subtotal,
                newCustomerDiscount: isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0,
                membershipDiscount: depositPricing.membershipDiscount || 0,
              }}
              fullPaymentPricing={{
                originalTotal: fullPaymentPricing.originalTotal,
                finalAmount: fullPaymentPricing.finalAmount,
                discount: fullPaymentPricing.discount,
                savings: fullPaymentPricing.savings,
                newCustomerDiscount: isNewCustomer ? NEW_CUSTOMER_DISCOUNT : 0,
              }}
              selectedOption={effectivePaymentOption}
              onSelect={handlePaymentOptionChange}
            />
          </div>

          {/* Discount Codes Section - Collapsible */}
          <Collapsible open={discountSectionOpen} onOpenChange={setDiscountSectionOpen}>
            <Card className="border-primary/10">
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Tag className="w-4 h-4 text-primary" />
                      Have a Promo or Referral Code?
                      {(appliedPromoCode || appliedReferralCode) && (
                        <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                          Applied
                        </Badge>
                      )}
                    </CardTitle>
                    <ChevronDown className={cn(
                      "w-4 h-4 text-muted-foreground transition-transform",
                      discountSectionOpen && "rotate-180"
                    )} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 pt-0">
                  {/* Referral Code */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Gift className="w-4 h-4 text-primary" />
                      Referral Code
                    </p>
                    {appliedReferralCode ? (
                      <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Gift className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-green-700 dark:text-green-400">{appliedReferralCode}</span>
                          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">
                            -${referralDiscount.toFixed(2)}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemoveReferral}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter referral code"
                          value={referralInput}
                          onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
                          className="font-mono"
                          maxLength={10}
                        />
                        <Button 
                          onClick={handleApplyReferral} 
                          disabled={!referralInput || isValidatingReferral}
                          variant="outline"
                        >
                          {isValidatingReferral ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                        </Button>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Promo Code */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Promo Code
                    </p>
                    {appliedPromoCode ? (
                      <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-green-700 dark:text-green-400">{appliedPromoCode}</span>
                          {autoAppliedPromo && (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 text-xs">Auto-applied</Badge>
                          )}
                          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">
                            -${promoDiscount.toFixed(2)}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemovePromo}>
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter promo code"
                            value={promoInput}
                            onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                            className="font-mono"
                            maxLength={15}
                          />
                          <Button 
                            onClick={handleApplyPromo} 
                            disabled={!promoInput || isValidatingPromo}
                            variant="outline"
                          >
                            {isValidatingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                          </Button>
                        </div>
                        
                        {isAutoApplying && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Finding best available promo...
                          </div>
                        )}
                        
                        <button
                          type="button"
                          onClick={() => setShowPromoSuggestions(!showPromoSuggestions)}
                          className="text-sm text-primary hover:underline"
                        >
                          {showPromoSuggestions ? 'Hide suggestions' : 'See available promos'}
                        </button>
                        
                        {showPromoSuggestions && (
                          <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                            <p className="text-muted-foreground">Try these codes:</p>
                            <div className="flex flex-wrap gap-2">
                              {['HOLIDAY25', 'NEWYEAR15'].map(code => (
                                <Badge 
                                  key={code}
                                  variant="outline" 
                                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                                  onClick={() => {
                                    setPromoInput(code);
                                    setShowPromoSuggestions(false);
                                  }}
                                >
                                  {code}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Payment Section */}
          <Card className="border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Payment Details
              </CardTitle>
              <CardDescription>
                {effectivePaymentOption === 'deposit' 
                  ? `Pay $${currentAmount.toFixed(2)} deposit now • $${depositPricing.balanceDue.toFixed(2)} after service`
                  : `Pay $${currentAmount.toFixed(2)} now • No balance due`
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              
              {/* Membership Signup Flow */}
              {isNewMembershipSignup && (
                <div className="space-y-4">
                  <div className="bg-primary/5 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Membership: {membership?.label}</span>
                      <Badge className="bg-primary text-white">${membership?.monthlyPrice}/mo</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {membership?.cleansPerMonth} cleaning credit/month • {membership?.discount}% off extras • Cancel anytime
                    </p>
                  </div>
                  
                  <Button 
                    onClick={handleMembershipCheckout}
                    size="lg"
                    className="w-full bg-gradient-primary hover:opacity-90"
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Processing...</>
                    ) : (
                      <>Subscribe & Book First Clean</>
                    )}
                  </Button>
                </div>
              )}

              {/* Member Using Credit */}
              {isMemberUsingCredit && (
                <div className="text-center space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                    <Sparkles className="w-10 h-10 text-green-600 mx-auto mb-3" />
                    <p className="text-3xl font-bold text-green-700">$0.00</p>
                    <p className="text-green-600 mt-1">Covered by your membership credit!</p>
                  </div>
                  <Button 
                    onClick={() => navigate("/book/success")}
                    size="lg"
                    className="w-full bg-gradient-primary hover:opacity-90"
                  >
                    Confirm Booking
                  </Button>
                </div>
              )}

              {/* Regular Stripe Payment */}
              {!isNewMembershipSignup && !isMemberUsingCredit && (
                <>
                  {/* Error State */}
                  {initError && !isProcessing && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
                      <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                      <p className="text-sm text-destructive font-medium mb-3">{initError}</p>
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

              {/* Trust Badges */}
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                <span className="flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" />
                  Secure
                </span>
                <span>•</span>
                <span>256-bit Encryption</span>
                <span>•</span>
                <span>PCI Compliant</span>
              </div>
            </CardContent>
          </Card>
            </>
          )}

          {/* Desktop Back Button */}
          <div className="hidden md:block">
            <Button variant="outline" onClick={handleBack} disabled={isProcessing}>
              <ArrowLeft className="mr-2 w-4 h-4" />
              Back to Service Selection
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            By completing payment, you agree to our Terms of Service and Privacy Policy
          </p>
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
