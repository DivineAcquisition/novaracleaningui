"use client";
import {
  RiArrowDownSLine,
  RiArrowLeftLine,
  RiBankCardLine,
  RiCalendarLine,
  RiCheckLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiGiftLine,
  RiLoader4Line,
  RiLockLine,
  RiMapPinLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiShieldLine,
  RiSparklingLine,
  RiStarLine,
  RiTimeLine
} from "@remixicon/react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/contexts/BookingContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { BookingHeader } from "@/components/booking/BookingHeader";
import { BottomNavigation } from "@/components/booking/BottomNavigation";
// PaymentComparison retired — customers always pay 50% deposit; the
// remaining balance is auto-charged after completion.
// SavingsVisualizer retired — replaced by the inline pricing breakdown
// card below (original strikethrough + discounts + 50% deposit + remaining).
import { Skeleton } from "@/components/ui/skeleton";
import { calculatePrice, HOME_SIZE_RANGES, SERVICE_TIER_PRICING, ADD_ONS, MEMBERSHIP_PLANS, getEstimatedHours } from "@/lib/pricing-system";
import { findBestPromoCode, formatPromoSavings, getPromoRecommendation, type EligiblePromo } from "@/lib/promo-auto-apply";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { getStripePromise } from "@/lib/stripe-client";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { PageTransition } from "@/components/booking/PageTransition";
import { trackInitiateCheckout } from "@/lib/meta-pixel";
import { SEO } from "@/components/SEO";
import { GoogleGuaranteedBadge } from "@/components/GoogleGuaranteedBadge";
import { getStoredTrackingData, getTrackingPayload } from "@/hooks/useUTMTracking";
import {
  clearCheckoutSnapshot,
  hasCheckoutPrerequisites,
  loadCheckoutSnapshot,
  saveCheckoutSnapshot,
} from "@/lib/checkout-funnel-guard";
const BOOKING_STEPS = [{
  number: 1,
  label: "Location",
  path: "/book/zip"
}, {
  number: 2,
  label: "Home Size",
  path: "/book/sqft"
}, {
  number: 3,
  label: "Service",
  path: "/book/offer"
}, {
  number: 4,
  label: "Checkout",
  path: "/book/checkout"
}, {
  number: 5,
  label: "Details",
  path: "/book/details"
}, {
  number: 6,
  label: "Confirm",
  path: "/book/confirmation"
}];
const TIME_SLOT_LABELS: Record<string, string> = {
  "8-12": "8:00 AM - 12:00 PM",
  "12-16": "12:00 PM - 4:00 PM",
  "16-20": "4:00 PM - 8:00 PM"
};
export default function BookingCheckout() {
  const router = useRouter();
  const {
    bookingData,
    currentStep,
    updateBookingData,
    setCurrentStep,
  } = useBooking();
  const {
    user
  } = useAuth();
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);
  const stripePromise = useMemo(() => getStripePromise(), []);
  const paymentInitStarted = useRef(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  // Default to true so the initial render shows the 50%-off price that
  // most first-time customers will actually be charged. The async
  // checkNewCustomer() query below flips it to false only if the email
  // already has a confirmed/completed booking — in which case the
  // priced-inputs useEffect above will re-init Stripe with the new
  // (un-discounted) amount so the Pay button stays in sync.
  const [isNewCustomer, setIsNewCustomer] = useState(true);
  // Gate the Stripe payment-intent creation until checkNewCustomer()
  // resolves. Without this, a RETURNING customer would briefly get a
  // payment intent created at the new-customer (discounted) amount, then
  // have it torn down and re-created once the check finished — a wasted
  // intent and a flash of the wrong price. Mirrors walletBalanceReady.
  const [newCustomerChecked, setNewCustomerChecked] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;

  // Referral Code state
  const [referralInput, setReferralInput] = useState(bookingData.referralCode || '');
  const [isValidatingReferral, setIsValidatingReferral] = useState(false);
  const [appliedReferralCode, setAppliedReferralCode] = useState<string | null>(null);
  const [referralDiscount, setReferralDiscount] = useState(0);

  // Wallet credit (customer_credits ledger) state — let the customer
  // optionally apply their account credit balance toward this booking.
  const [walletBalanceCents, setWalletBalanceCents] = useState(0);
  const [applyWallet, setApplyWallet] = useState(true);
  const [walletBalanceReady, setWalletBalanceReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function loadBalance() {
      const email = bookingData.email?.trim();
      if (!email) {
        setWalletBalanceCents(0);
        setWalletBalanceReady(true);
        return;
      }
      setWalletBalanceReady(false);
      try {
        const { data: cust } = await supabase
          .from("customers")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        if (!cust?.id) {
          setWalletBalanceCents(0);
          return;
        }
        const { data: bal } = await (supabase.rpc as any)(
          "get_customer_credit_balance",
          { _customer_id: cust.id },
        );
        if (cancelled) return;
        const cents = Number((bal as { balance_cents?: number } | null)?.balance_cents || 0);
        setWalletBalanceCents(cents);
      } catch (e) {
        console.warn("[Checkout] wallet balance lookup failed", e);
      } finally {
        if (!cancelled) setWalletBalanceReady(true);
      }
    }
    loadBalance();
    return () => { cancelled = true; };
  }, [bookingData.email]);

  // Auto-apply referral code from BookingContext (set on Zip page)
  useEffect(() => {
    if (bookingData.referralCode && !appliedReferralCode) {
      setReferralInput(bookingData.referralCode);
      // Auto-validate
      const autoApply = async () => {
        setIsValidatingReferral(true);
        try {
          const { data: referral } = await supabase
            .from('referrals')
            .select('*')
            .eq('code', bookingData.referralCode!.toUpperCase())
            .eq('status', 'pending')
            .single();
          if (referral) {
            const discount = (referral.credit_cents || 2000) / 100;
            setReferralDiscount(discount);
            setAppliedReferralCode(bookingData.referralCode!.toUpperCase());
            toast.success(`Referral code applied! $${discount.toFixed(2)} off`);
          }
        } catch (err) {
          console.error('Auto-apply referral error:', err);
        } finally {
          setIsValidatingReferral(false);
        }
      };
      autoApply();
    }
  }, [bookingData.referralCode]);

  // Promo Code state
  const [promoInput, setPromoInput] = useState('');
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [autoAppliedPromo, setAutoAppliedPromo] = useState<EligiblePromo | null>(null);
  const [isAutoApplying, setIsAutoApplying] = useState(false);
  const [showPromoSuggestions, setShowPromoSuggestions] = useState(false);
  const [discountSectionOpen, setDiscountSectionOpen] = useState(false);
  const isScheduleSelected = !!bookingData.serviceDate && !!bookingData.timeSlot;
  // Customers always pay a 50% deposit at checkout — the pay-in-full
  // option has been retired. The remaining 50% is auto-charged to the
  // saved card when the cleaner marks the service complete.
  const effectivePaymentOption: 'deposit' = 'deposit';
  const isNewMembershipSignup = bookingData.membershipPlan !== 'none' && !bookingData.useCredit;
  const isMemberUsingCredit = bookingData.useCredit === true;

  // Pin funnel step + persist a session snapshot so schedule/service
  // selections survive idle time on this page (browser back, tab discard,
  // or accidental BookingContext churn).
  useEffect(() => {
    setCurrentStep(4);

    if (bookingData.paymentOption !== "deposit") {
      updateBookingData({ paymentOption: "deposit" });
    }

    if (hasCheckoutPrerequisites(bookingData)) {
      saveCheckoutSnapshot(bookingData);
      return;
    }

    const snap = loadCheckoutSnapshot();
    if (snap?.serviceDate && snap?.timeSlot) {
      updateBookingData(snap);
      return;
    }

    toast.error("Please choose your service and appointment time first.");
    router.replace("/book/offer");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (hasCheckoutPrerequisites(bookingData)) {
      saveCheckoutSnapshot(bookingData);
    }
  }, [
    bookingData.zipCode,
    bookingData.city,
    bookingData.state,
    bookingData.homeSizeId,
    bookingData.serviceType,
    bookingData.serviceDate,
    bookingData.timeSlot,
    bookingData.startTime,
    bookingData.endTime,
    bookingData.firstName,
    bookingData.lastName,
    bookingData.email,
    bookingData.phone,
    bookingData.addOns,
    bookingData.membershipPlan,
  ]);

  // If schedule fields disappear while still on checkout, restore from
  // the snapshot instead of showing "pick a date" and nudging to offer.
  useEffect(() => {
    if (bookingData.serviceDate && bookingData.timeSlot) return;
    const snap = loadCheckoutSnapshot();
    if (snap?.serviceDate && snap?.timeSlot) {
      updateBookingData(snap);
    }
  }, [bookingData.serviceDate, bookingData.timeSlot, updateBookingData]);

  useEffect(() => {
    getStripePromise().catch((err: unknown) => {
      console.error("Stripe initialization failed:", err);
      setInitError("Unable to load payment system. Please try again.");
    });
  }, []);

  // Discourage accidental browser-back / trackpad swipe away from checkout.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    history.pushState({ checkoutGuard: true }, "", url);

    const onPopState = () => {
      const leave = window.confirm(
        "Leave checkout? Your appointment is not reserved until you pay the deposit.",
      );
      if (!leave) {
        history.pushState({ checkoutGuard: true }, "", url);
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Check if new customer and auto-apply best promo
  useEffect(() => {
    // Re-gate payment init whenever the email changes — we don't know
    // the customer's status for the new email yet.
    setNewCustomerChecked(false);
    const checkNewCustomer = async () => {
      if (!bookingData.email) {
        // No email to check against — unblock so flows that somehow
        // reach init without an email aren't deadlocked (the init
        // effect still requires an email via hasRequiredData).
        setNewCustomerChecked(true);
        return;
      }
      try {
        const {
          data
        } = await supabase.from('bookings').select('id, status').eq('email', bookingData.email).in('status', ['confirmed', 'completed']).limit(1);
        const isNew = !data || data.length === 0;
        setIsNewCustomer(isNew);
        await autoApplyBestPromo(isNew);
      } finally {
        setNewCustomerChecked(true);
      }
    };
    checkNewCustomer();
  }, [bookingData.email]);
  // v4: promo-code auto-apply is intentionally a no-op. All customer
  // discounts now come exclusively from the per-service-tier rules in
  // src/lib/pricing.ts (standard 15%, deep 25%, combo 50% off standard
  // portion). Stacking a DB promo would double-discount.
  const autoApplyBestPromo = async (_isNew: boolean) => {
    void _isNew;
    return;
  };

  const confirmLeaveCheckout = () =>
    window.confirm(
      "Go back to service selection? Your appointment is not reserved until you pay the deposit.",
    );

  const handleBack = () => {
    if (!confirmLeaveCheckout()) return;
    router.push("/book/offer");
  };

  // Get pricing data
  const homeSize = HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  const serviceTier = SERVICE_TIER_PRICING[bookingData.serviceType as keyof typeof SERVICE_TIER_PRICING];
  const membership = MEMBERSHIP_PLANS[bookingData.membershipPlan as keyof typeof MEMBERSHIP_PLANS];
  const depositPricing = calculatePrice(bookingData.homeSizeId, bookingData.serviceType, bookingData.addOns, bookingData.membershipPlan, bookingData.useCredit, isNewCustomer, promoDiscount + referralDiscount);
  // fullPaymentPricing removed — pay-in-full is no longer a customer option.

  // Handle Referral Code
  const handleApplyReferral = async () => {
    if (!referralInput.trim()) return;
    setIsValidatingReferral(true);
    try {
      const {
        data: referral,
        error
      } = await supabase.from('referrals').select('*').eq('code', referralInput.toUpperCase()).eq('status', 'pending').single();
      if (error || !referral) {
        toast.error('Invalid or already used referral code');
        return;
      }
      // v4: referrals no longer discount the bookee — the referrer
      // gets a credit when this booking completes (see complete-booking).
      // We still capture the code on the booking row so the reward
      // attribution works.
      setReferralDiscount(0);
      setAppliedReferralCode(referralInput.toUpperCase());
      updateBookingData({
        referralCode: referralInput.toUpperCase(),
      });
      toast.success(
        "Referral attached — when your booking completes, your friend gets a credit.",
      );
    } catch (err) {
      toast.error('Error validating referral code');
    } finally {
      setIsValidatingReferral(false);
    }
  };
  const handleRemoveReferral = () => {
    setReferralInput('');
    setReferralDiscount(0);
    setAppliedReferralCode(null);
    updateBookingData({
      referralCode: undefined
    });
    // Re-init Stripe so the Pay button reverts to the un-discounted amount.
    setClientSecret(null);
    setBookingId(null);
    setPaymentAmount(0);
    paymentInitStarted.current = false;
    toast.info('Referral code removed');
  };

  // Handle Promo Code
  const handleApplyPromo = async () => {
    if (!promoInput.trim()) return;
    setIsValidatingPromo(true);
    try {
      const {
        data: promo,
        error
      } = await supabase.from('promo_codes').select('*').eq('code', promoInput.toUpperCase()).eq('active', true).single();
      if (error || !promo) {
        toast.error('Invalid promo code');
        return;
      }
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
        toast.error('This promo code has expired');
        return;
      }
      if (promo.applies_to === 'new_customers' && !isNewCustomer) {
        toast.error('This code is only for new customers');
        return;
      }
      // v4: promo codes no longer reduce the price — discounts are
      // baked into the per-service-tier rate (15% std / 25% deep /
      // 50% off std portion of combo). We keep the code on the booking
      // for reporting only.
      setPromoDiscount(0);
      setAppliedPromoCode(promoInput.toUpperCase());
      setAutoAppliedPromo(null);
      updateBookingData({
        promoCode: promoInput.toUpperCase()
      });
      // No need to re-init Stripe — v4 promo codes carry no discount.
      toast.success("Promo code attached for our records — the published rate already reflects the best available price.");
      setShowPromoSuggestions(false);
    } catch (err) {
      toast.error('Error validating promo code');
    } finally {
      setIsValidatingPromo(false);
    }
  };
  const handleRemovePromo = () => {
    setPromoInput('');
    setPromoDiscount(0);
    setAppliedPromoCode(null);
    setAutoAppliedPromo(null);
    updateBookingData({
      promoCode: undefined
    });
    // Re-init Stripe so the Pay button reverts to the un-discounted amount.
    setClientSecret(null);
    setBookingId(null);
    setPaymentAmount(0);
    paymentInitStarted.current = false;
    toast.info('Promo code removed');
  };
  // handlePaymentOptionChange removed — the customer no longer chooses a
  // payment option. The deposit amount is fixed at 50% of the total.
  const handleMembershipCheckout = async () => {
    setIsCreatingIntent(true);
    setInitError(null);
    try {
      const {
        data,
        error
      } = await supabase.functions.invoke("create-checkout", {
        body: {
          bookingData
        }
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
        toast.success("Redirecting to secure checkout...");
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      setInitError(error.message || "Failed to create checkout session");
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setIsCreatingIntent(false);
    }
  };
  const handleInitializePayment = async (attempt = 0) => {
    const email = bookingData.email?.trim();
    if (!email || !bookingData.homeSizeId) {
      console.log('[Checkout] Missing required data, skipping payment init');
      paymentInitStarted.current = false;
      return;
    }
    if (isCreatingIntent && attempt === 0) return;
    setIsCreatingIntent(true);
    if (attempt === 0) setInitError(null);

    // Pull attribution from localStorage (populated by UTMTracker
    // since the customer's first visit) so the booking row stamps
    // the same UTM/landing/referrer values the lead-capture event
    // sent to GHL.
    const tracking = getStoredTrackingData();
    const trackingPayload = getTrackingPayload();

    // Build payload with both email fields for compatibility.
    // Hard-pin paymentOption to 'deposit' so a stale 'full' value in
    // BookingContext (from before the Pay-in-Full UI was retired) can't
    // make the server charge the full amount.
    const payload = {
      ...bookingData,
      email,
      customerEmail: email, // Also send as customerEmail for backward compatibility
      paymentOption: 'deposit' as const,
      tracking: trackingPayload,
      utmSource: tracking.utm_source || undefined,
      utmMedium: tracking.utm_medium || undefined,
      utmCampaign: tracking.utm_campaign || undefined,
      utmContent: tracking.utm_content || undefined,
      utmTerm: tracking.utm_term || undefined,
      landingPage: tracking.landing_page || undefined,
      referrer: tracking.referrer || undefined,
      fbclid: tracking.fbclid || undefined,
      gclid: tracking.gclid || undefined,
      firstVisitTimestamp: tracking.first_visit_timestamp || undefined,
      // Apply wallet credit (capped server-side to balance + post-promo
      // total). create-payment-intent reserves the credit at quote time
      // and a DB trigger deducts it from the customer_credits ledger
      // when the payment confirms.
      applyWalletCents: applyWallet ? walletBalanceCents : 0,
    };
    const FUNCTION_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sxdraeptzuamsgjcvfeg.supabase.co'}/functions/v1/create-payment-intent`;
    const API_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I';
    try {
      console.log(`[Checkout] Initializing payment intent (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      let data: any = null;
      let invokeError: Error | null = null;

      // Try supabase.functions.invoke first
      try {
        const result = await supabase.functions.invoke("create-payment-intent", {
          body: payload
        });
        if (result.error) {
          invokeError = new Error(result.error.message || "Invoke failed");
        } else {
          data = result.data;
        }
      } catch (err: any) {
        console.warn('[Checkout] Invoke failed, trying direct fetch...', err.message);
        invokeError = err;
      }

      // Fallback to direct fetch if invoke failed
      if (!data && invokeError) {
        console.log('[Checkout] Using direct fetch fallback');
        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Payment service error: ${response.status} - ${errorText}`);
        }
        data = await response.json();
      }
      if (!data?.clientSecret) {
        const errorMsg = data?.error || data?.details || "No payment intent data received";
        console.error('[Checkout] Invalid response:', data);
        throw new Error(errorMsg);
      }
      console.log('[Checkout] Payment intent created successfully');
      setClientSecret(data.clientSecret);
      setPaymentAmount(data.amount);
      setBookingId(data.bookingId);
      trackInitiateCheckout(data.amount / 100);
      setRetryCount(0); // Reset retry count on success
      setIsCreatingIntent(false);
    } catch (error: any) {
      console.error('[Checkout] Payment init error:', error);

      // Retry with exponential backoff
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`[Checkout] Retrying in ${delay}ms...`);
        setRetryCount(attempt + 1);
        setTimeout(() => {
          setIsCreatingIntent(false);
          handleInitializePayment(attempt + 1);
        }, delay);
        return;
      }

      // Final failure after all retries exhausted
      setInitError(error.message || "Payment service unavailable. Please try again.");
      toast.error("Payment setup failed. Please try again.");
      setRetryCount(0);
      setIsCreatingIntent(false);
      paymentInitStarted.current = false;
    }
  };
  const handleRetryPayment = () => {
    setClientSecret(null);
    setInitError(null);
    setRetryCount(0);
    paymentInitStarted.current = false;
    handleInitializePayment(0);
  };
  const handlePaymentSuccess = () => {
    toast.success("Payment successful!");
    const id = bookingId || bookingData.bookingId;
    if (id) {
      updateBookingData({ bookingId: id });
    }
    clearCheckoutSnapshot();
    if (!id) {
      toast.error("Payment received but booking id is missing — contact support@novaracleaning.com");
      return;
    }
    router.replace(`/book/details?booking_id=${id}`);
  };


  // Initialize payment when all required fields are present
  useEffect(() => {
    const email = bookingData.email?.trim();
    const hasRequiredData = email && bookingData.homeSizeId && bookingData.serviceDate && bookingData.timeSlot;
    if (!hasRequiredData) {
      console.log('[Checkout] Waiting for required data before initializing payment', {
        hasEmail: !!email,
        hasHomeSizeId: !!bookingData.homeSizeId,
        hasServiceDate: !!bookingData.serviceDate,
        hasTimeSlot: !!bookingData.timeSlot
      });
      return;
    }

    if (clientSecret) return;
    if (!walletBalanceReady) return;
    if (!newCustomerChecked) return;
    if (isCreatingIntent || initError) return;
    if (paymentInitStarted.current) return;
    paymentInitStarted.current = true;
    handleInitializePayment();
  }, [
    bookingData.paymentOption,
    bookingData.email,
    bookingData.homeSizeId,
    bookingData.serviceDate,
    bookingData.timeSlot,
    clientSecret,
    walletBalanceReady,
    newCustomerChecked,
    isCreatingIntent,
    initError,
    isNewCustomer,
    applyWallet,
    walletBalanceCents,
  ]);

  // Re-mount Stripe when priced inputs change after the PI was created
  // (e.g. returning-customer check finishes, wallet toggle).
  useEffect(() => {
    if (!clientSecret || paymentAmount <= 0) return;
    const expectedCents = Math.max(100, Math.round(depositPricing.deposit * 100));
    if (Math.abs(expectedCents - paymentAmount) > 1) {
      setClientSecret(null);
      setBookingId(null);
      setPaymentAmount(0);
      paymentInitStarted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositPricing.deposit, isNewCustomer, applyWallet, walletBalanceCents]);
  const currentAmount = depositPricing.deposit;
  const totalSavings = (depositPricing.newCustomerDiscount || 0) + (depositPricing.membershipDiscount || 0) + promoDiscount + referralDiscount;
  const addOnLabels = bookingData.addOns?.map(id => ADD_ONS[id as keyof typeof ADD_ONS]?.label).filter(Boolean) || [];
  return <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
        <SEO title="Checkout" description="Complete your booking with a secure 50% deposit. Balance auto-charged after service." noindex />
        <BookingHeader currentStep={currentStep} totalSteps={6} stepLabel="Checkout" />
        
        <div className="container max-w-2xl mx-auto px-4 py-6 space-y-6">
          

          {/* Review & Reserve header — promo-led layout matching the
              new offer page. Replaces the old "Secure Checkout" badge.
              Google Guaranteed sits immediately under the subtitle. */}
          <div className="text-center space-y-3">
            <h1 className="font-jakarta text-2xl md:text-3xl font-extrabold">
              Review &amp; Reserve
            </h1>
            <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
              Lock in your cleaning with a 50% deposit today. Your card is securely saved on file — the remaining 50% is automatically charged after your cleaning is complete.
            </p>
            <div className="flex justify-center pt-1">
              <GoogleGuaranteedBadge variant="compact" />
            </div>
          </div>

          {/* Booking Summary card — single card replaces the old
              two-column Service Details + Schedule grid. */}
          <Card className="border-primary/20 shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RiSparklingLine className="w-4 h-4 text-primary" />
                Booking Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service</span>
                <span className="font-semibold">{serviceTier?.label || "Standard"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Home Size</span>
                <span className="font-semibold">{homeSize?.label || "N/A"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Duration</span>
                <span className="font-semibold">{getEstimatedHours(bookingData.homeSizeId)} hours</span>
              </div>
              {membership && bookingData.membershipPlan !== "none" && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Membership</span>
                  <Badge className="bg-primary/10 text-primary border-primary/40 text-xs">
                    {membership.label}
                  </Badge>
                </div>
              )}
              {addOnLabels.length > 0 && (
                <div className="pt-1 border-t">
                  <span className="text-muted-foreground text-xs">Add-ons</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {addOnLabels.map((label, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{label}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {bookingData.serviceDate && bookingData.timeSlot ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <RiCalendarLine className="w-3.5 h-3.5" />
                      Date
                    </span>
                    <span className="font-semibold">
                      {format(new Date(bookingData.serviceDate + "T12:00:00"), "EEEE, MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <RiTimeLine className="w-3.5 h-3.5" />
                      Arrival
                    </span>
                    <span className="font-semibold">{bookingData.timeSlot}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <RiMapPinLine className="w-3.5 h-3.5" />
                      Location
                    </span>
                    <span className="font-semibold">ZIP {bookingData.zipCode}</span>
                  </div>
                </>
              ) : (
                <div className="text-center py-3 space-y-2">
                  <p className="text-muted-foreground text-sm">No schedule selected</p>
                  <Button variant="outline" size="sm" onClick={() => router.push("/book/offer")}>
                    <RiArrowLeftLine className="w-4 h-4 mr-2" />
                    Pick a Date &amp; Time
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gate: Show skeleton/message if schedule not selected */}
          {!isScheduleSelected && <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardContent className="py-8 text-center space-y-4">
                <RiCalendarLine className="w-12 h-12 text-amber-500 mx-auto" />
                <div>
                  <h3 className="font-semibold text-lg">Schedule Required</h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    Please select a date and time for your cleaning before proceeding to payment.
                  </p>
                </div>
                <Button onClick={() => router.push('/book/offer')} className="bg-gradient-primary">
                  <RiCalendarLine className="w-4 h-4 mr-2" />
                  Select Your Appointment
                </Button>
              </CardContent>
            </Card>}

          {/* Show payment sections only when schedule is selected */}
          {isScheduleSelected && <>
          {/* ─── Pricing breakdown ──────────────────────────────────
              One canonical card. NO strikethrough "Original cost" line
              (per product direction — the original-vs-discounted story
              already lives on the offer card; here we just show what
              the customer actually owes). Just the post-discount
              service total, the 50% deposit due NOW, and the remaining
              balance auto-charged after service. */}
          <Card className="border-2 border-primary/30 bg-primary/[0.04]">
            <CardContent className="p-4 md:p-5 space-y-3">
              {/* Optional discount-applied line — shown only when a
                  user-entered promo or referral code is in effect, so
                  the customer sees the savings register on this page. */}
              {(promoDiscount + referralDiscount) > 0 && (
                <div className="flex items-baseline justify-between text-sm text-primary font-medium">
                  <span className="flex items-center gap-1">
                    <RiPriceTag3Line className="w-3.5 h-3.5" />
                    {appliedPromoCode && appliedReferralCode
                      ? `Promo + referral applied`
                      : appliedPromoCode
                        ? `Promo ${appliedPromoCode} applied`
                        : `Referral ${appliedReferralCode} applied`}
                  </span>
                  <span>-${(promoDiscount + referralDiscount).toFixed(2)}</span>
                </div>
              )}

              {/* Service total after discounts */}
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">Service total</span>
                <span className="font-semibold">${depositPricing.total.toFixed(2)}</span>
              </div>

              <Separator />

              {/* PAY NOW — 50% deposit, headline */}
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-gradient-primary text-white text-[10px] uppercase tracking-wider px-2 py-0.5">
                      50% Deposit
                    </Badge>
                    <span className="font-bold text-base">Pay now</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Charged to your card today
                  </p>
                </div>
                <span className="text-2xl md:text-3xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                  ${depositPricing.deposit.toFixed(2)}
                </span>
              </div>

              {/* Balance after service completion */}
              <div className="flex items-baseline justify-between rounded-md bg-background/60 border border-primary/15 px-3 py-2">
                <div>
                  <div className="font-semibold text-sm">Remaining balance</div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Auto-charged after your cleaning is complete
                  </p>
                </div>
                <span className="text-lg md:text-xl font-bold text-foreground">
                  ${depositPricing.balanceDue.toFixed(2)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* What's Included card — sits between the payment-option
              toggle and the promo/payment cards. Ported from the
              AlphaLux layout, recoloured to our primary purple. */}
          <Card className="border-primary/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RiStarLine className="w-4 h-4 text-primary" />
                What&apos;s Included
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div className="flex items-center gap-2">
                <RiTimeLine className="h-4 w-4 text-primary" />
                <span className="font-semibold">
                  {getEstimatedHours(bookingData.homeSizeId)} hours estimated
                </span>
              </div>

              <div className="space-y-2.5">
                <h3 className="font-semibold text-sm">Premium features</h3>
                <div className="grid gap-1.5">
                  {[
                    "Insured & bonded 2-person team",
                    "Eco-friendly products & HEPA vacuums",
                    "All supplies and equipment included",
                    "48-hour re-clean guarantee",
                  ].map((feature) => (
                    <div key={feature} className="flex items-start gap-2">
                      <RiCheckboxCircleLine className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-2.5">
                <h3 className="font-semibold text-sm">
                  {bookingData.serviceType === "combo"
                    ? "Cleaning checklist (Visit 1 — Deep)"
                    : "Cleaning checklist"}
                </h3>
                <div className="grid gap-1.5">
                  {(bookingData.serviceType === "deep" ||
                  bookingData.serviceType === "combo"
                    ? [
                        "Kitchen: deep clean appliances, cabinets, countertops",
                        "Bathrooms: scrub tiles, sanitize fixtures, polish mirrors",
                        "Living areas: dust surfaces, vacuum carpets, mop floors",
                        "Bedrooms: full refresh and detailed dusting",
                        "Interior windows, sills, and baseboards",
                      ]
                    : [
                        "Kitchen: countertops, sink, stovetop, appliance exteriors",
                        "Bathrooms: sanitize fixtures, polish mirrors, mop floors",
                        "Living areas: dust surfaces, vacuum carpets, mop floors",
                        "Bedrooms: dust furniture, make beds on request",
                        "Trash removal and general tidying",
                      ]
                  ).map((item) => (
                    <div key={item} className="flex items-start gap-2">
                      <RiCheckLine className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Discount Codes Section - Collapsible */}
          <Collapsible open={discountSectionOpen} onOpenChange={setDiscountSectionOpen}>
            <Card className="border-primary/10">
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <RiPriceTag3Line className="w-4 h-4 text-primary" />
                      Have a Promo or Referral Code?
                      {(appliedPromoCode || appliedReferralCode) && <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                          Applied
                        </Badge>}
                    </CardTitle>
                    <RiArrowDownSLine className={cn("w-4 h-4 text-muted-foreground transition-transform", discountSectionOpen && "rotate-180")} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 pt-0">
                  {/* Referral Code */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <RiGiftLine className="w-4 h-4 text-primary" />
                      Referral Code
                    </p>
                    {appliedReferralCode ? <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                          <RiGiftLine className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-green-700 dark:text-green-400">{appliedReferralCode}</span>
                          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">
                            -${referralDiscount.toFixed(2)}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemoveReferral}>
                          Remove
                        </Button>
                      </div> : <div className="flex gap-2">
                        <Input placeholder="Enter referral code" value={referralInput} onChange={e => setReferralInput(e.target.value.toUpperCase())} className="font-mono" maxLength={10} />
                        <Button onClick={handleApplyReferral} disabled={!referralInput || isValidatingReferral} variant="outline">
                          {isValidatingReferral ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : 'Apply'}
                        </Button>
                      </div>}
                  </div>

                  <Separator />

                  {/* Account Credit (customer_credits ledger) */}
                  {walletBalanceCents > 0 && (
                    <>
                      <div className="space-y-2">
                        <p className="text-sm font-medium flex items-center gap-2">
                          <RiSparklingLine className="w-4 h-4 text-emerald-600" />
                          Account Credit
                        </p>
                        <label className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3 cursor-pointer">
                          <div>
                            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                              Apply ${(walletBalanceCents / 100).toFixed(2)} from your wallet
                            </p>
                            <p className="text-xs text-muted-foreground">
                              We'll use as much as the booking allows. Unused credit stays on your account.
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={applyWallet}
                            onChange={(e) => {
                              setApplyWallet(e.target.checked);
                              setClientSecret(null);
                              setBookingId(null);
                              setPaymentAmount(0);
                              paymentInitStarted.current = false;
                            }}
                            className="h-5 w-5 accent-emerald-600"
                          />
                        </label>
                      </div>
                      <Separator />
                    </>
                  )}

                  {/* Promo Code */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <RiSparklingLine className="w-4 h-4 text-primary" />
                      Promo Code
                    </p>
                    {appliedPromoCode ? <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-2">
                          <RiSparklingLine className="w-4 h-4 text-green-600" />
                          <span className="font-medium text-green-700 dark:text-green-400">{appliedPromoCode}</span>
                          {autoAppliedPromo && <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 text-xs">Auto-applied</Badge>}
                          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400">
                            -${promoDiscount.toFixed(2)}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleRemovePromo}>
                          Remove
                        </Button>
                      </div> : <>
                        <div className="flex gap-2">
                          <Input placeholder="Enter promo code" value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())} className="font-mono" maxLength={15} />
                          <Button onClick={handleApplyPromo} disabled={!promoInput || isValidatingPromo} variant="outline">
                            {isValidatingPromo ? <RiLoader4Line className="w-4 h-4 animate-spin" /> : 'Apply'}
                          </Button>
                        </div>
                        
                        {isAutoApplying && <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <RiLoader4Line className="w-4 h-4 animate-spin" />
                            Finding best available promo...
                          </div>}
                        
                        <button type="button" onClick={() => setShowPromoSuggestions(!showPromoSuggestions)} className="text-sm text-primary hover:underline">
                          {showPromoSuggestions ? 'Hide suggestions' : 'See available promos'}
                        </button>
                        
                        {showPromoSuggestions && <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                            <p className="text-muted-foreground">Try these codes:</p>
                            <div className="flex flex-wrap gap-2">
                              {['NEW50'].map(code => <Badge key={code} variant="outline" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors" onClick={() => {
                            setPromoInput(code);
                            setShowPromoSuggestions(false);
                          }}>
                                  {code}
                                </Badge>)}
                            </div>
                          </div>}
                      </>}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Payment Section */}
          <Card className="border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RiBankCardLine className="w-5 h-5 text-primary" />
                Payment Details
              </CardTitle>
              <CardDescription>
                {`Pay $${currentAmount.toFixed(2)} deposit now • $${depositPricing.balanceDue.toFixed(2)} auto-charged after service`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              
              {/* Membership Signup Flow */}
              {isNewMembershipSignup && <div className="space-y-4">
                  <div className="bg-primary/5 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Membership: {membership?.label}</span>
                      <Badge className="bg-primary text-white">${membership?.monthlyPrice}/mo</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {membership?.cleansPerMonth} cleaning credit/month • {membership?.discount}% off extras • Cancel anytime
                    </p>
                  </div>
                  
                  <Button onClick={handleMembershipCheckout} size="lg" className="w-full bg-gradient-primary hover:opacity-90" disabled={isCreatingIntent}>
                    {isCreatingIntent ? <><RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />Processing...</> : <>Subscribe & Book First Clean</>}
                  </Button>
                </div>}

              {/* Member Using Credit */}
              {isMemberUsingCredit && <div className="text-center space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                    <RiSparklingLine className="w-10 h-10 text-green-600 mx-auto mb-3" />
                    <p className="text-3xl font-bold text-green-700">$0.00</p>
                    <p className="text-green-600 mt-1">Covered by your membership credit!</p>
                  </div>
                  <Button onClick={() => router.push("/book/success")} size="lg" className="w-full bg-gradient-primary hover:opacity-90">
                    Confirm Booking
                  </Button>
                </div>}

              {/* Regular Stripe Payment */}
              {!isNewMembershipSignup && !isMemberUsingCredit && <>
                  {/* Error State */}
                  {initError && !isCreatingIntent && <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
                      <RiErrorWarningLine className="w-8 h-8 text-destructive mx-auto mb-2" />
                      <p className="text-sm text-destructive font-medium mb-3">{initError}</p>
                      <Button variant="outline" size="sm" onClick={handleRetryPayment}>
                        <RiRefreshLine className="w-4 h-4 mr-2" />
                        Try Again
                      </Button>
                    </div>}

                  {isCreatingIntent && !clientSecret && !initError && (
                    <div className="space-y-3 py-4">
                      <Skeleton className="h-12 w-full rounded-lg" />
                      <Skeleton className="h-12 w-full rounded-lg" />
                      <Skeleton className="h-14 w-full rounded-lg" />
                      <p className="text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                        <RiLoader4Line className="w-4 h-4 animate-spin text-primary" />
                        Preparing secure checkout…
                      </p>
                    </div>
                  )}

                  {clientSecret && paymentAmount > 0 && !initError && (
                    <div className="space-y-4">
                      {/* Stripe payment form — ALWAYS loaded. The signed
                          One-Time Service Agreement is captured on the next
                          (Details) step, so nothing here gates payment. */}
                      <Elements stripe={stripePromise} options={{ clientSecret }}>
                        <StripePaymentForm
                          amount={paymentAmount}
                          onSuccess={handlePaymentSuccess}
                          onRetry={handleRetryPayment}
                          customerEmail={bookingData.email}
                          bookingId={bookingId}
                        />
                      </Elements>

                      {/* View-only policies + agreement preview. No
                          checkboxes — the policies are listed for review and
                          the customer signs the One-Time Service Agreement on
                          the next step. */}
                      <div className="rounded-lg border border-primary/20 bg-primary/[0.03] p-4 space-y-3">
                        <p className="font-semibold text-sm flex items-center gap-2">
                          <RiShieldLine className="w-4 h-4 text-primary" />
                          Service Agreement &amp; Policies
                        </p>
                        <ul className="text-sm space-y-1.5">
                          <li className="flex items-center gap-2">
                            <RiFileTextLine className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <a href="https://novaracleaning.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">Terms of Service</a>
                          </li>
                          <li className="flex items-center gap-2">
                            <RiFileTextLine className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <a href="https://novaracleaning.com/disclaimer" target="_blank" rel="noopener noreferrer" className="text-primary underline">Disclaimer</a>
                          </li>
                          <li className="flex items-center gap-2">
                            <RiFileTextLine className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <a href="https://novaracleaning.com/refund-policy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Refund Policy</a>
                          </li>
                        </ul>

                        {/* One-Time Service Agreement — link to view if needed */}
                        <ul className="text-sm">
                          <li className="flex items-center gap-2">
                            <RiFileTextLine className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <a
                              href="/agreements/one-time-service-agreement.pdf"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline inline-flex items-center gap-1"
                            >
                              One-Time Service Agreement
                              <RiExternalLinkLine className="w-3.5 h-3.5" />
                            </a>
                          </li>
                        </ul>

                        <p className="text-xs text-muted-foreground">
                          By paying your deposit you agree to the Terms of Service, Disclaimer, Refund Policy, and the One-Time Service Agreement. You&apos;ll add your signature on the next step.
                        </p>
                      </div>
                    </div>
                  )}
                </>}

              {/* Trust Badges */}
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-4 border-t">
                <span className="flex items-center gap-1">
                  <RiShieldLine className="w-3.5 h-3.5" />
                  Secure
                </span>
                <span>•</span>
                <span>256-bit Encryption</span>
                <span>•</span>
                <span>PCI Compliant</span>
              </div>
            </CardContent>
          </Card>

          {/* Trust Badges row — ported from AlphaLux. Three-column
              icon grid above the Google Guaranteed badge, using our
              primary purple. */}
          <Card className="border-primary/20">
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center text-sm mb-4">
                <div>
                  <RiShieldLine className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="font-medium">Secure payment via Stripe</p>
                </div>
                <div>
                  <RiLockLine className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="font-medium">No contracts</p>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <RiCheckboxCircleLine className="h-6 w-6 mx-auto mb-2 text-primary" />
                  <p className="font-medium">Insured &amp; bonded</p>
                </div>
              </div>
              <div className="pt-4 border-t flex justify-center">
                <GoogleGuaranteedBadge variant="compact" />
              </div>
            </CardContent>
          </Card>
            </>}

          {/* Desktop Back Button */}
          <div className="hidden md:block">
            <Button variant="outline" onClick={handleBack} disabled={isCreatingIntent}>
              <RiArrowLeftLine className="mr-2 w-4 h-4" />
              Back to Service Selection
            </Button>
          </div>


        </div>

        <BottomNavigation currentStep={currentStep} totalSteps={6} steps={BOOKING_STEPS} onBack={handleBack} showPrice={true} price={currentAmount} continueDisabled={true} />

        <BookingFooter />
      </div>
    </PageTransition>;
}