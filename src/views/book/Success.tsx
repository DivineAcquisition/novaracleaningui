"use client";
import {
  RiBankCardLine,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiHomeLine,
  RiLoader4Line,
  RiMailLine,
  RiMapPinLine,
  RiSettings3Line,
  RiShareLine,
  RiTimeLine,
  RiUserAddLine
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { format, parse, addHours } from "date-fns";
import { toast } from "sonner";
import { downloadICalFile, addToGoogleCalendar, addToOutlookCalendar } from "@/lib/calendar";
import { HOME_SIZE_RANGES, SERVICE_TIER_PRICING, calculatePrice } from "@/lib/pricing-system";
import { supabase } from "@/integrations/supabase/client";
import { ReferralSection } from "@/components/ReferralSection";
import { trackPurchase } from "@/lib/meta-pixel";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { bookingData, updateBookingData, resetBookingData } = useBooking();
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
  const [bookingStatus, setBookingStatus] = useState<string>("pending_payment");
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [referralCode, setReferralCode] = useState<string>('');
  const [referralLink, setReferralLink] = useState<string>('');

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
        router.push("/");
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
            router.push("/");
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
          router.push("/");
          return;
        }

        logStep("Booking found", { booking });

        // Check if booking status is valid (must be confirmed,
        // pending_payment, or pending_details).
        if (
          booking.status !== 'confirmed' &&
          booking.status !== 'pending_payment' &&
          booking.status !== 'pending_details'
        ) {
          logStep("Invalid booking status", { status: booking.status });
          toast.error("Invalid booking status. Please contact support.");
          router.push("/");
          return;
        }

        // Gate ONLY on the actual detail fields — never on the status
        // text. If details are filled the booking belongs on the
        // confirmation page; the page will poll status and flip to the
        // "finalizing" state until finalize-booking promotes the row.
        // Previously we bounced back to /book/details whenever
        // status === 'pending_details', which caused a redirect loop
        // when finalize-booking hadn't yet been called (cold start,
        // brief client/server race, etc.).
        // A field is only "missing" when it's null / undefined / empty string.
        // Do NOT use `!booking[field]` — that treats 0 bedrooms (studio) or
        // 0 bathrooms as missing and bounces a fully-completed booking back
        // to /book/details in a loop.
        const requiredFields = ['address', 'city', 'state', 'bedrooms', 'bathrooms', 'dwelling_type'];
        const missingFields = requiredFields.filter((field) => {
          const v = booking[field];
          return v === null || v === undefined || v === "";
        });

        if (missingFields.length > 0) {
          logStep("Missing required fields - redirecting to property details", { missingFields, status: booking.status });
          toast.info("Payment received — finish your home details to confirm the booking.");
          router.push(`/book/details?booking_id=${bookingId}`);
          return;
        }

        // If payment_intent exists but status is still pending_payment, 
        // the payment might not have been verified yet
        if (booking.status === 'pending_payment' && booking.payment_intent_id) {
          logStep("Booking has payment intent but not confirmed - will verify payment");
          // Let the payment verification effect handle this
        }

        // All validations passed
        logStep("Booking validated successfully", { status: booking.status });
        setBookingId(bookingId);
        setBookingStatus(booking.status);
        setBookingValidated(true);

        // Hydrate the BookingContext from the persisted booking row.
        // Without this, customers who land here from an SMS / email
        // link with only `?booking_id=…` (i.e. no in-memory context)
        // see "Location: , , 21230" because the in-context address /
        // city / state were never populated. The DB always has the
        // truth — copy from there so the confirmation matches what
        // was actually saved.
        updateBookingData({
          address: booking.address || bookingData.address || "",
          city: booking.city || bookingData.city || "",
          state: booking.state || bookingData.state || "",
          zipCode: booking.zip_code || bookingData.zipCode || "",
          firstName: booking.first_name || bookingData.firstName || "",
          lastName: booking.last_name || bookingData.lastName || "",
          email: booking.email || bookingData.email || "",
          phone: booking.phone || bookingData.phone || "",
          homeSizeId: booking.home_size_id || bookingData.homeSizeId || "",
          serviceType: booking.service_type || bookingData.serviceType || "",
          serviceDate: booking.service_date || bookingData.serviceDate || "",
          timeSlot: booking.time_slot || bookingData.timeSlot || "",
          addOns: Array.isArray(booking.add_ons) ? booking.add_ons : (bookingData.addOns || []),
          membershipPlan: booking.membership_plan || bookingData.membershipPlan || "none",
          useCredit: typeof booking.uses_credit === "boolean" ? booking.uses_credit : (bookingData.useCredit || false),
          bedrooms: booking.bedrooms ?? bookingData.bedrooms,
          bathrooms: booking.bathrooms ?? bookingData.bathrooms,
          dwellingType: booking.dwelling_type || bookingData.dwellingType,
          bookingId,
        });

        // ─── Safety net: confirmation + receipt emails ──────────
        // The backend (stripe-webhook / finalize-booking) is
        // supposed to fire these when the row flips to
        // 'confirmed'. We've seen cases where the backend hits an
        // unhandled error inside its email try/catch and the row
        // ends up `confirmation_email_sent=false`. Dispatching
        // here on the client (only when the flag is false AND the
        // row is confirmed) makes the email send a hard guarantee
        // tied to the customer actually reaching this page. The
        // edge function is idempotent and we mark the row sent
        // immediately so a second tab open doesn't double-email.
        if (booking.status === "confirmed" && !booking.confirmation_email_sent) {
          (async () => {
            try {
              const balanceCents =
                booking.payment_option === "full"
                  ? 0
                  : Math.max(
                      0,
                      (booking.total_estimate_cents || 0) - (booking.deposit_cents || 0),
                    );

              await supabase.functions.invoke("send-booking-email", {
                body: {
                  type: "confirmation",
                  email: booking.email,
                  data: {
                    firstName: booking.first_name,
                    lastName: booking.last_name,
                    bookingId: booking.id,
                    serviceDate: booking.service_date,
                    timeSlot: booking.time_slot,
                    serviceType: booking.service_type,
                    homeSize: booking.home_size_id,
                    address: booking.address,
                    city: booking.city,
                    state: booking.state,
                    zipCode: booking.zip_code,
                    totalAmount: booking.total_estimate_cents,
                    depositAmount: booking.deposit_cents,
                    balanceAmount: balanceCents,
                    paymentOption: booking.payment_option,
                    useCredit: booking.uses_credit,
                    addOns: Array.isArray(booking.add_ons) ? booking.add_ons : [],
                  },
                },
              });

              await supabase.functions.invoke("send-booking-email", {
                body: {
                  type: "payment_receipt",
                  email: booking.email,
                  data: {
                    firstName: booking.first_name,
                    lastName: booking.last_name,
                    bookingId: booking.id,
                    serviceDate: booking.service_date,
                    timeSlot: booking.time_slot,
                    serviceType: booking.service_type,
                    totalAmount:
                      booking.payment_option === "full"
                        ? booking.total_estimate_cents -
                          (booking.full_payment_discount || 0)
                        : booking.deposit_cents,
                    balanceAmount: balanceCents,
                    paymentOption: booking.payment_option,
                  },
                },
              });

              await supabase
                .from("bookings")
                .update({
                  confirmation_email_sent: true,
                  confirmation_email_sent_at: new Date().toISOString(),
                })
                .eq("id", booking.id)
                .eq("confirmation_email_sent", false);

              setEmailSent(true);
              logStep("Confirmation + receipt emails dispatched from client safety net");
            } catch (emailErr) {
              console.warn("[BookingSuccess] safety-net email send failed", emailErr);
            }
          })();
        }

        // ─── Safety net: remaining-balance invoice ──────────────
        // Deposit-paid bookings need a hosted Stripe invoice for
        // the second half of the bill. The new flow auto-charges
        // the saved card when the cleaner marks complete, but
        // many customers prefer a click-to-pay link in their
        // inbox up-front. Firing the new edge function here
        // ensures the invoice is created (idempotently — it
        // short-circuits when `stripe_invoice_id` is already
        // populated).
        if (
          booking.status === "confirmed" &&
          booking.payment_option === "deposit" &&
          !booking.uses_credit &&
          !booking.stripe_invoice_id &&
          (booking.total_estimate_cents || 0) > (booking.deposit_cents || 0)
        ) {
          supabase.functions.invoke("send-remaining-balance-invoice", {
            body: { bookingId: booking.id },
          }).catch((invErr) => {
            console.warn("[BookingSuccess] remaining-balance invoice failed", invErr);
          });
        }

        // Safety net: if the row is still pending_details after our
        // gate above (details filled but status hasn't flipped yet),
        // kick finalize-booking ourselves and start polling for the
        // confirmed status. This handles the case where the
        // PropertyDetails save invoked finalize-booking but the call
        // didn't land before navigation (cold start, brief network
        // hiccup, etc.) — without this safety net we'd permanently
        // show the wrong status to a paid customer.
        if (booking.status === 'pending_details' || booking.status === 'pending_payment') {
          setIsFinalizing(true);
          // Fire-and-forget; the polling loop below picks up the
          // status flip whether we triggered it or the cron did.
          supabase.functions.invoke('finalize-booking', {
            body: { bookingId, trigger: 'success_page_safety_net' },
          }).catch((err) => logStep('finalize-booking safety-net failed', err));
        }
      } catch (error) {
        console.error("Error validating booking:", error);
        toast.error("Error validating booking. Please contact support.");
        router.push("/");
      } finally {
        setIsValidating(false);
      }
    };

    validateBooking();
  }, [searchParams, router]);

  // Check if Web Share API is available
  useEffect(() => {
    if (navigator.share) {
      setCanShare(true);
    }
  }, []);

  // Poll booking status while it's still finalizing. Once finalize-
  // booking promotes the row to 'confirmed' (typically within 1-3s),
  // the hero card flips from "Booking finalizing" → "Booking confirmed"
  // without the customer having to reload. Bails out after 30 attempts
  // (~60s) so a stuck booking doesn't poll forever.
  useEffect(() => {
    if (!bookingId || !bookingValidated) return;
    if (bookingStatus === 'confirmed' || bookingStatus === 'completed') return;

    let cancelled = false;
    let attempts = 0;
    const interval = setInterval(async () => {
      if (cancelled) return;
      attempts++;
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('status')
          .eq('id', bookingId)
          .single();
        if (error || cancelled) return;
        if (data?.status && data.status !== bookingStatus) {
          setBookingStatus(data.status);
        }
        if (data?.status === 'confirmed' || data?.status === 'completed') {
          setIsFinalizing(false);
          clearInterval(interval);
        }
      } catch (e) {
        logStep('Status poll error', e);
      }
      if (attempts >= 30) {
        // Stop polling but leave the UI in its current state so the
        // user can still navigate; the cron will finalize within
        // minutes if there's a backend hiccup.
        setIsFinalizing(false);
        clearInterval(interval);
      }
    }, 2000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [bookingId, bookingValidated, bookingStatus]);

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
            trackPurchase(
              pricing.total / 100,
              bookingData.serviceType,
              bookingData.membershipPlan || 'none',
              bookingData.zipCode
            );
            
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

  // Confirmation email is now sent server-side by stripe-webhook — no client-side email trigger needed

  // Store guest email in localStorage for easy account creation
  useEffect(() => {
    if (!user && bookingData.email) {
      localStorage.setItem('guestBookingEmail', bookingData.email);
    }
  }, [user, bookingData.email]);

  const handleReturnHome = () => {
    resetBookingData();
    router.push("/");
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
        <Card variant="outlined" className="max-w-md w-full shadow-card">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <RiLoader4Line className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h2 className="text-xl font-bold">
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

  // Derive the live status pill + headline copy from `bookingStatus`.
  // We're rendering a single hero across three states:
  //   • pending_details / pending_payment + isFinalizing → "Finalizing"
  //     (animated pulse, amber dot)
  //   • confirmed → "Booking confirmed" (green dot, check icon)
  //   • completed → "Service complete" (primary dot)
  const isConfirmed = bookingStatus === 'confirmed' || bookingStatus === 'completed';
  const heroTone = isConfirmed
    ? { bg: 'bg-success/10', icon: 'text-success', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Confirmed' }
    : { bg: 'bg-amber-100', icon: 'text-amber-600', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Finalizing' };
  const heroTitle = isConfirmed
    ? (bookingData.membershipPlan !== 'none' ? 'Welcome to Novara!' : 'Booking Confirmed!')
    : 'Locking In Your Booking…';
  const heroSubtitle = isConfirmed
    ? (bookingData.membershipPlan !== 'none'
        ? 'Your membership is active and your first credit is ready to use.'
        : bookingData.useCredit
        ? 'Your booking is confirmed with your membership credit.'
        : bookingData.paymentOption === 'full'
        ? 'Your payment is complete — you saved 10% by paying in full!'
        : 'Thank you for choosing NovaraCleaning. We can\'t wait to make your home sparkle.')
    : 'Your payment cleared and your home details are in. We\'re assigning your team and writing your confirmation email right now — usually under a minute.';

  return (
    <div className="min-h-screen bg-gradient-hero px-2 md:px-4 py-4 md:py-12 pb-24 md:pb-12">
      <SEO title="Booking Confirmed" description="Your cleaning is confirmed! Check your email for details." noindex />
      <div className="container max-w-3xl mx-auto">
        {/* Show verification error if payment failed */}
        {verificationError && (
          <Card className="mb-6 border-destructive/50 bg-destructive/5">
            <CardContent className="pt-6 flex items-start gap-3">
              <RiErrorWarningLine className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
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

        {/* Live finalize banner — collapses once finalize-booking flips
            the row to 'confirmed'. The bookingStatus poll keeps this
            in sync without a page reload. */}
        {isFinalizing && !isConfirmed && (
          <Card className="mb-4 border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/20 shadow-md animate-fade-in">
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              </div>
              <div className="flex-1 text-sm">
                <p className="font-semibold text-amber-900 dark:text-amber-100">Finalizing your booking…</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">Confirmation email + cleaner assignment in progress. This page will refresh automatically.</p>
              </div>
              <RiLoader4Line className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0" />
            </CardContent>
          </Card>
        )}

        <Card className="shadow-xl border-primary/10 overflow-hidden animate-fade-in">
          {/* Brand gradient strip — keeps the hero feeling on-brand */}
          <div className="h-1.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
          <CardHeader className="text-center space-y-3 md:space-y-4 pb-4 md:pb-8 pt-6 md:pt-8">
            <div className={cn(
              "mx-auto w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center mb-2 md:mb-4 animate-in zoom-in duration-500 shadow-md",
              heroTone.bg,
            )}>
              {isConfirmed ? (
                <RiCheckboxCircleLine className={cn("w-9 h-9 md:w-12 md:h-12", heroTone.icon)} />
              ) : (
                <RiLoader4Line className={cn("w-9 h-9 md:w-12 md:h-12 animate-spin", heroTone.icon)} />
              )}
            </div>
            <div className="flex justify-center">
              <span className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] border rounded-full px-3 py-1",
                heroTone.pill,
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full", heroTone.dot)} />
                {heroTone.label}
              </span>
            </div>
            <CardTitle className="text-xl md:text-3xl font-bold tracking-tight">
              {heroTitle}
            </CardTitle>
            <CardDescription className="text-xs md:text-base max-w-md mx-auto">
              {heroSubtitle}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4 md:space-y-8">
            {/* Booking Details Card */}
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader className="pb-3 md:pb-4">
                <CardTitle className="text-base md:text-xl font-semibold flex items-center gap-2">
                  <RiCalendarLine className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                  Your Booking Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 md:space-y-4">
                <div className="grid gap-2 md:gap-4">
                  <div className="flex items-start gap-3">
                    <RiCalendarLine className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Date</p>
                      <p className="font-semibold text-sm md:text-base">
                        {bookingData.serviceDate && format(new Date(bookingData.serviceDate), "EEEE, MMMM d, yyyy")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <RiTimeLine className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Time Window</p>
                      <p className="font-semibold text-sm md:text-base">{getTimeSlotLabel(bookingData.timeSlot)}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <RiHomeLine className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Service</p>
                      <p className="font-semibold text-sm md:text-base">{serviceTier?.label} • {homeSize?.label}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <RiMapPinLine className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-muted-foreground">Location</p>
                      <p className="font-semibold text-sm md:text-base">
                        {bookingData.address}, {bookingData.city}, {bookingData.state} {bookingData.zipCode}
                      </p>
                    </div>
                  </div>

                  {(sessionId || paymentIntent) && (
                    <div className="flex items-start gap-3">
                      <RiBankCardLine className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
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
                  <div className="flex items-center gap-2 text-xs md:text-sm text-success bg-success/10 p-2 md:p-3 rounded-lg border border-success/20">
                    <RiMailLine className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" />
                    <span>✉️ Confirmation email sent to {bookingData.email}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full h-10 md:h-12 text-xs md:text-base">
                        <RiCalendarLine className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                        Add to Calendar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuItem onClick={() => handleAddToCalendar('google')}>
                        <RiCalendarLine className="w-4 h-4 mr-2" />
                        Google Calendar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddToCalendar('outlook')}>
                        <RiCalendarLine className="w-4 h-4 mr-2" />
                        Outlook Calendar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAddToCalendar('ical')}>
                        <RiDownloadLine className="w-4 h-4 mr-2" />
                        Download .ics file
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button 
                    variant="outline" 
                    className="w-full h-10 md:h-12 text-xs md:text-base"
                    onClick={handleShare}
                  >
                    <RiShareLine className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    Share
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Referral Section */}
            <ReferralSection email={bookingData.email} />

            {/* Customer Portal / Account Creation Card */}
            <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
              <CardHeader className="pb-3 md:pb-4">
                <CardTitle className="text-base md:text-xl flex items-center gap-2">
                  {user ? (
                    <>
                      <RiSettings3Line className="w-5 h-5 text-primary" />
                      Manage Your Account
                    </>
                  ) : (
                    <>
                      <RiUserAddLine className="w-5 h-5 text-primary" />
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
                    <RiSettings3Line className="w-4 h-4 mr-2" />
                    {isOpeningPortal ? 'Opening...' : 'Open Customer Portal'}
                    <RiExternalLinkLine className="w-4 h-4 ml-2" />
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-2 text-xs md:text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Track all your bookings in one place</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Manage payment methods securely</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-success flex-shrink-0" />
                        <span>View billing history and receipts</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiCheckboxCircleLine className="w-4 h-4 text-success flex-shrink-0" />
                        <span>Update future appointments</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => router.push('/auth')}
                      className="w-full h-12 text-sm md:text-base bg-gradient-primary shadow-elegant"
                    >
                      <RiUserAddLine className="w-4 h-4 mr-2" />
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
                    <RiMailLine className="w-5 h-5 text-primary" />
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
                    <RiCalendarLine className="w-5 h-5 text-primary" />
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
                    <RiHomeLine className="w-5 h-5 text-primary" />
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
                <RiHomeLine className="mr-2 w-5 h-5" />
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
          <RiHomeLine className="mr-2 w-5 h-5" />
          Return to Home
        </Button>
      </div>
    </div>
  );
}
