"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  MapPin,
  Calendar,
  Clock,
  Home,
  Shield,
  Lock,
  ArrowRight,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { AddressAutocomplete } from "@/components/booking/AddressAutocomplete";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING } from "@/lib/pricing-system";
import { motion } from "framer-motion";
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
    const total = isDeepClean ? basePrice + SERVICE_TIER_PRICING.deep.addition - 50 : basePrice;
    const deposit = Math.round(total * 0.25);

    return {
      subtotal: total,
      deposit,
      dueAtService: total - deposit,
    };
  }, [selectedHomeSize, bookingData.serviceType]);

  const handleAddressSelect = (addressComponents: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  }) => {
    setAddress(addressComponents.street);
    setCity(addressComponents.city);
    setState(addressComponents.state);
    if (addressComponents.zipCode) {
      updateBookingData({ zipCode: addressComponents.zipCode });
    }
  };

  const handleContinue = async () => {
    if (!address) {
      toast.error("Please enter your address");
      return;
    }

    setIsProcessing(true);

    try {
      // Update booking data
      updateBookingData({
        address,
        city,
        state,
      });

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
    <div className="min-h-screen bg-gradient-hero pb-24">
      <BookingHeader currentStep={4} totalSteps={6} stepLabel="Checkout" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-4xl mx-auto px-4 py-8"
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Complete Your Booking</h1>
          <p className="text-muted-foreground">Review your details and confirm your address</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="md:col-span-2 space-y-6">
            {/* Contact Info Summary */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Name</p>
                      <p className="font-medium">
                        {bookingData.firstName} {bookingData.lastName}
                      </p>
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
            </motion.div>

            {/* Address */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-primary" />
                    Service Address
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="address">Street Address</Label>
                    <AddressAutocomplete
                      onAddressSelect={handleAddressSelect}
                      initialValue={address}
                      placeholder="Enter your full address"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="city">City</Label>
                      <Input
                        id="city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="City"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="state">State</Label>
                      <Input
                        id="state"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        placeholder="State"
                        className="mt-1"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Security Badge */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center justify-center gap-6 text-sm text-muted-foreground"
            >
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-500" />
                <span>Secure Booking</span>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-green-500" />
                <span>256-bit Encryption</span>
              </div>
            </motion.div>
          </div>

          {/* Order Summary */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
          >
            <Card className="sticky top-24">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Service Details */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{selectedHomeSize?.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{bookingData.serviceType}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">
                      {bookingData.serviceDate &&
                        format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{bookingData.timeSlot}</span>
                  </div>
                </div>

                <Separator />

                {/* Pricing */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service Total</span>
                    <span className="font-medium">${pricing.subtotal}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Due at service</span>
                    <span>${pricing.dueAtService}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">Due Today</p>
                    <p className="text-xs text-muted-foreground">25% deposit</p>
                  </div>
                  <p className="text-2xl font-bold text-primary">${pricing.deposit}</p>
                </div>

                <Button
                  onClick={handleContinue}
                  disabled={isProcessing || !address}
                  className="w-full bg-gradient-primary h-12"
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

                <p className="text-xs text-center text-muted-foreground">
                  You won&apos;t be charged until the next step
                </p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Back Button */}
        <div className="mt-6">
          <Button variant="ghost" onClick={handleBack}>
            ← Back to service selection
          </Button>
        </div>
      </motion.div>

      <BookingFooter />
    </div>
  );
}
