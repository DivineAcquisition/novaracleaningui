"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import confetti from "canvas-confetti";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";

function ConfirmationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { bookingData, resetBookingData } = useBooking();
  const bookingId = searchParams.get("booking_id");
  
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);

  // Confetti celebration
  useEffect(() => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);

      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#6600ff', '#a855f7', '#22c55e', '#fbbf24'],
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#6600ff', '#a855f7', '#22c55e', '#fbbf24'],
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  const handleReturnHome = () => {
    resetBookingData();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 pb-24 md:pb-8">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <i className="ri-sparkling-2-fill text-white text-lg"></i>
            </div>
            <span className="font-semibold text-lg">NovaraCleaning</span>
          </Link>
        </div>
      </header>

      <div className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-4 animate-fade-in">
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
            <i className="ri-check-line text-white text-4xl"></i>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold">Booking Confirmed! 🎉</h1>
          <p className="text-muted-foreground">
            We&apos;ve sent a confirmation email to <span className="font-medium">{bookingData.email}</span>
          </p>
        </div>

        {/* Booking Details Card */}
        <Card className="border-primary/20 shadow-lg overflow-hidden animate-fade-in">
          <div className="bg-gradient-to-r from-primary to-primary/80 p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="ri-sparkling-fill text-xl"></i>
                <span className="font-semibold">{bookingData.serviceType}</span>
              </div>
              <Badge className="bg-white/20 text-white border-0">
                {bookingData.membershipPlan !== "none" ? "Member" : "One-Time"}
              </Badge>
            </div>
          </div>

          <CardContent className="p-6 space-y-5">
            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <i className="ri-calendar-line text-primary text-xl"></i>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-semibold">
                    {bookingData.serviceDate &&
                      format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMMM d")}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <i className="ri-time-line text-primary text-xl"></i>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-semibold">{bookingData.timeSlot}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Address */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <i className="ri-map-pin-line text-primary text-xl"></i>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Service Address</p>
                <p className="font-semibold">{bookingData.address}</p>
                <p className="text-sm text-muted-foreground">
                  {bookingData.city}, {bookingData.state} {bookingData.zipCode}
                </p>
              </div>
            </div>

            {/* Home Details */}
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <i className="ri-home-4-line text-primary text-xl"></i>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Home Details</p>
                <p className="font-semibold">
                  {homeSize?.label} • {bookingData.bedrooms} bed, {bookingData.bathrooms} bath
                </p>
              </div>
            </div>

            <Separator />

            {/* Contact */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <i className="ri-mail-line text-muted-foreground"></i>
                <span className="truncate">{bookingData.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <i className="ri-phone-line text-muted-foreground"></i>
                <span>{bookingData.phone}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What Happens Next */}
        <Card className="animate-fade-in">
          <CardContent className="p-6">
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <i className="ri-rocket-line text-primary"></i>
              What happens next?
            </h3>
            
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <i className="ri-mail-line text-primary"></i>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Confirmation Email</h4>
                  <p className="text-sm text-muted-foreground">
                    We&apos;ve sent a confirmation email with all your booking details.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <i className="ri-notification-line text-primary"></i>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Reminder</h4>
                  <p className="text-sm text-muted-foreground">
                    You&apos;ll receive a reminder 24 hours before your scheduled cleaning.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <i className="ri-team-line text-primary"></i>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">Cleaning Day</h4>
                  <p className="text-sm text-muted-foreground">
                    Our premium team will arrive during your selected time window.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Account Creation CTA */}
        <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20 animate-fade-in">
          <CardContent className="p-6 text-center space-y-4">
            <i className="ri-user-add-line text-primary text-3xl"></i>
            <div>
              <h3 className="font-semibold text-lg">Want to Manage Your Bookings?</h3>
              <p className="text-sm text-muted-foreground">
                Create an account to track bookings, manage payments, and update future appointments
              </p>
            </div>
            <Link href="/auth">
              <Button className="w-full max-w-xs">
                <i className="ri-user-add-line mr-2"></i>
                Create Account
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Support Info */}
        <div className="text-center space-y-4 animate-fade-in">
          <p className="text-sm text-muted-foreground">
            Need to make changes? Contact us at{" "}
            <a href="mailto:support@novaracleaning.com" className="text-primary hover:underline">
              support@novaracleaning.com
            </a>
          </p>
          
          {/* Desktop Button */}
          <Button
            size="lg"
            className="hidden md:inline-flex h-14 px-8 text-base font-semibold"
            onClick={handleReturnHome}
          >
            <i className="ri-home-line mr-2"></i>
            Return to Home
          </Button>
        </div>
      </div>

      {/* Mobile Bottom Button */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-background border-t border-border shadow-xl z-50 p-4 animate-slide-up">
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold"
          onClick={handleReturnHome}
        >
          <i className="ri-home-line mr-2"></i>
          Return to Home
        </Button>
      </div>
    </div>
  );
}

export default function BookingConfirmation() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <i className="ri-loader-4-line text-3xl animate-spin text-primary"></i>
      </div>
    }>
      <ConfirmationContent />
    </Suspense>
  );
}
