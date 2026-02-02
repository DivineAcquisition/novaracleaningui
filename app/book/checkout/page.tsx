"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function BookingCheckout() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();

  const [isProcessing, setIsProcessing] = useState(false);
  const [address, setAddress] = useState(bookingData.address || "");
  const [city, setCity] = useState(bookingData.city || "");
  const [state, setState] = useState(bookingData.state || "");

  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find((h) => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  const pricing = useMemo(() => {
    const basePrice = selectedHomeSize?.standardPrice || 150;
    const isDeepClean = bookingData.serviceType === "Deep Clean";
    const total = isDeepClean ? basePrice + SERVICE_TIER_PRICING.deep.addition : basePrice;
    const deposit = Math.round(total * 0.25);

    return {
      subtotal: total,
      deposit,
      dueAtService: total - deposit,
    };
  }, [selectedHomeSize, bookingData.serviceType]);

  const handleContinue = async () => {
    if (!address || !city || !state) {
      toast.error("Please enter your complete address");
      return;
    }

    setIsProcessing(true);

    try {
      updateBookingData({ address, city, state });

      const { data: booking, error } = await supabase
        .from("bookings")
        .insert({
          first_name: bookingData.firstName,
          last_name: bookingData.lastName,
          email: bookingData.email,
          phone: bookingData.phone,
          address,
          city,
          state,
          zip_code: bookingData.zipCode,
          service_type: bookingData.serviceType,
          service_date: bookingData.serviceDate,
          time_slot: bookingData.timeSlot,
          home_size_id: bookingData.homeSizeId,
          membership_plan: bookingData.membershipPlan,
          base_price_cents: pricing.subtotal * 100,
          total_estimate_cents: pricing.subtotal * 100,
          deposit_cents: pricing.deposit * 100,
          status: "pending_payment",
        })
        .select()
        .single();

      if (error) throw error;

      updateBookingData({ bookingId: booking.id });
      setCurrentStep(5);
      router.push("/book/details");
    } catch (error: any) {
      console.error("Checkout error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setCurrentStep(3);
    router.push("/book/offer");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-primary/[0.02] to-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5 w-fit">
            <div className="w-9 h-9 rounded-xl bg-primary glow-primary-sm flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-8 md:py-12">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-muted-foreground">Step 4 of 5</span>
            <span className="font-medium">Address & Review</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary glow-primary-sm rounded-full transition-all duration-500" style={{ width: "80%" }} />
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contact Summary */}
            <Card className="card-premium">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                    <i className="ri-check-double-line text-green-600 text-xl"></i>
                  </div>
                  <h3 className="font-semibold text-lg">Contact Information</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground mb-1">Name</p>
                    <p className="font-medium">{bookingData.firstName} {bookingData.lastName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Email</p>
                    <p className="font-medium">{bookingData.email}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">Phone</p>
                    <p className="font-medium">{bookingData.phone}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1">ZIP Code</p>
                    <p className="font-medium">{bookingData.zipCode}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Address Form */}
            <Card className="card-premium">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <i className="ri-map-pin-line text-primary text-xl"></i>
                  </div>
                  <h3 className="font-semibold text-lg">Service Address</h3>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium mb-2 block">Street Address</Label>
                    <div className="relative">
                      <i className="ri-home-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                      <Input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="123 Main Street"
                        className="pl-10 h-12 border-2 focus:border-primary"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium mb-2 block">City</Label>
                      <Input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Dallas"
                        className="h-12 border-2 focus:border-primary"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium mb-2 block">State</Label>
                      <Input
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        placeholder="TX"
                        className="h-12 border-2 focus:border-primary"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Security Badges */}
            <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <i className="ri-shield-check-line text-green-500 text-lg"></i>
                <span>Secure Booking</span>
              </div>
              <div className="flex items-center gap-2">
                <i className="ri-lock-line text-green-500 text-lg"></i>
                <span>256-bit Encryption</span>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div>
            <Card className="card-premium card-glow sticky top-24">
              <CardContent className="p-5">
                <h3 className="font-semibold text-lg mb-4">Order Summary</h3>
                
                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-2 text-sm">
                    <i className="ri-home-4-line text-muted-foreground"></i>
                    <span>{selectedHomeSize?.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary" className="gap-1">
                      <i className="ri-sparkling-line"></i>
                      {bookingData.serviceType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <i className="ri-calendar-line text-muted-foreground"></i>
                    <span>
                      {bookingData.serviceDate &&
                        format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <i className="ri-time-line text-muted-foreground"></i>
                    <span>{bookingData.timeSlot}</span>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Service Total</span>
                    <span className="font-medium">${pricing.subtotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due at service</span>
                    <span>${pricing.dueAtService}</span>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="flex justify-between items-center mb-4">
                  <div>
                    <p className="font-semibold">Due Today</p>
                    <p className="text-xs text-muted-foreground">25% deposit</p>
                  </div>
                  <p className="text-2xl font-bold text-primary">${pricing.deposit}</p>
                </div>

                <Button
                  className="w-full h-12 glow-primary-sm"
                  onClick={handleContinue}
                  disabled={isProcessing || !address || !city || !state}
                >
                  {isProcessing ? (
                    <>
                      <i className="ri-loader-4-line animate-spin mr-2"></i>
                      Processing...
                    </>
                  ) : (
                    <>
                      Continue
                      <i className="ri-arrow-right-line ml-2"></i>
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground mt-3">
                  You won&apos;t be charged until the next step
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Back Button */}
        <div className="mt-6">
          <Button variant="ghost" onClick={handleBack} className="gap-2">
            <i className="ri-arrow-left-line"></i>
            Back to service selection
          </Button>
        </div>
      </main>
    </div>
  );
}
