"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, ArrowLeft, MapPin, Calendar, Clock, Home, Loader2 } from "lucide-react";
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
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>Step 4 of 5</span>
            <span>Address & Review</span>
          </div>
          <div className="h-2 bg-muted rounded-full">
            <div className="h-full bg-primary rounded-full" style={{ width: "80%" }} />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Address Form */}
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Service Address
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address">Street Address</Label>
                  <Input
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Dallas"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="TX"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contact Information</CardTitle>
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
          </div>

          {/* Order Summary */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-muted-foreground" />
                    <span>{selectedHomeSize?.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span>
                      {bookingData.serviceDate &&
                        format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span>{bookingData.timeSlot}</span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{bookingData.serviceType}</span>
                    <span>${pricing.subtotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due at service</span>
                    <span>${pricing.dueAtService}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between font-semibold">
                  <span>Due Today (25% deposit)</span>
                  <span>${pricing.deposit}</span>
                </div>

                <Button
                  className="w-full"
                  onClick={handleContinue}
                  disabled={isProcessing || !address || !city || !state}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-6">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
