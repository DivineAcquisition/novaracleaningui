import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
import { toast } from "sonner";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  MapPin,
  Clock,
  CheckCircle2,
  Shield,
  RefreshCw,
  Lock,
  BadgeCheck,
  Loader2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";
import { GoogleGuaranteedBadge } from "@/components/booking/GoogleGuaranteedBadge";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { BookingFooter } from "@/components/booking/BookingFooter";

// Test mode flag - set to true for development
const IS_TEST_MODE = false;

// Service details configuration
const SERVICE_DETAILS = {
  standard: {
    duration: "3-4 hours",
    features: ["Full deep cleaning", "All rooms included", "Eco-friendly products", "Satisfaction guaranteed"],
    checklist: [
      "Dust all surfaces and furniture",
      "Vacuum carpets and rugs",
      "Mop hard floors",
      "Clean and sanitize bathrooms",
      "Kitchen counters and appliances",
      "Empty trash bins",
      "Make beds and tidy rooms",
    ],
  },
  tester: {
    duration: "90 minutes",
    features: ["Focus on high-priority areas", "Quick refresh", "Same quality products", "Perfect for try-out"],
    checklist: [
      "Kitchen counters and sink",
      "Bathroom sanitization",
      "Vacuum main living areas",
      "Quick dust and tidy",
    ],
  },
  deep: {
    duration: "3-4 hours",
    features: ["Top-to-bottom cleaning", "Inside appliances", "Baseboards & details", "Perfect for first cleans"],
    checklist: [
      "Everything in standard PLUS:",
      "Inside cabinets and drawers",
      "Detailed baseboard cleaning",
      "Window sills and tracks",
      "Behind and under furniture",
      "Ceiling fans and fixtures",
      "Deep scrub bathrooms",
    ],
  },
  "90day": {
    duration: "3-4 hours per visit",
    features: ["3 sessions over 90 days", "Progressive deep cleaning", "Build lasting cleanliness", "Best value"],
    checklist: [
      "Session 1: Deep kitchen + bathrooms",
      "Session 2: Bedrooms + living areas",
      "Session 3: Full home refresh",
      "Rotating focus areas each visit",
    ],
  },
};

export default function BookingCheckout() {
  const navigate = useNavigate();
  const { bookingData, updateBookingData } = useBooking();

  // State
  const [stripePromise, setStripePromise] = useState<any>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isNewCustomer, setIsNewCustomer] = useState(true);

  // Redirect guard
  useEffect(() => {
    if (!bookingData.zipCode) {
      toast.error("Please start from the beginning");
      navigate("/book/zip");
    }
  }, [bookingData.zipCode, navigate]);

  // Get home size and service info
  const homeSize = HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const serviceDetails = SERVICE_DETAILS[bookingData.serviceType as keyof typeof SERVICE_DETAILS] || SERVICE_DETAILS.standard;

  // Price calculations
  const basePrice = homeSize ? homeSize.standardPrice + (serviceTier?.addition || 0) : 200;
  const promoDiscount = 50; // New Year Special $50 off
  const finalPrice = Math.max(0, basePrice - promoDiscount);

  // Deposit calculations
  const depositPercentage = bookingData.serviceType === "90day" ? 0.0625 : 0.25;
  const depositAmount = Math.round(finalPrice * depositPercentage * 100) / 100;
  const balanceDue = finalPrice - depositAmount;

  // 90-day plan specific
  const monthlyPayment = finalPrice * 0.25;
  const totalMonthlyPayments = monthlyPayment * 3;
  const firstCleanBalance = finalPrice - depositAmount - totalMonthlyPayments;

  // Initialize Stripe
  useEffect(() => {
    const init = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-stripe-publishable-key");
        if (error || !data?.key) throw new Error("Failed to load payment system");
        setStripePromise(loadStripe(data.key));
      } catch (err) {
        console.error("[Checkout] Stripe init error:", err);
        setInitError("Unable to load payment system. Please try again.");
      }
    };
    init();
  }, []);

  // Check if new customer
  useEffect(() => {
    const checkCustomer = async () => {
      if (!bookingData.email) return;
      const { data } = await supabase
        .from("bookings")
        .select("id")
        .eq("email", bookingData.email)
        .in("status", ["confirmed", "completed"])
        .limit(1);
      setIsNewCustomer(!data || data.length === 0);
    };
    checkCustomer();
  }, [bookingData.email]);

  // Initialize payment
  const handleInitializePayment = async () => {
    setIsProcessing(true);
    setInitError(null);

    try {
      const { data, error } = await supabase.functions.invoke("create-payment-intent", {
        body: { ...bookingData, amount: Math.round(depositAmount * 100) },
      });

      if (error) throw new Error(error.message || "Payment initialization failed");
      if (!data?.clientSecret) throw new Error("No payment data received");

      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
    } catch (err: any) {
      console.error("[Checkout] Payment init error:", err);
      setInitError(err.message || "Failed to initialize payment");
      toast.error("Payment initialization failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Auto-initialize payment
  useEffect(() => {
    if (stripePromise && !clientSecret && !isProcessing && !IS_TEST_MODE) {
      handleInitializePayment();
    }
  }, [stripePromise]);

  // Test mode payment handler
  const handleTestPayment = async () => {
    setIsProcessing(true);
    try {
      // Create customer
      const { data: customer } = await supabase
        .from("customers")
        .upsert({
          email: bookingData.email,
          first_name: bookingData.firstName,
          last_name: bookingData.lastName,
          phone: bookingData.phone,
          zip: bookingData.zipCode,
          city: bookingData.city,
          state: bookingData.state,
        }, { onConflict: "email" })
        .select()
        .single();

      // Create booking
      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          email: bookingData.email,
          first_name: bookingData.firstName,
          last_name: bookingData.lastName,
          phone: bookingData.phone,
          zip_code: bookingData.zipCode,
          city: bookingData.city || "Unknown",
          state: bookingData.state || "CA",
          address: bookingData.address || "TBD",
          home_size_id: bookingData.homeSizeId,
          service_type: bookingData.serviceType,
          service_date: bookingData.serviceDate,
          time_slot: bookingData.timeSlot,
          base_price_cents: Math.round(basePrice * 100),
          deposit_cents: Math.round(depositAmount * 100),
          total_estimate_cents: Math.round(finalPrice * 100),
          status: "confirmed",
          payment_intent_id: `test_${Date.now()}`,
          customer_id: customer?.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Test payment successful!");
      updateBookingData({ bookingId: booking.id });
      navigate(`/book/details?booking_id=${booking.id}`);
    } catch (err: any) {
      console.error("[Checkout] Test payment error:", err);
      toast.error("Test payment failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentSuccess = () => {
    toast.success("Payment successful!");
    if (bookingId) {
      updateBookingData({ bookingId });
      navigate(`/book/details?booking_id=${bookingId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
      <BookingProgressBar currentStep={4} totalSteps={6} />

      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* New Year Special Banner */}
        <Card className="border-2 overflow-hidden" style={{ borderColor: "hsl(45, 93%, 47%)", backgroundColor: "hsl(220, 50%, 15%)" }}>
          <CardContent className="p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-yellow-400 mb-1">
              <Sparkles className="h-5 w-5" />
              <span className="font-bold text-lg">New Year Special</span>
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="text-white text-sm">
              $50 off your first deep clean – Discount automatically applied!
            </p>
          </CardContent>
        </Card>

        {/* Header */}
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold text-foreground">
            Your New Year Discount is Applied!
          </h1>
          <p className="text-muted-foreground">Review your order and complete booking</p>
          <div className="flex justify-center">
            <GoogleGuaranteedBadge />
          </div>
        </div>

        {/* Booking Summary Card */}
        <Card className="border-2 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Booking Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Service Name */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Service</span>
              <span className="font-semibold">{serviceTier?.label || "Deep Clean"}</span>
            </div>

            {/* Location */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                Location
              </span>
              <span className="font-medium">
                {bookingData.city}, {bookingData.state} {bookingData.zipCode}
              </span>
            </div>

            {/* Original Price */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Original Price</span>
              <span className="text-muted-foreground line-through">${basePrice.toFixed(2)}</span>
            </div>

            {/* Promo Discount */}
            <div className="flex justify-between items-center p-2 -mx-2 rounded-lg" style={{ backgroundColor: "hsl(45, 93%, 47%, 0.1)", borderColor: "hsl(45, 93%, 47%)", borderWidth: 1 }}>
              <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">
                NEWYEAR2025
              </Badge>
              <span className="font-semibold text-green-600">-${promoDiscount.toFixed(2)}</span>
            </div>

            {/* Total */}
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="font-semibold text-lg">Total</span>
              <span className="font-bold text-2xl text-primary">${finalPrice.toFixed(2)}</span>
            </div>

            {/* Payment Breakdown */}
            <div className="bg-primary/10 rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Today's Deposit (25%)</span>
                <span className="font-bold text-lg">${depositAmount.toFixed(2)}</span>
              </div>
              {bookingData.serviceType === "90day" ? (
                <>
                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>Monthly payments (3x)</span>
                    <span>${monthlyPayment.toFixed(2)}/mo</span>
                  </div>
                  <div className="flex justify-between items-center text-sm text-muted-foreground">
                    <span>Balance after first clean</span>
                    <span>${firstCleanBalance.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>Balance due after service</span>
                  <span>${balanceDue.toFixed(2)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* What's Included Card */}
        <Card className="border-2 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">What's Included</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Duration */}
            <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg">
              <Clock className="h-5 w-5 text-primary" />
              <div>
                <p className="font-semibold">Service Duration</p>
                <p className="text-sm text-muted-foreground">{serviceDetails.duration}</p>
              </div>
            </div>

            {/* Premium Features */}
            <div className="space-y-2">
              <p className="font-medium text-sm text-muted-foreground">Premium Features</p>
              <div className="grid grid-cols-2 gap-2">
                {serviceDetails.features.map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2">
              <p className="font-medium text-sm text-muted-foreground">Cleaning Checklist</p>
              <ul className="space-y-1.5">
                {serviceDetails.checklist.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Payment Information Card */}
        <Card className="border-2 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Payment Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {IS_TEST_MODE ? (
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertDescription className="flex items-center gap-2">
                  🧪 <span className="font-semibold">TEST MODE</span> - No real charges
                </AlertDescription>
              </Alert>
            ) : initError ? (
              <div className="space-y-3">
                <Alert variant="destructive">
                  <AlertDescription>{initError}</AlertDescription>
                </Alert>
                <Button onClick={handleInitializePayment} variant="outline" className="w-full gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : !stripePromise || !clientSecret ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <StripePaymentForm
                  amount={paymentAmount}
                  onSuccess={handlePaymentSuccess}
                  onRetry={handleInitializePayment}
                  customerEmail={bookingData.email}
                />
              </Elements>
            )}

            {/* Security Message */}
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" />
              <span>256-bit SSL encrypted • Secure payment</span>
            </div>

            {/* Test Mode Button */}
            {IS_TEST_MODE && (
              <Button
                onClick={handleTestPayment}
                disabled={isProcessing}
                className="w-full h-14 text-lg"
                size="lg"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  `Pay $${depositAmount.toFixed(2)} Deposit`
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Trust Badges Card */}
        <Card className="border border-border">
          <CardContent className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Shield className="h-5 w-5 text-primary" />
                <span>Secure Payment</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <RefreshCw className="h-5 w-5 text-primary" />
                <span>48-Hr Re-Clean</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Lock className="h-5 w-5 text-primary" />
                <span>No Contracts</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <BadgeCheck className="h-5 w-5 text-primary" />
                <span>Insured & Bonded</span>
              </div>
            </div>
            <div className="flex justify-center mt-4 pt-4 border-t">
              <GoogleGuaranteedBadge />
            </div>
          </CardContent>
        </Card>
      </div>

      <BookingFooter />
    </div>
  );
}
