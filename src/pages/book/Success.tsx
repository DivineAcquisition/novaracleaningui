import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, Calendar, Mail, Home, Share2, Download, Clock, MapPin, CreditCard, Settings, ExternalLink, UserPlus, Loader2, AlertCircle } from "lucide-react";
import { format, parse, addHours } from "date-fns";
import { toast } from "sonner";
import { downloadICalFile, addToGoogleCalendar, addToOutlookCalendar } from "@/lib/calendar";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const TIME_SLOT_MAP: Record<string, { start: number; end: number }> = {
  "8-12": { start: 8, end: 12 },
  "12-16": { start: 12, end: 16 },
  "16-20": { start: 16, end: 20 },
};

const logStep = (step: string, details?: any) => {
  console.log(`[BookingSuccess] ${step}`, details);
};

export default function BookingSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { bookingData, resetBookingData } = useBooking();
  const { user, openCustomerPortal } = useAuth();
  const sessionId = searchParams.get("session_id");
  const paymentIntent = searchParams.get("payment_intent");
  const [canShare, setCanShare] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [bookingValidated, setBookingValidated] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);

  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const pricing = calculatePrice(
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.addOns,
    bookingData.membershipPlan,
    bookingData.useCredit
  );

  // Validate booking on page load - prevent unauthorized access
  useEffect(() => {
    const validateBooking = async () => {
      logStep("Starting booking validation");
      
      const bookingIdFromUrl = searchParams.get("booking_id");
      const paymentIntentParam = searchParams.get("payment_intent");
      
      // Must have either booking_id or payment_intent to access this page
      if (!bookingIdFromUrl && !paymentIntentParam) {
        logStep("No booking ID or payment intent found - redirecting to home");
        toast.error("No booking found. Please complete the booking process.");
        navigate("/");
        return;
      }

      try {
        let bookingId = bookingIdFromUrl;
        
        // If we only have payment_intent, find the booking by payment_intent_id
        if (!bookingId && paymentIntentParam) {
          const { data: bookingByPayment, error: lookupError } = await supabase
            .from('bookings')
            .select('id')
            .eq('payment_intent_id', paymentIntentParam)
            .single();
          
          if (lookupError || !bookingByPayment) {
            logStep("Booking not found by payment intent", { paymentIntentParam });
            toast.error("Booking not found. Please contact support.");
            navigate("/");
            return;
          }
          
          bookingId = bookingByPayment.id;
        }

        // Fetch the booking to validate it
        const { data: booking, error: bookingError } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .single();

        if (bookingError || !booking) {
          logStep("Booking not found in database", { bookingId });
          toast.error("Booking not found. Please contact support.");
          navigate("/");
          return;
        }

        logStep("Booking found", { booking });

        // Check if booking status is valid (must be confirmed or pending_payment)
        if (booking.status !== 'confirmed' && booking.status !== 'pending_payment') {
          logStep("Invalid booking status", { status: booking.status });
          toast.error("Invalid booking status. Please contact support.");
          navigate("/");
          return;
        }

        // Check if all required post-payment details are filled
        const requiredFields = ['address', 'city', 'state', 'bedrooms', 'bathrooms', 'dwelling_type'];
        const missingFields = requiredFields.filter(field => !booking[field]);
        
        if (missingFields.length > 0) {
          logStep("Missing required fields - redirecting to additional details", { missingFields });
          toast.info("Please complete your booking details");
          navigate(`/book/additional-details?booking_id=${bookingId}`);
          return;
        }

        // If payment_intent exists but status is still pending_payment, 
        // the payment might not have been verified yet
        if (booking.status === 'pending_payment' && booking.payment_intent_id) {
          logStep("Booking has payment intent but not confirmed - will verify payment");
          // Let the payment verification effect handle this
        }

        // All validations passed
        logStep("Booking validated successfully");
        setBookingId(bookingId);
        setBookingValidated(true);
        
      } catch (error) {
        console.error("Error validating booking:", error);
        toast.error("Error validating booking. Please contact support.");
        navigate("/");
      } finally {
        setIsValidating(false);
      }
    };

    validateBooking();
  }, [searchParams, navigate]);

  // Check if Web Share API is available
  useEffect(() => {
    if (navigator.share) {
      setCanShare(true);
    }
  }, []);

  useEffect(() => {
    const verifyPayment = async () => {
      // Only verify payment if booking has been validated first
      if (!bookingValidated) return;
      
      if (!paymentIntent) {
        // No payment intent means either using credit or old booking flow
        setPaymentVerified(true);
        return;
      }

      setIsVerifyingPayment(true);
      logStep("Starting payment verification", { paymentIntent });

      try {
        const { data, error } = await supabase.functions.invoke('verify-payment', {
          body: { payment_intent_id: paymentIntent }
        });

        if (error) {
          console.error("Payment verification error:", error);
          setVerificationError(error.message || "Unable to verify payment");
          toast.error("Payment verification failed");
        } else if (data) {
          console.log("Payment verification result:", data);
          if (data.success) {
            setPaymentVerified(true);
            toast.success("Payment confirmed!");
            
            // Additional details check is now handled by the validation effect
          } else {
            setVerificationError(data.message || "Payment verification incomplete");
            if (data.status === 'processing') {
              toast.info("Payment is being processed");
            } else {
              toast.warning(data.message || "Payment verification incomplete");
            }
          }
        }
      } catch (err) {
        console.error("Unexpected error during verification:", err);
        setVerificationError("An unexpected error occurred");
        toast.error("Failed to verify payment");
      } finally {
        setIsVerifyingPayment(false);
      }
    };

    verifyPayment();
  }, [paymentIntent, bookingValidated]);

  // Send confirmation email automatically
  useEffect(() => {
    const sendConfirmationEmail = async () => {
      // Only send if booking is validated and payment is verified (or no payment needed)
      if (!bookingValidated || !bookingId || emailSent) return;
      if (paymentIntent && !paymentVerified) return;

      logStep("Checking if email should be sent", { bookingId, emailSent });

      try {
        // Check if email was already sent for this booking (idempotency)
        const { data: booking, error: fetchError } = await supabase
          .from('bookings')
          .select('confirmation_email_sent, email, first_name, service_date, time_slot, service_type, home_size_id, address, city, state, zip_code, total_estimate_cents, deposit_cents, payment_option, uses_credit, add_ons')
          .eq('id', bookingId)
          .single();

        if (fetchError || !booking) {
          logStep("Error fetching booking for email", { error: fetchError });
          return;
        }

        if (booking.confirmation_email_sent) {
          logStep("Email already sent for this booking");
          setEmailSent(true);
          return;
        }

        // Calculate discounts
        const isNewCustomer = !user; // If not logged in, they're a new customer
        const newCustomerDiscount = isNewCustomer ? 6000 : 0; // $60 in cents
        
        // Get membership discount if applicable
        const membershipDiscount = bookingData.membershipPlan !== 'none' 
          ? Math.round(pricing.membershipDiscount || 0)
          : 0;

        // Get full payment discount if applicable
        const fullPaymentDiscount = booking.payment_option === 'full'
          ? Math.round((booking.total_estimate_cents - booking.deposit_cents) * 0.1)
          : 0;

        logStep("Sending confirmation email", { 
          bookingId, 
          email: booking.email,
          discounts: { newCustomerDiscount, membershipDiscount, fullPaymentDiscount }
        });

        // Send the email via edge function
        const { error: emailError } = await supabase.functions.invoke('send-booking-email', {
          body: {
            type: 'confirmation',
            email: booking.email,
            data: {
              firstName: booking.first_name,
              bookingId: bookingId,
              serviceDate: booking.service_date,
              timeSlot: booking.time_slot,
              serviceType: booking.service_type,
              homeSize: HOME_SIZE_RANGES.find(h => h.id === booking.home_size_id)?.label,
              address: booking.address,
              city: booking.city,
              state: booking.state,
              zipCode: booking.zip_code,
              totalAmount: booking.total_estimate_cents,
              depositAmount: booking.deposit_cents,
              balanceAmount: booking.total_estimate_cents - booking.deposit_cents,
              paymentOption: booking.payment_option,
              useCredit: booking.uses_credit,
              addOns: booking.add_ons || [],
              newCustomerDiscount,
              membershipDiscount,
              fullPaymentDiscount,
            }
          }
        });

        if (emailError) {
          console.error("Error sending confirmation email:", emailError);
          // Don't show error to user - this is not critical
          logStep("Email send failed", { error: emailError });
        } else {
          logStep("Confirmation email sent successfully");
          
          // Mark email as sent in database
          await supabase
            .from('bookings')
            .update({ 
              confirmation_email_sent: true,
              confirmation_email_sent_at: new Date().toISOString()
            })
            .eq('id', bookingId);

          setEmailSent(true);
        }
      } catch (error) {
        console.error("Unexpected error sending confirmation email:", error);
        // Silent failure - don't disrupt user experience
      }
    };

    sendConfirmationEmail();
  }, [bookingValidated, paymentVerified, paymentIntent, bookingId, emailSent, user, bookingData.membershipPlan, pricing]);

  // Store guest email in localStorage for easy account creation
  useEffect(() => {
    if (!user && bookingData.email) {
      localStorage.setItem('guestBookingEmail', bookingData.email);
    }
  }, [user, bookingData.email]);

  const handleReturnHome = () => {
    resetBookingData();
    navigate("/");
  };

  const handleShare = async () => {
    const shareData = {
      title: 'Novara Cleaning Booking',
      text: `My cleaning is scheduled for ${format(new Date(bookingData.serviceDate), "EEEE, MMMM d, yyyy")} at ${getTimeSlotLabel(bookingData.timeSlot)}`,
      url: window.location.origin,
    };

    try {
      if (navigator.share && canShare) {
        await navigator.share(shareData);
        toast.success('Shared successfully!');
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(
          `${shareData.text}\n${shareData.url}`
        );
        toast.success('Booking details copied to clipboard!');
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const handleOpenPortal = async () => {
    setIsOpeningPortal(true);
    try {
      await openCustomerPortal();
    } catch (error) {
      toast.error('Unable to open customer portal. Please contact support@novaracleaning.com for assistance.');
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const getTimeSlotLabel = (slotId: string) => {
    const slot = slotId.split('-');
    if (slot.length === 2) {
      const startHour = parseInt(slot[0]);
      const endHour = parseInt(slot[1]);
      const formatHour = (h: number) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${hour}:00 ${period}`;
      };
      return `${formatHour(startHour)} - ${formatHour(endHour)}`;
    }
    return slotId;
  };

  const handleAddToCalendar = (type: 'ical' | 'google' | 'outlook') => {
    if (!bookingData.serviceDate || !bookingData.timeSlot) {
      toast.error('Missing booking date or time');
      return;
    }

    const timeSlot = TIME_SLOT_MAP[bookingData.timeSlot];
    if (!timeSlot) {
      toast.error('Invalid time slot');
      return;
    }

    const serviceDate = new Date(bookingData.serviceDate);
    const startDate = new Date(serviceDate);
    startDate.setHours(timeSlot.start, 0, 0, 0);
    
    const endDate = new Date(serviceDate);
    endDate.setHours(timeSlot.end, 0, 0, 0);

    const event = {
      title: `Novara Cleaning - ${serviceTier?.label}`,
      description: `${serviceTier?.label} cleaning service for ${homeSize?.label} home.\n\nService includes: ${serviceTier?.label} cleaning\nEstimated duration: ${bookingData.serviceDuration || 2} hours\n\nAddress: ${bookingData.address}, ${bookingData.city}, ${bookingData.state} ${bookingData.zipCode}\n\nContact: ${bookingData.phone}`,
      location: `${bookingData.address}, ${bookingData.city}, ${bookingData.state} ${bookingData.zipCode}`,
      startDate,
      endDate,
    };

    if (type === 'ical') {
      downloadICalFile(event, `novara-cleaning-${format(serviceDate, 'yyyy-MM-dd')}.ics`);
      toast.success('Calendar file downloaded!');
    } else if (type === 'google') {
      window.open(addToGoogleCalendar(event), '_blank');
    } else if (type === 'outlook') {
      window.open(addToOutlookCalendar(event), '_blank');
    }
  };

  // Show loading state during validation or verification
  if (isValidating || isVerifyingPayment) {
    return (
      <div className="min-h-screen bg-gradient-hero px-3 md:px-4 py-8 md:py-12 flex items-center justify-center">
        <Card className="max-w-md w-full shadow-xl">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h2 className="text-xl font-semibold">
              {isValidating ? 'Validating Booking...' : 'Verifying Payment...'}
            </h2>
            <p className="text-muted-foreground text-sm">
              {isValidating 
                ? 'Please wait while we validate your booking details' 
                : 'Please wait while we confirm your booking'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Don't render the success page if booking is not validated
  if (!bookingValidated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-hero px-3 md:px-4 py-8 md:py-12 pb-32 md:pb-12">
      <div className="container max-w-3xl mx-auto">
        {/* Show verification error if payment failed */}
        {verificationError && (
          <Card className="mb-6 border-destructive/50 bg-destructive/5">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-destructive mb-1">Payment Verification Issue</h3>
                <p className="text-sm text-muted-foreground">{verificationError}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  If you were charged, please contact support@novaracleaning.com
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        
        <Card className="shadow-xl border-success/20 animate-fade-in">
          <CardHeader className="text-center space-y-4 pb-6 md:pb-8">
            <div className="mx-auto w-16 h-16 md:w-20 md:h-20 bg-success/10 rounded-full flex items-center justify-center mb-4 animate-in zoom-in duration-500">
              <CheckCircle2 className="w-10 h-10 md:w-12 md:h-12 text-success" />
            </div>
            <CardTitle className="text-2xl md:text-4xl font-bold">
              {bookingData.membershipPlan !== 'none' ? 'Welcome to Novara!' : 'Booking Confirmed!'}
            </CardTitle>
            <CardDescription className="text-sm md:text-lg">
              {bookingData.membershipPlan !== 'none' 
                ? 'Your membership is active and your first credit is ready to use'
                : bookingData.useCredit
                ? 'Your booking is confirmed with your membership credit'
                : bookingData.paymentOption === 'full'
                ? 'Your payment is complete - you saved 10% by paying in full!'
                : 'Thank you for choosing Novara Cleaning Service'}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 md:space-y-8">
            {/* Booking Details Card */}
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Your Booking Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:gap-4">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Date</p>
                      <p className="font-semibold text-sm md:text-base">
                        {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Time Window</p>
                      <p className="font-semibold text-sm md:text-base">{getTimeSlotLabel(bookingData.timeSlot)}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Home className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Service</p>
                      <p className="font-semibold text-sm md:text-base">{serviceTier?.label} • {homeSize?.label}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Location</p>
                      <p className="font-semibold text-sm md:text-base">
                        {bookingData.address}, {bookingData.city}, {bookingData.state} {bookingData.zipCode}
                      </p>
                    </div>
                  </div>

                  {(sessionId || paymentIntent) && (
                    <div className="flex items-start gap-3">
                      <CreditCard className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs md:text-sm text-muted-foreground">
                          {bookingData.paymentOption === 'full' ? 'Paid in Full' : 'Deposit Paid'}
                        </p>
                        <p className="font-semibold text-sm md:text-base font-mono">
                          {sessionId ? sessionId.slice(-12) : paymentIntent?.slice(-12)}
                        </p>
                        {bookingData.paymentOption === 'deposit' && pricing.balanceDue > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Balance due after cleaning: ${pricing.balanceDue.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Email Sent Confirmation */}
                {emailSent && (
                  <div className="flex items-center gap-2 text-sm text-success bg-success/10 p-3 rounded-lg border border-success/20">
                    <Mail className="w-4 h-4" />
                    <span>✉️ Confirmation email sent to {bookingData.email}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full h-12 text-sm md:text-base">
                        <Calendar className="w-4 h-4 mr-2" />
                        Add to Calendar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem onClick={() => handleAddToCalendar('google')}>
                        <Calendar className="w-4 h-4 mr-2" />
                        Google Calendar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddToCalendar('outlook')}>
                        <Calendar className="w-4 h-4 mr-2" />
                        Outlook Calendar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAddToCalendar('ical')}>
                        <Download className="w-4 h-4 mr-2" />
                        Download .ics file
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button 
                    variant="outline" 
                    className="w-full h-12 text-sm md:text-base"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Customer Portal / Account Creation Card */}
            <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                  {user ? (
                    <>
                      <Settings className="w-5 h-5 text-primary" />
                      Manage Your Account
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-5 h-5 text-primary" />
                      Want to Manage Your Bookings?
                    </>
                  )}
                </CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  {user ? (
                    <>Update payment methods, view billing history, and manage your account</>
                  ) : (
                    <>Create an account to track bookings, manage payments, and update future appointments</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {user ? (
                  <Button
                    onClick={handleOpenPortal}
                    disabled={isOpeningPortal}
                    className="w-full h-12 text-sm md:text-base bg-gradient-primary shadow-elegant"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    {isOpeningPortal ? 'Opening...' : 'Open Customer Portal'}
                    <ExternalLink className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-2 text-xs md:text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Track all your bookings in one place</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Manage payment methods securely</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        <span>View billing history and receipts</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Update future appointments</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => navigate('/auth')}
                      className="w-full h-12 text-sm md:text-base bg-gradient-primary shadow-elegant"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Create Account
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* What Happens Next */}
            <div className="bg-gradient-to-br from-success/5 to-primary/5 rounded-lg p-4 md:p-6 space-y-4">
              <h3 className="text-lg md:text-xl font-semibold text-center">What happens next?</h3>
              
              <div className="space-y-4">
                <div className="flex items-start gap-3 md:gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1 text-sm md:text-base">Confirmation Email</h4>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      We've sent a confirmation email to {bookingData.email} with all your booking details.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 md:gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1 text-sm md:text-base">Reminder</h4>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      You'll receive a reminder 24 hours before your scheduled cleaning.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 md:gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Home className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1 text-sm md:text-base">Cleaning Day</h4>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      Our premium team will arrive during your selected time window.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center space-y-4">
              <p className="text-xs md:text-sm text-muted-foreground">
                Need to make changes? Contact us at support@novaracleaning.com
              </p>
              
              {/* Desktop Button */}
              <Button
                size="lg"
                className="hidden md:flex mx-auto h-14 px-8 text-base font-semibold bg-gradient-primary shadow-neon"
                onClick={handleReturnHome}
              >
                <Home className="mr-2 w-5 h-5" />
                Return to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile Bottom Button */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-background border-t border-border shadow-xl z-50 p-4 animate-slide-up">
        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold bg-gradient-primary shadow-neon"
          onClick={handleReturnHome}
        >
          <Home className="mr-2 w-5 h-5" />
          Return to Home
        </Button>
      </div>
    </div>
  );
}
