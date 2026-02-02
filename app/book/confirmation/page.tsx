"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, Calendar, Clock, MapPin, Home, Mail, Phone, ArrowRight } from "lucide-react";
import { format } from "date-fns";

export default function BookingConfirmation() {
  const router = useRouter();
  const { bookingData, resetBookingData } = useBooking();

  const handleNewBooking = () => {
    resetBookingData();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto px-4 py-12">
        {/* Success Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Booking Confirmed!</h1>
          <p className="text-muted-foreground">
            A confirmation email has been sent to {bookingData.email}
          </p>
        </div>

        {/* Booking Details */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Booking Details</CardTitle>
              <Badge>{bookingData.serviceType}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">
                    {bookingData.serviceDate &&
                      format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMMM d, yyyy")}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-medium">{bookingData.timeSlot}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Address */}
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Service Address</p>
                <p className="font-medium">{bookingData.address}</p>
                <p className="text-sm text-muted-foreground">
                  {bookingData.city}, {bookingData.state} {bookingData.zipCode}
                </p>
              </div>
            </div>

            {/* Home Details */}
            <div className="flex items-start gap-3">
              <Home className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm text-muted-foreground">Home Details</p>
                <p className="font-medium">
                  {bookingData.bedrooms} bed, {bookingData.bathrooms} bath • {bookingData.dwellingType}
                </p>
              </div>
            </div>

            <Separator />

            {/* Contact */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{bookingData.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{bookingData.phone}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* What's Next */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>What&apos;s Next?</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <p>
                  <strong>Check your email</strong> for booking confirmation and receipt
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <p>
                  <strong>We&apos;ll text you</strong> the day before to confirm your appointment
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <p>
                  <strong>Our team arrives</strong> on time with all supplies and equipment
                </p>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/account" className="flex-1">
            <Button className="w-full">
              View My Account
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
          <Button variant="outline" className="flex-1" onClick={handleNewBooking}>
            Book Another Cleaning
          </Button>
        </div>
      </div>
    </div>
  );
}
