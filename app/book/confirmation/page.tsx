"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Calendar,
  Clock,
  MapPin,
  Home,
  Mail,
  Phone,
  ArrowRight,
  Sparkles,
  Share2,
} from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import confetti from "canvas-confetti";

export default function BookingConfirmation() {
  const router = useRouter();
  const { bookingData, resetBookingData } = useBooking();

  useEffect(() => {
    // Celebrate with confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#6600ff", "#a855f7", "#22c55e"],
    });
  }, []);

  const handleNewBooking = () => {
    resetBookingData();
    router.push("/book/zip");
  };

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container max-w-2xl mx-auto px-4 py-12">
        {/* Success Header */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="mx-auto w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/30">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl md:text-4xl font-bold text-foreground mb-2"
          >
            Booking Confirmed! 🎉
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-muted-foreground"
          >
            A confirmation email has been sent to {bookingData.email}
          </motion.p>
        </motion.div>

        {/* Booking Details Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="border-2 border-primary/20 shadow-xl overflow-hidden">
            <div className="bg-gradient-primary p-4 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  <span className="font-semibold">{bookingData.serviceType}</span>
                </div>
                <Badge className="bg-white/20 hover:bg-white/30">
                  {bookingData.membershipPlan !== "none" ? "Member" : "One-Time"}
                </Badge>
              </div>
            </div>

            <CardContent className="p-6 space-y-6">
              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-semibold">
                      {bookingData.serviceDate &&
                        format(
                          new Date(bookingData.serviceDate + "T12:00:00"),
                          "EEEE, MMMM d, yyyy"
                        )}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Time</p>
                    <p className="font-semibold">{bookingData.timeSlot}</p>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-primary" />
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
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Home className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Home Details</p>
                  <p className="font-semibold">
                    {bookingData.bedrooms} bed, {bookingData.bathrooms} bath •{" "}
                    {bookingData.dwellingType}
                  </p>
                </div>
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm truncate">{bookingData.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm">{bookingData.phone}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* What's Next */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-8"
        >
          <Card className="bg-gradient-lavender border-primary/20">
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">What&apos;s Next?</h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    1
                  </div>
                  <p>
                    <strong>Check your email</strong> for booking confirmation and receipt
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    2
                  </div>
                  <p>
                    <strong>We&apos;ll text you</strong> the day before to confirm your appointment
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                    3
                  </div>
                  <p>
                    <strong>Our team arrives</strong> on time with all supplies and equipment
                  </p>
                </li>
              </ul>
            </CardContent>
          </Card>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 flex flex-col sm:flex-row gap-4"
        >
          <Link href="/account" className="flex-1">
            <Button className="w-full bg-gradient-primary h-12">
              View My Account
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Button variant="outline" className="flex-1 h-12" onClick={handleNewBooking}>
            Book Another Cleaning
          </Button>
        </motion.div>

        {/* Referral CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-muted-foreground mb-2">
            Love Novara? Share with friends and earn $25!
          </p>
          <Button variant="ghost" size="sm">
            <Share2 className="w-4 h-4 mr-2" />
            Share & Earn
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
