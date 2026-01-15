"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useBooking } from "@/app/providers";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  CheckCircle,
  Calendar,
  Clock,
  MapPin,
  Share2,
  Copy,
  Mail,
  MessageSquare,
  Sparkles,
  PartyPopper,
  Gift,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

export default function ConfirmationPage() {
  const { bookingData, clearBookingData } = useBooking();
  const [referralCode, setReferralCode] = useState("");

  useEffect(() => {
    // Generate referral code based on name
    if (bookingData.firstName && bookingData.lastName) {
      const code = `${bookingData.firstName.toUpperCase().slice(0, 3)}${bookingData.lastName.toUpperCase().slice(0, 3)}${Math.floor(Math.random() * 1000)}`;
      setReferralCode(code);
    }
  }, [bookingData]);

  const copyReferralCode = () => {
    navigator.clipboard.writeText(referralCode);
    toast.success("Referral code copied!");
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent("$25 off your first cleaning with NovaraCleaning!");
    const body = encodeURIComponent(
      `Hey! I just booked a cleaning with NovaraCleaning and it was super easy. Use my referral code ${referralCode} to get $25 off your first clean!\n\nBook here: https://try.novaracleaning.com`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const shareViaSMS = () => {
    const message = encodeURIComponent(
      `Hey! Use my code ${referralCode} to get $25 off your first clean with NovaraCleaning! Book here: https://try.novaracleaning.com`
    );
    window.open(`sms:?body=${message}`);
  };

  const addToGoogleCalendar = () => {
    if (!bookingData.serviceDate) return;
    
    const date = new Date(bookingData.serviceDate);
    const startTime = bookingData.timeSlot?.split(" - ")[0] || "9:00 AM";
    
    // Parse time
    const [time, period] = startTime.split(" ");
    const [hours, minutes] = time.split(":").map(Number);
    let hour24 = hours;
    if (period === "PM" && hours !== 12) hour24 += 12;
    if (period === "AM" && hours === 12) hour24 = 0;
    
    date.setHours(hour24, minutes, 0);
    const endDate = new Date(date.getTime() + 2 * 60 * 60 * 1000); // 2 hours later
    
    const formatForGoogle = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    
    const url = new URL("https://calendar.google.com/calendar/render");
    url.searchParams.set("action", "TEMPLATE");
    url.searchParams.set("text", "NovaraCleaning - Home Cleaning");
    url.searchParams.set("dates", `${formatForGoogle(date)}/${formatForGoogle(endDate)}`);
    url.searchParams.set("location", bookingData.address || "");
    url.searchParams.set("details", "Professional home cleaning by NovaraCleaning");
    
    window.open(url.toString(), "_blank");
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Success Header */}
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center animate-bounce">
            <PartyPopper className="h-10 w-10 text-green-600" />
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold">
          You're All Set! 🎉
        </h1>
        <p className="text-lg text-muted-foreground">
          Your cleaning has been scheduled. We've sent a confirmation to{" "}
          <span className="font-medium text-foreground">{bookingData.email}</span>
        </p>
      </div>

      {/* Booking Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Booking Details</span>
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              Confirmed
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">
                {bookingData.serviceDate ? formatDate(bookingData.serviceDate) : "Date TBD"}
              </p>
              <p className="text-sm text-muted-foreground">{bookingData.timeSlot}</p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{bookingData.address || "Address"}</p>
              <p className="text-sm text-muted-foreground">
                {bookingData.city}, {bookingData.state} {bookingData.zipCode}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">{bookingData.serviceType || "Cleaning Service"}</p>
              <p className="text-sm text-muted-foreground">
                {bookingData.offerType === "membership" ? "Monthly Membership" : "One-Time Clean"}
              </p>
            </div>
          </div>

          <Separator />

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={addToGoogleCalendar}>
              <Calendar className="h-4 w-4 mr-2" />
              Add to Calendar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* What's Next */}
      <Card>
        <CardHeader>
          <CardTitle>What Happens Next?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              {
                step: 1,
                title: "Confirmation Email",
                description: "Check your inbox for booking details and preparation tips",
              },
              {
                step: 2,
                title: "Reminder Notifications",
                description: "We'll send you reminders 24 hours and 1 hour before your appointment",
              },
              {
                step: 3,
                title: "Cleaner Assignment",
                description: "A background-checked cleaner will be assigned to your booking",
              },
              {
                step: 4,
                title: "Enjoy Your Clean Home!",
                description: "Sit back and relax while we make your home sparkle",
              },
            ].map((item) => (
              <div key={item.step} className="flex items-start gap-4">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium text-primary">
                  {item.step}
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Referral Program */}
      <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Earn Free Cleanings!
          </CardTitle>
          <CardDescription>
            Share your referral code with friends and you both get $25 off
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 p-3 bg-white rounded-lg border-2 border-dashed border-primary/30">
              <p className="text-center text-2xl font-bold tracking-widest text-primary">
                {referralCode}
              </p>
            </div>
            <Button variant="outline" onClick={copyReferralCode}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={copyReferralCode}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button variant="outline" onClick={shareViaEmail}>
              <Mail className="h-4 w-4 mr-2" />
              Email
            </Button>
            <Button variant="outline" onClick={shareViaSMS}>
              <MessageSquare className="h-4 w-4 mr-2" />
              Text
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create Account CTA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Create Your Account
          </CardTitle>
          <CardDescription>
            Manage your bookings, earn rewards, and rebook in seconds
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="https://app.novaracleaning.com/signup">
            <Button className="w-full">
              Create Free Account
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center space-y-4 pt-8">
        <p className="text-muted-foreground">
          Questions? Contact us at{" "}
          <a href="mailto:support@novaracleaning.com" className="text-primary hover:underline">
            support@novaracleaning.com
          </a>{" "}
          or call{" "}
          <a href="tel:+1234567890" className="text-primary hover:underline">
            (123) 456-7890
          </a>
        </p>
        <Link href="/">
          <Button variant="ghost">
            <Sparkles className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
