import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Calendar, Clock, Home, Sparkles, Loader2, CreditCard } from "lucide-react";
import { ProgressBar } from "@/components/booking/ProgressBar";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, MEMBERSHIP_PLANS } from "@/lib/pricing-system";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const { bookingData, currentStep } = useBooking();
  const [isProcessing, setIsProcessing] = useState(false);

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

              {/* Pricing Breakdown */}
              <Card className="border-primary/20 bg-gradient-to-br from-background to-primary/5">
                <CardContent className="p-6 space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Payment Details
                  </h4>
                  <div className="space-y-3">
                     {bookingData.useCredit && (
                       <div className="flex items-center gap-2 p-3 bg-success/10 rounded-lg border border-success/20">
                         <span className="text-success font-semibold text-sm">✓ Using 1 Membership Credit</span>
                       </div>
                     )}
                     <div className="flex justify-between text-sm">
                       <span className="text-muted-foreground">Base Service</span>
                       <span className={cn("font-medium", bookingData.useCredit && "line-through text-muted-foreground")}>
                         ${pricing.basePrice.toFixed(2)}
                       </span>
                     </div>
                     {pricing.serviceAddition > 0 && (
                       <div className="flex justify-between text-sm">
                         <span className="text-muted-foreground">Service Upgrade</span>
                         <span className="font-medium">+${pricing.serviceAddition.toFixed(2)}</span>
                       </div>
                     )}
                     {pricing.addOnsTotal > 0 && (
                       <div className="flex justify-between text-sm">
                         <span className="text-muted-foreground">Add-ons</span>
                         <span className="font-medium">+${pricing.addOnsTotal.toFixed(2)}</span>
                       </div>
                     )}
                     {pricing.membershipDiscount > 0 && (
                       <div className="flex justify-between text-sm text-success">
                         <span>Membership Discount</span>
                         <span>-${pricing.membershipDiscount.toFixed(2)}</span>
                       </div>
                     )}
                     {bookingData.useCredit && (
                       <div className="flex justify-between text-sm text-success">
                         <span>Credit Coverage</span>
                         <span>-${Math.min(pricing.basePrice, 150).toFixed(2)}</span>
                       </div>
                     )}
                     <Separator />
                     <div className="flex justify-between text-base font-semibold">
                       <span>{bookingData.useCredit ? 'Due Today' : 'Deposit Today'}</span>
                       <span className="text-primary">${pricing.deposit.toFixed(2)}</span>
                     </div>
                     {!bookingData.useCredit && (
                       <div className="flex justify-between text-sm text-muted-foreground">
                         <span>Balance After Cleaning</span>
                         <span>${pricing.balanceDue.toFixed(2)}</span>
                       </div>
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
                 ) : bookingData.membershipPlan !== 'none' ? (
                   <>
                     <CreditCard className="mr-2 w-5 h-5" />
                     Subscribe & Book First Clean
                   </>
                 ) : bookingData.useCredit ? (
                   pricing.deposit === 0 ? (
                     <>
                       <CreditCard className="mr-2 w-5 h-5" />
                       Confirm Booking (Free)
                     </>
                   ) : (
                     <>
                       <CreditCard className="mr-2 w-5 h-5" />
                       Pay ${pricing.deposit.toFixed(2)} & Book
                     </>
                   )
                 ) : (
                   <>
                     <CreditCard className="mr-2 w-5 h-5" />
                     Pay ${pricing.deposit.toFixed(2)} Deposit
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
