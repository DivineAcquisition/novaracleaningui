"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PageTransition } from "@/components/booking/PageTransition";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BOOKING_STEPS = [
  { number: 1, label: "Location", path: "/book/zip" },
  { number: 2, label: "Home Size", path: "/book/sqft" },
  { number: 3, label: "Service", path: "/book/offer" },
  { number: 4, label: "Checkout", path: "/book/checkout" },
  { number: 5, label: "Details", path: "/book/details" },
  { number: 6, label: "Confirm", path: "/book/confirmation" },
];

export default function BookingCheckout() {
  const router = useRouter();
  const { bookingData, currentStep, updateBookingData, setCurrentStep } = useBooking();
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Form state
  const [address, setAddress] = useState(bookingData.address || "");
  const [city, setCity] = useState(bookingData.city || "");
  const [state, setState] = useState(bookingData.state || "TX");

  // Get pricing data
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const pricing = useMemo(() => {
    const isDeepClean = bookingData.serviceType === "Deep Clean";
    const basePrice = homeSize?.standardPrice || 150;
    const total = isDeepClean ? basePrice + SERVICE_TIER_PRICING.deep.addition - 50 : basePrice;
    const deposit = Math.round(total * 0.25);
    
    return {
      subtotal: total,
      deposit,
      balanceDue: total - deposit,
    };
  }, [homeSize, bookingData.serviceType]);

  const handleContinue = async () => {
    if (!address || !city || !state) {
      toast.error("Please enter your complete address");
      return;
    }

    setIsProcessing(true);

    try {
      // Update booking data with address
      updateBookingData({ address, city, state });

      // Create booking in database
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
      router.push("/book/details?booking_id=" + booking.id);
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
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-32 md:pb-8">
        <BookingHeader currentStep={4} totalSteps={6} stepLabel="Checkout" />

        <div className="container max-w-5xl mx-auto px-4 py-6 md:py-8">
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Main Form Column */}
            <div className="lg:col-span-2 space-y-6">
              {/* Booking Summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <i className="ri-check-double-line text-green-600"></i>
                    Booking Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-start gap-3">
                      <i className="ri-calendar-line text-primary mt-0.5"></i>
                      <div>
                        <p className="text-muted-foreground">Date</p>
                        <p className="font-medium">
                          {bookingData.serviceDate && 
                            format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <i className="ri-time-line text-primary mt-0.5"></i>
                      <div>
                        <p className="text-muted-foreground">Time</p>
                        <p className="font-medium">{bookingData.timeSlot}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <i className="ri-home-4-line text-primary mt-0.5"></i>
                      <div>
                        <p className="text-muted-foreground">Home Size</p>
                        <p className="font-medium">{homeSize?.label}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <i className="ri-sparkling-line text-primary mt-0.5"></i>
                      <div>
                        <p className="text-muted-foreground">Service</p>
                        <p className="font-medium">{bookingData.serviceType}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Contact Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <i className="ri-user-line text-primary"></i>
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Name</p>
                      <p className="font-medium">{bookingData.firstName} {bookingData.lastName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Email</p>
                      <p className="font-medium">{bookingData.email}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Phone</p>
                      <p className="font-medium">{bookingData.phone}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">ZIP Code</p>
                      <p className="font-medium">{bookingData.zipCode}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Service Address */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <i className="ri-map-pin-line text-primary"></i>
                    Service Address
                  </CardTitle>
                  <CardDescription>
                    Enter the address where you&apos;d like the cleaning service
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="address">Street Address</Label>
                    <div className="relative">
                      <i className="ri-home-line absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"></i>
                      <Input
                        id="address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="123 Main Street"
                        className="pl-10 h-12"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Dallas"
                        className="h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        placeholder="TX"
                        className="h-12"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Desktop Back Button */}
              <div className="hidden md:block">
                <Button variant="outline" onClick={handleBack} disabled={isProcessing}>
                  <i className="ri-arrow-left-line mr-2"></i>
                  Back to Service Selection
                </Button>
              </div>
            </div>

            {/* Order Summary Sidebar */}
            <div className="lg:col-span-1">
              <Card className="border-primary/20 shadow-lg sticky top-24">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <i className="ri-file-list-3-line text-primary"></i>
                    Order Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{bookingData.serviceType}</span>
                      <span className="font-medium">${pricing.subtotal}</span>
                    </div>
                    {bookingData.membershipPlan !== "none" && (
                      <div className="flex items-center justify-between text-green-600">
                        <span>Member Discount</span>
                        <span>-15%</span>
                      </div>
                    )}
                  </div>
                  
                  <Separator />
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Due Today (25% deposit)</span>
                      <span className="font-semibold text-lg text-primary">${pricing.deposit}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Due After Service</span>
                      <span>${pricing.balanceDue}</span>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <Button
                    size="lg"
                    className="w-full h-14 text-base font-semibold"
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
                        Continue to Details
                        <i className="ri-arrow-right-line ml-2"></i>
                      </>
                    )}
                  </Button>

                  {/* Trust Badges */}
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
                    <span className="flex items-center gap-1">
                      <i className="ri-shield-check-line text-green-600"></i>
                      Secure
                    </span>
                    <span>•</span>
                    <span>256-bit SSL</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <BottomNavigation
          currentStep={currentStep}
          totalSteps={6}
          steps={BOOKING_STEPS}
          onBack={handleBack}
          showPrice={true}
          price={pricing.deposit}
          continueDisabled={true}
        />

        <BookingFooter />
      </div>
    </PageTransition>
  );
}
