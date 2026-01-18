import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, Calendar, Clock, Sparkles, Loader2, CreditCard, 
  Zap, AlertCircle, RefreshCw, Gift, ChevronRight, Shield, 
  Check, Tag, Home, MapPin, Percent
} from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { calculatePrice, calculateFullPaymentWithDiscount, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS, getEstimatedHours, HOURLY_RATE } from "@/lib/pricing-system";
import { findBestPromoCode, formatPromoSavings, type EligiblePromo } from "@/lib/promo-auto-apply";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";

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
  const [promoCode, setPromoCode] = useState<string>('');
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [autoAppliedPromo, setAutoAppliedPromo] = useState<EligiblePromo | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const [showPromoInput, setShowPromoInput] = useState(false);
  const effectivePaymentOption = bookingData.paymentOption || 'deposit';

  useEffect(() => {
    if (!bookingData.paymentOption) {
      updateBookingData({ paymentOption: 'deposit' });
    }

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
        bookingData.homeSizeId,
        bookingData.serviceType,
        bookingData.addOns,
        bookingData.membershipPlan,
        bookingData.useCredit,
        isNew,
        0
      ).subtotal;

      const bestPromo = await findBestPromoCode(
        supabase,
        bookingData.email,
        isNew,
        subtotal
      );

      if (bestPromo) {
        setAutoAppliedPromo(bestPromo);
        setPromoCode(bestPromo.code);
        setPromoDiscount(bestPromo.discount);
        setPromoMessage(formatPromoSavings(bestPromo));
        updateBookingData({ promoCode: bestPromo.code });
      }
    } catch (error) {
      console.error('Error auto-applying promo:', error);
    } finally {
      setIsAutoApplying(false);
    }
  };

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  
  const depositPricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer,
    promoDiscount
  );

  const fullPaymentPricing = calculateFullPaymentWithDiscount(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit,
    isNewCustomer,
    promoDiscount
  );

  const handleValidatePromo = async () => {
    if (!promoCode.trim()) return;
    
    setIsValidatingPromo(true);
    setPromoMessage(null);
    setAutoAppliedPromo(null);
    
    try {
      const { data: promo, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', promoCode.toUpperCase())
        .eq('active', true)
        .single();

      if (error || !promo) {
        setPromoMessage('Invalid promo code');
        setPromoDiscount(0);
        toast.error('Invalid promo code');
        return;
      }

      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        setPromoMessage('This promo code has expired');
        setPromoDiscount(0);
        return;
      }

      if (promo.applies_to === 'new_customers' && !isNewCustomer) {
        setPromoMessage('This code is only for new customers');
        setPromoDiscount(0);
        return;
      }

      const subtotal = depositPricing.subtotal;
      let discount = 0;
      
      if (promo.type === 'percent') {
        discount = Math.round((subtotal * promo.value) / 100 * 100) / 100;
      } else {
        discount = promo.value;
      }

      setPromoDiscount(discount);
      setPromoMessage(`${promo.value}% off applied!`);
      updateBookingData({ promoCode: promoCode.toUpperCase() });
      toast.success(`You're saving $${discount}!`);
    } catch (err) {
      setPromoMessage('Error validating promo code');
      setPromoDiscount(0);
    } finally {
      setIsValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setPromoCode('');
    setPromoDiscount(0);
    setPromoMessage(null);
    setAutoAppliedPromo(null);
    updateBookingData({ promoCode: undefined });
  };

  const handleBack = () => {
    navigate("/book/offer");
  };

  const handlePaymentOptionChange = (value: 'deposit' | 'full') => {
    updateBookingData({ paymentOption: value });
    setClientSecret(null);
    setInitError(null);
  };

  const handleInitializePayment = async () => {
    setIsProcessing(true);
    setInitError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: bookingData,
      });

      if (error) throw new Error(error.message || "Failed to initialize payment");
      if (!data) throw new Error("No payment intent data received");

      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (error: any) {
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
    if (bookingId) {
      updateBookingData({ bookingId });
    }
    navigate("/book/additional-details?booking_id=" + bookingId);
  };

  useEffect(() => {
    if (!clientSecret && !isProcessing) {
      handleInitializePayment();
    }
  }, [bookingData.paymentOption]);

  const currentAmount = bookingData.paymentOption === 'full' 
    ? fullPaymentPricing.finalAmount 
    : depositPricing.deposit;

  const totalSavings = (isNewCustomer ? 60 : 0) + promoDiscount + 
    (bookingData.paymentOption === 'full' ? fullPaymentPricing.discount : 0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background pb-32 md:pb-8">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-5xl mx-auto px-4 py-6 md:py-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Checkout</h1>
          <p className="text-muted-foreground">Review your booking and complete payment</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Left Column - Order Summary */}
          <div className="lg:col-span-2 space-y-4">
            {/* Booking Summary Card */}
            <Card className="border-2 overflow-hidden">
              <div className="bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 px-5 py-4 border-b">
                <h2 className="font-bold text-lg">Booking Summary</h2>
              </div>
              <CardContent className="p-5 space-y-4">
                {/* Service */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#5500FF]/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-[#5500FF]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{serviceTier?.label || "Deep Clean"}</p>
                    <p className="text-sm text-muted-foreground">
                      {homeSize?.label} • {getEstimatedHours(bookingData.homeSizeId)} hours
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Schedule */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#5500FF]/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-[#5500FF]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">
                      {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "EEEE, MMM d, yyyy")}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      {bookingData.timeSlot || TIME_SLOT_LABELS[bookingData.timeSlot]}
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Location */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#5500FF]/10 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-[#5500FF]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">Service Location</p>
                    <p className="text-sm text-muted-foreground">ZIP: {bookingData.zipCode}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Savings Applied Card */}
            {totalSavings > 0 && (
              <Card className="border-2 border-green-200 bg-green-50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                        <Tag className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-green-800">Savings Applied</p>
                        <p className="text-xs text-green-600">
                          {isNewCustomer && "New customer discount"}
                          {promoDiscount > 0 && (isNewCustomer ? " + promo" : "Promo code")}
                        </p>
                      </div>
                    </div>
                    <span className="text-xl font-bold text-green-700">-${totalSavings.toFixed(0)}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Promo Code Section */}
            <Card className="border">
              <CardContent className="p-4">
                {!showPromoInput && !autoAppliedPromo ? (
                  <button 
                    onClick={() => setShowPromoInput(true)}
                    className="flex items-center gap-2 text-[#5500FF] font-medium text-sm hover:underline"
                  >
                    <Gift className="w-4 h-4" />
                    Have a promo code?
                  </button>
                ) : autoAppliedPromo ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-green-500" />
                      <span className="text-sm font-medium">{autoAppliedPromo.code}</span>
                      <Badge variant="secondary" className="text-xs">Auto-applied</Badge>
                    </div>
                    <button 
                      onClick={handleRemovePromo}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter code"
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      className="font-mono text-sm h-10"
                    />
                    <Button 
                      onClick={handleValidatePromo}
                      disabled={!promoCode || isValidatingPromo}
                      size="sm"
                      className="h-10 px-4"
                    >
                      {isValidatingPromo ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
                    </Button>
                  </div>
                )}
                {promoMessage && !autoAppliedPromo && (
                  <p className={cn(
                    "text-xs mt-2",
                    promoDiscount > 0 ? "text-green-600" : "text-red-500"
                  )}>
                    {promoMessage}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Payment */}
          <div className="lg:col-span-3 space-y-4">
            {/* Payment Option Selection */}
            <Card className="border-2 overflow-hidden">
              <div className="bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 px-5 py-4 border-b">
                <h2 className="font-bold text-lg">Payment Option</h2>
              </div>
              <CardContent className="p-5">
                <RadioGroup 
                  value={effectivePaymentOption} 
                  onValueChange={handlePaymentOptionChange}
                  className="space-y-3"
                >
                  {/* Deposit Option */}
                  <label className={cn(
                    "flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all",
                    effectivePaymentOption === 'deposit' 
                      ? "border-[#5500FF] bg-[#5500FF]/5" 
                      : "border-border hover:border-[#5500FF]/50"
                  )}>
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="deposit" id="deposit" />
                      <div>
                        <p className="font-semibold">Pay Deposit</p>
                        <p className="text-sm text-muted-foreground">
                          ${depositPricing.balanceDue.toFixed(0)} due after service
                        </p>
                      </div>
                    </div>
                    <span className="text-2xl font-bold text-[#5500FF]">
                      ${depositPricing.deposit.toFixed(0)}
                    </span>
                  </label>

                  {/* Full Payment Option */}
                  <label className={cn(
                    "relative flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all",
                    effectivePaymentOption === 'full' 
                      ? "border-[#5500FF] bg-[#5500FF]/5" 
                      : "border-border hover:border-[#5500FF]/50"
                  )}>
                    <Badge className="absolute -top-2 left-4 bg-green-500 text-white border-0">
                      Save 10%
                    </Badge>
                    <div className="flex items-center gap-3">
                      <RadioGroupItem value="full" id="full" />
                      <div>
                        <p className="font-semibold">Pay in Full</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="line-through">${fullPaymentPricing.originalTotal.toFixed(0)}</span>
                          {" "}• Save ${fullPaymentPricing.discount.toFixed(0)}
                        </p>
                      </div>
                    </div>
                    <span className="text-2xl font-bold text-[#5500FF]">
                      ${fullPaymentPricing.finalAmount.toFixed(0)}
                    </span>
                  </label>
                </RadioGroup>
              </CardContent>
            </Card>

            {/* Payment Form */}
            <Card className="border-2 overflow-hidden">
              <div className="bg-gradient-to-r from-[#5500FF]/10 to-[#8F7BFD]/10 px-5 py-4 border-b flex items-center justify-between">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Payment Details
                </h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Shield className="w-3.5 h-3.5" />
                  Secure
                </div>
              </div>
              <CardContent className="p-5">
                {/* Error State */}
                {initError && !isProcessing && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Payment Setup Failed</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{initError}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRetryPayment}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Try Again
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {/* Loading State */}
                {isProcessing && (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-10 h-10 animate-spin text-[#5500FF] mb-4" />
                    <p className="text-muted-foreground">Setting up secure payment...</p>
                  </div>
                )}

                {/* Stripe Form */}
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
              </CardContent>
            </Card>

            {/* Security Trust Badges */}
            <div className="flex items-center justify-center gap-6 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-500" />
                256-bit SSL
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-500" />
                PCI Compliant
              </div>
              <div className="flex items-center gap-1.5">
                <Check className="w-4 h-4 text-green-500" />
                Stripe Secure
              </div>
            </div>

            {/* Desktop Back Button */}
            <div className="hidden md:block">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={isProcessing}
                className="text-muted-foreground"
              >
                <ArrowLeft className="mr-2 w-4 h-4" />
                Back to Services
              </Button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          By completing payment, you agree to our Terms of Service and Privacy Policy
        </p>
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
