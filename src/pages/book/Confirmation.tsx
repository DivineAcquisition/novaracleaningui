import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CheckCircle2,
  Calendar,
  Clock,
  MapPin,
  CreditCard,
  Download,
  Mail,
  Phone,
  Home,
  Loader2,
  Share2,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BookingProgressBar } from "@/components/booking/BookingProgressBar";
import { GoogleGuaranteedBadge } from "@/components/booking/GoogleGuaranteedBadge";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { HOME_SIZE_RANGES } from "@/lib/pricing-system";
import { downloadICalFile, addToGoogleCalendar } from "@/lib/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Time slot map for calendar
const TIME_SLOT_MAP: Record<string, { start: number; end: number }> = {
  "8-12": { start: 8, end: 12 },
  "9-12": { start: 9, end: 12 },
  "12-16": { start: 12, end: 16 },
  "16-20": { start: 16, end: 20 },
};

const getTimeSlotLabel = (slotId: string) => {
  const slot = slotId.split("-");
  if (slot.length === 2) {
    const startHour = parseInt(slot[0]);
    const endHour = parseInt(slot[1]);
    const formatHour = (h: number) => {
      const period = h >= 12 ? "PM" : "AM";
      const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      return `${hour}:00 ${period}`;
    };
    return `${formatHour(startHour)} - ${formatHour(endHour)}`;
  }
  return slotId;
};

export default function BookingConfirmation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetBookingData } = useBooking();
  const bookingId = searchParams.get("booking_id");

  const [isLoading, setIsLoading] = useState(true);
  const [booking, setBooking] = useState<any>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  // Fetch booking on mount
  useEffect(() => {
    const fetchBooking = async () => {
      if (!bookingId) {
        toast.error("No booking found");
        navigate("/");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", bookingId)
          .single();

        if (error || !data) {
          toast.error("Booking not found");
          navigate("/");
          return;
        }

        setBooking(data);

        // Generate referral code
        if (data.customer_id) {
          const { data: refData } = await supabase
            .from("referrals")
            .select("code")
            .eq("customer_id", data.customer_id)
            .limit(1)
            .single();

          if (refData?.code) {
            setReferralCode(refData.code);
          }
        }

        // Send confirmation email
        if (!data.confirmation_email_sent) {
          await supabase.functions.invoke("send-booking-email", {
            body: {
              type: "confirmation",
              email: data.email,
              data: {
                firstName: data.first_name,
                bookingId: bookingId,
                serviceDate: data.service_date,
                timeSlot: data.time_slot,
                serviceType: data.service_type,
                address: data.address,
                city: data.city,
                state: data.state,
                totalAmount: data.total_estimate_cents,
                depositAmount: data.deposit_cents,
              },
            },
          });

          // Mark email as sent
          await supabase
            .from("bookings")
            .update({
              confirmation_email_sent: true,
              confirmation_email_sent_at: new Date().toISOString(),
            })
            .eq("id", bookingId);
        }
      } catch (err) {
        console.error("[Confirmation] Error:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBooking();
  }, [bookingId, navigate]);

  const handleAddToCalendar = (type: "ical" | "google") => {
    if (!booking?.service_date || !booking?.time_slot) return;

    const timeSlot = TIME_SLOT_MAP[booking.time_slot];
    if (!timeSlot) return;

    const serviceDate = new Date(booking.service_date);
    const startDate = new Date(serviceDate);
    startDate.setHours(timeSlot.start, 0, 0, 0);

    const endDate = new Date(serviceDate);
    endDate.setHours(timeSlot.end, 0, 0, 0);

    const event = {
      title: "Novara Cleaning Service",
      description: `Your cleaning service is scheduled.\n\nAddress: ${booking.address}, ${booking.city}, ${booking.state}\n\nContact: (415) 555-0123`,
      location: `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
      startDate,
      endDate,
    };

    if (type === "ical") {
      downloadICalFile(event, `novara-cleaning-${format(serviceDate, "yyyy-MM-dd")}.ics`);
      toast.success("Calendar file downloaded!");
    } else if (type === "google") {
      window.open(addToGoogleCalendar(event), "_blank");
    }
  };

  const handleReturnHome = () => {
    resetBookingData();
    navigate("/");
  };

  const handleShare = async () => {
    const shareText = `I just booked a cleaning with Novara Cleaning! Use my referral code ${referralCode} for $25 off your first clean.`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Novara Cleaning Referral",
          text: shareText,
          url: window.location.origin,
        });
      } catch (err) {
        // User cancelled or error
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      toast.success("Copied to clipboard!");
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading your confirmation...</p>
        </div>
      </div>
    );
  }

  const homeSize = HOME_SIZE_RANGES.find((h) => h.id === booking?.home_size_id);
  const depositPaid = (booking?.deposit_cents || 0) / 100;
  const totalAmount = (booking?.total_estimate_cents || 0) / 100;
  const balanceDue = totalAmount - depositPaid;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <BookingProgressBar currentStep={6} totalSteps={6} />

      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Success Header */}
        <div className="text-center space-y-4">
          <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center animate-in zoom-in duration-500">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">
            🎉 You're Booked!
          </h1>
          <p className="text-muted-foreground">
            Confirmation has been sent to <span className="font-medium">{booking?.email}</span>
          </p>
          <div className="flex justify-center">
            <GoogleGuaranteedBadge />
          </div>
        </div>

        {/* Booking Details Card */}
        <Card className="border-2 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Booking Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Booking ID */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Booking ID</span>
              <Badge variant="outline" className="font-mono">
                #{booking?.booking_number || bookingId?.slice(0, 8)}
              </Badge>
            </div>

            {/* Service Type */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Service</span>
              <span className="font-semibold capitalize">
                {booking?.service_type === "deep" ? "Deep Clean" : "Standard Clean"}
              </span>
            </div>

            {/* Home Size */}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Home Size</span>
              <span className="font-medium">{homeSize?.label || "Medium"}</span>
            </div>

            <Separator />

            {/* Date & Time */}
            <div className="flex items-start gap-3">
              <Calendar className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">
                  {booking?.service_date
                    ? format(new Date(booking.service_date), "EEEE, MMMM d, yyyy")
                    : "TBD"}
                </p>
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {booking?.time_slot ? getTimeSlotLabel(booking.time_slot) : "TBD"}
                </p>
              </div>
            </div>

            {/* Address */}
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium">{booking?.address}</p>
                <p className="text-sm text-muted-foreground">
                  {booking?.city}, {booking?.state} {booking?.zip_code}
                </p>
              </div>
            </div>

            <Separator />

            {/* Pricing */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total Service Cost</span>
                <span className="font-medium">${totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center text-green-600">
                <span className="flex items-center gap-1">
                  <CreditCard className="h-4 w-4" />
                  Deposit Paid
                </span>
                <span className="font-medium">-${depositPaid.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="font-semibold">Balance Due After Service</span>
                <span className="font-bold text-lg">${balanceDue.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add to Calendar */}
        <Card className="border-2 border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary" />
                <span className="font-medium">Add to Calendar</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleAddToCalendar("google")}>
                    Google Calendar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAddToCalendar("ical")}>
                    Download .ics File
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>

        {/* What Happens Next */}
        <Card className="border-2 border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">What Happens Next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                1
              </div>
              <div>
                <p className="font-medium">Confirmation Email</p>
                <p className="text-sm text-muted-foreground">
                  You'll receive a detailed confirmation at {booking?.email}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                2
              </div>
              <div>
                <p className="font-medium">Cleaner Assignment</p>
                <p className="text-sm text-muted-foreground">
                  We'll assign your cleaner 24-48 hours before your appointment
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                3
              </div>
              <div>
                <p className="font-medium">Service Day</p>
                <p className="text-sm text-muted-foreground">
                  Your cleaner will arrive during your selected time window
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Referral Code */}
        {referralCode && (
          <Alert className="bg-primary/10 border-primary/30">
            <Sparkles className="h-4 w-4 text-primary" />
            <AlertDescription className="flex items-center justify-between">
              <div>
                <p className="font-medium">Share & Earn $25!</p>
                <p className="text-sm">Your referral code: <span className="font-mono font-bold">{referralCode}</span></p>
              </div>
              <Button variant="outline" size="sm" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1" />
                Share
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Contact & Return */}
        <div className="space-y-4 pb-6">
          <div className="text-center text-sm text-muted-foreground">
            <p>Questions? Contact us:</p>
            <div className="flex items-center justify-center gap-4 mt-2">
              <a href="tel:+14155550123" className="flex items-center gap-1 hover:text-foreground">
                <Phone className="h-4 w-4" />
                (415) 555-0123
              </a>
              <a href="mailto:support@novaracleaning.com" className="flex items-center gap-1 hover:text-foreground">
                <Mail className="h-4 w-4" />
                Email Us
              </a>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleReturnHome}>
            <Home className="h-4 w-4 mr-2" />
            Return Home
          </Button>
        </div>
      </div>

      <BookingFooter />
    </div>
  );
}
