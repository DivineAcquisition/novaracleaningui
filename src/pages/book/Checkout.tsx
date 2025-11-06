import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Calendar, Clock, Home, Sparkles, Loader2, CreditCard } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { calculatePrice, HOME_SIZE_RANGES, FREQUENCY_DISCOUNTS } from "@/lib/pricing-system";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const BOOKING_STEPS = [
  { number: 1, label: "Location" },
  { number: 2, label: "Home Size" },
  { number: 3, label: "Service" },
  { number: 4, label: "Schedule" },
  { number: 5, label: "Details" },
  { number: 6, label: "Payment" },
];

const SERVICE_NAMES = {
  regular: "Standard Cleaning",
  deep: "Deep Cleaning",
  move_in_out: "Move In/Out Cleaning",
};

const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM",
};

export default function BookingCheckout() {
  const navigate = useNavigate();
  const { bookingData, currentStep } = useBooking();
  const [isProcessing, setIsProcessing] = useState(false);

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const frequencyData = FREQUENCY_DISCOUNTS[bookingData.frequency as keyof typeof FREQUENCY_DISCOUNTS];
  const price = calculatePrice(bookingData.homeSizeId, bookingData.serviceType, bookingData.frequency);

  const handleBack = () => {
    navigate("/book/summary");
  };

  const handlePayment = async () => {
    setIsProcessing(true);
    
    try {
      console.log("Creating checkout session with booking data:", bookingData);
      
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { bookingData },
      });

      if (error) {
        console.error("Checkout error:", error);
        throw error;
      }

      if (!data?.url) {
        throw new Error("No checkout URL received");
      }

      console.log("Checkout session created, redirecting to:", data.url);
      
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (error: any) {
      console.error("Payment error:", error);
      toast.error(error.message || "Failed to process payment. Please try again.");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <ProgressBar currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} />
      
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <Card className="shadow-xl border-primary/20">
          <CardHeader className="text-center space-y-2 pb-8">
              <div className="mx-auto w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mb-4 shadow-lavender">
                <CreditCard className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-3xl font-bold">Secure Checkout</CardTitle>
            <CardDescription className="text-base">
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
                        <span className="text-muted-foreground">Service Type</span>
                        <span className="font-medium">{SERVICE_NAMES[bookingData.serviceType as keyof typeof SERVICE_NAMES]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Home Size</span>
                        <span className="font-medium">{homeSize?.label}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Frequency</span>
                        <span className="font-medium">{frequencyData?.label}</span>
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

              {/* Pricing Breakdown */}
              <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
                <CardContent className="p-6 space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Payment Details
                  </h4>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Base Price</span>
                      <span className="font-medium">
                        ${Math.round(price / (1 - (frequencyData?.discount || 0)))}
                      </span>
                    </div>
                    {frequencyData?.discount > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-success">{frequencyData.label} Discount ({frequencyData.discount * 100}%)</span>
                        <span className="text-success font-medium">
                          -${Math.round(price / (1 - frequencyData.discount) * frequencyData.discount)}
                        </span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between text-xl font-bold">
                      <span>Total</span>
                      <span className="text-primary">${price}</span>
                    </div>
                    {bookingData.frequency !== "one_time" && (
                      <p className="text-xs text-muted-foreground text-center">
                        Recurring {frequencyData?.label.toLowerCase()} charge
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
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

            {/* Action Buttons */}
            <div className="flex gap-4 pt-6">
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
              <Button
                size="lg"
                className="flex-1 h-14 text-base font-semibold bg-gradient-primary hover:opacity-90 shadow-lavender"
                onClick={handlePayment}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 w-5 h-5" />
                    Pay ${price} with Stripe
                  </>
                )}
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              By clicking "Pay with Stripe", you agree to our Terms of Service and Privacy Policy
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
