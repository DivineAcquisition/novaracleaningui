"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";
import confetti from "canvas-confetti";

export default function BookingConfirmation() {
  const router = useRouter();
  const { bookingData, resetBookingData } = useBooking();

  useEffect(() => {
    // Celebrate with confetti
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval: NodeJS.Timeout = setInterval(function() {
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

  const handleNewBooking = () => {
    resetBookingData();
    router.push("/");
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

      <main className="container max-w-2xl mx-auto px-4 py-12">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full bg-green-500 glow-success flex items-center justify-center mx-auto mb-6">
            <i className="ri-check-line text-white text-4xl"></i>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Booking Confirmed! 🎉</h1>
          <p className="text-muted-foreground">
            A confirmation email has been sent to {bookingData.email}
          </p>
        </div>

        {/* Booking Details Card */}
        <Card className="card-premium card-glow overflow-hidden mb-6">
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
                      format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMMM d, yyyy")}
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
                  {bookingData.bedrooms} bed, {bookingData.bathrooms} bath • {bookingData.dwellingType}
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

        {/* What's Next */}
        <Card className="card-premium mb-8">
          <CardContent className="p-6">
            <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
              <i className="ri-rocket-line text-primary"></i>
              What&apos;s Next?
            </h3>
            <ol className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <p className="font-medium">Check your email</p>
                  <p className="text-sm text-muted-foreground">
                    You&apos;ll receive booking confirmation and receipt
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <p className="font-medium">We&apos;ll text you</p>
                  <p className="text-sm text-muted-foreground">
                    Reminder the day before to confirm your appointment
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <p className="font-medium">Our team arrives</p>
                  <p className="text-sm text-muted-foreground">
                    On time with all supplies and equipment
                  </p>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/account" className="flex-1">
            <Button className="w-full h-12 glow-primary-sm">
              View My Account
              <i className="ri-arrow-right-line ml-2"></i>
            </Button>
          </Link>
          <Button variant="outline" className="flex-1 h-12" onClick={handleNewBooking}>
            Book Another Cleaning
          </Button>
        </div>

        {/* Referral */}
        <div className="text-center mt-8">
          <p className="text-sm text-muted-foreground mb-2">
            <i className="ri-heart-fill text-red-500 mr-1"></i>
            Love Novara? Share with friends and earn $25!
          </p>
          <Button variant="ghost" size="sm" className="gap-2">
            <i className="ri-share-line"></i>
            Share & Earn
          </Button>
        </div>
      </main>
    </div>
  );
}
