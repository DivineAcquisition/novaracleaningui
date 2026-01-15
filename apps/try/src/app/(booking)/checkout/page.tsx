"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useBooking } from "@/app/providers";
import { supabase } from "@/lib/supabase";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  CreditCard,
  Calendar,
  Clock,
  Tag,
  CheckCircle,
  Gift,
  Loader2,
  Shield,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function CheckoutForm() {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const { bookingData, updateBookingData } = useBooking();
  
  const [promoCode, setPromoCode] = useState(bookingData.promoCode || "NEWYEAR");
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [referralCode, setReferralCode] = useState(bookingData.referralCode || "");
  const [paymentOption, setPaymentOption] = useState<"deposit" | "full">("deposit");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState("");

  // Calculate pricing
  const basePrice = bookingData.offerType === "membership" ? 18900 : 19900;
  const depositAmount = Math.round(basePrice * 0.25);
  const finalAmount = paymentOption === "deposit" ? depositAmount : basePrice;
  const displayDiscount = promoApplied ? promoDiscount : 0;
  const totalToPay = finalAmount - displayDiscount;

  useEffect(() => {
    // Auto-apply NEWYEAR promo
    if (promoCode.toUpperCase() === "NEWYEAR" && !promoApplied) {
      applyPromo();
    }
  }, []);

  const applyPromo = async () => {
    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }

    try {
      const { data: promo, error } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", promoCode.toUpperCase())
        .eq("is_active", true)
        .single();

      if (error || !promo) {
        toast.error("Invalid promo code");
        return;
      }

      const discountAmount = promo.discount_type === "percentage"
        ? Math.round(basePrice * (promo.discount_amount / 100))
        : promo.discount_amount;

      setPromoDiscount(discountAmount);
      setPromoApplied(true);
      updateBookingData({ promoCode: promoCode.toUpperCase() });
      toast.success(`Promo applied! You save ${formatCurrency(discountAmount)}`);
    } catch (error) {
      console.error("Promo error:", error);
      toast.error("Failed to apply promo code");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      // Create payment intent
      const { data: intentData, error: intentError } = await supabase.functions.invoke(
        "create-payment-intent",
        {
          body: {
            amount: totalToPay,
            email: bookingData.email,
            firstName: bookingData.firstName,
            lastName: bookingData.lastName,
            phone: bookingData.phone,
            serviceType: bookingData.offerType,
            promoCode: promoApplied ? promoCode : null,
          },
        }
      );

      if (intentError || !intentData?.clientSecret) {
        throw new Error("Failed to create payment");
      }

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error("Card element not found");
      }

      const { error: paymentError, paymentIntent } = await stripe.confirmCardPayment(
        intentData.clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: `${bookingData.firstName} ${bookingData.lastName}`,
              email: bookingData.email,
              phone: bookingData.phone,
            },
          },
        }
      );

      if (paymentError) {
        throw new Error(paymentError.message);
      }

      if (paymentIntent.status === "succeeded") {
        // Create booking in database
        const { data: booking, error: bookingError } = await supabase
          .from("bookings")
          .insert({
            email: bookingData.email,
            first_name: bookingData.firstName,
            last_name: bookingData.lastName,
            phone: bookingData.phone,
            address: "TBD", // Will be collected in details
            city: "TBD",
            state: bookingData.zipCode?.startsWith("9") ? "CA" : "TX",
            zip_code: bookingData.zipCode,
            home_size_id: bookingData.sqftTier || "md",
            service_type: bookingData.serviceType || "Standard Clean",
            service_date: bookingData.serviceDate,
            time_slot: bookingData.timeSlot,
            base_price_cents: basePrice,
            deposit_cents: depositAmount,
            total_estimate_cents: basePrice - displayDiscount,
            payment_intent_id: paymentIntent.id,
            payment_option: bookingData.offerType,
            status: "confirmed",
          })
          .select()
          .single();

        if (bookingError) {
          console.error("Booking creation error:", bookingError);
        }

        // Create customer record
        const { error: customerError } = await supabase
          .from("customers")
          .upsert({
            email: bookingData.email,
            first_name: bookingData.firstName,
            last_name: bookingData.lastName,
            phone: bookingData.phone,
            zip: bookingData.zipCode,
          }, { onConflict: "email" });

        if (customerError) {
          console.error("Customer creation error:", customerError);
        }

        // Send confirmation email
        try {
          await supabase.functions.invoke("send-booking-email", {
            body: {
              bookingId: booking?.id,
              email: bookingData.email,
              type: "confirmation",
            },
          });
        } catch (emailError) {
          console.error("Email error:", emailError);
        }

        updateBookingData({ paymentOption });
        toast.success("Payment successful!");
        router.push("/details");
      }
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : "Payment failed");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <span>{bookingData.serviceDate ? formatDate(bookingData.serviceDate) : "No date selected"}</span>
                </div>
                <Badge variant="secondary">{bookingData.timeSlot}</Badge>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span>{bookingData.serviceType || "Cleaning Service"}</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span>Service Price</span>
                <span className="font-medium">{formatCurrency(basePrice)}</span>
              </div>
              {promoApplied && (
                <div className="flex items-center justify-between text-green-600">
                  <span className="flex items-center gap-2">
                    <Gift className="h-4 w-4" />
                    Promo Discount ({promoCode})
                  </span>
                  <span>-{formatCurrency(promoDiscount)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Promo Code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Tag className="h-5 w-5" />
                Promo Code
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter promo code"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  disabled={promoApplied}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant={promoApplied ? "secondary" : "outline"}
                  onClick={applyPromo}
                  disabled={promoApplied}
                >
                  {promoApplied ? (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Applied
                    </>
                  ) : (
                    "Apply"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Payment Options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Payment Option</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Button
                  type="button"
                  variant={paymentOption === "deposit" ? "default" : "outline"}
                  className="h-auto py-4 flex-col"
                  onClick={() => setPaymentOption("deposit")}
                >
                  <span className="font-medium">25% Deposit</span>
                  <span className="text-2xl font-bold mt-1">
                    {formatCurrency(depositAmount - (promoApplied ? Math.round(promoDiscount * 0.25) : 0))}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    Pay rest day of service
                  </span>
                </Button>
                <Button
                  type="button"
                  variant={paymentOption === "full" ? "default" : "outline"}
                  className="h-auto py-4 flex-col"
                  onClick={() => setPaymentOption("full")}
                >
                  <span className="font-medium">Pay in Full</span>
                  <span className="text-2xl font-bold mt-1">
                    {formatCurrency(basePrice - displayDiscount)}
                  </span>
                  <span className="text-xs text-green-600 mt-1">
                    Save 5% extra!
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Card Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Card Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 border rounded-lg">
                <CardElement
                  options={{
                    style: {
                      base: {
                        fontSize: "16px",
                        color: "#424770",
                        "::placeholder": {
                          color: "#aab7c4",
                        },
                      },
                      invalid: {
                        color: "#9e2146",
                      },
                    },
                  }}
                />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span>Your payment is secured with 256-bit SSL encryption</span>
              </div>
            </CardContent>
          </Card>

          {/* Referral Code */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Have a Referral Code?</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                placeholder="Enter referral code (optional)"
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase());
                  updateBookingData({ referralCode: e.target.value.toUpperCase() });
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Order Total Sidebar */}
        <div className="lg:col-span-1">
          <Card className="sticky top-24">
            <CardHeader>
              <CardTitle>Order Total</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatCurrency(basePrice)}</span>
                </div>
                {promoApplied && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Promo Discount</span>
                    <span>-{formatCurrency(promoDiscount)}</span>
                  </div>
                )}
                {paymentOption === "full" && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Pay in Full Discount (5%)</span>
                    <span>-{formatCurrency(Math.round((basePrice - displayDiscount) * 0.05))}</span>
                  </div>
                )}
              </div>
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Due Now</span>
                <span>
                  {formatCurrency(
                    paymentOption === "deposit"
                      ? Math.round(depositAmount - displayDiscount * 0.25)
                      : Math.round((basePrice - displayDiscount) * 0.95)
                  )}
                </span>
              </div>
              {paymentOption === "deposit" && (
                <p className="text-sm text-muted-foreground">
                  Remaining {formatCurrency(Math.round((basePrice - displayDiscount) * 0.75))} due day of service
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={!stripe || isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Lock className="h-4 w-4 mr-2" />
                    Complete Booking
                  </>
                )}
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3 w-3" />
                <span>100% Satisfaction Guaranteed</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

export default function CheckoutPage() {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-bold">
          Complete Your Booking
        </h1>
        <p className="text-lg text-muted-foreground">
          Secure your appointment with a deposit or full payment
        </p>
      </div>

      <Elements stripe={stripePromise}>
        <CheckoutForm />
      </Elements>
    </div>
  );
}
