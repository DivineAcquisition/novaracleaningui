"use client";
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiInformationLine,
  RiPercentLine,
  RiPhoneLine,
  RiSparklingLine,
  RiStarLine,
  RiVipCrownLine
} from "@remixicon/react";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trackViewContent } from "@/lib/meta-pixel";
import { useBooking } from "@/contexts/BookingContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import { cn } from "@/lib/utils";
import { BookingHeader } from "@/components/booking/BookingHeader";
import { PageTransition } from "@/components/booking/PageTransition";
import { GoogleGuaranteedBadge } from "@/components/GoogleGuaranteedBadge";
import { SchedulePicker } from "@/components/booking/SchedulePicker";
import { CleanComparisonDialog } from "@/components/booking/CleanComparisonDialog";
import {
  HOME_SIZE_RANGES,
  MEMBERSHIP_PRICES,
  calculatePrice,
  getServicePrice,
} from "@/lib/pricing-system";
import { SEO } from "@/components/SEO";
import { format } from "date-fns";
import { toast } from "sonner";
import { preloadStripe } from "@/lib/stripe-client";
import { VALUE_STACK_HEADLINES } from "@/lib/value-stack";

const BOOKING_STEPS = [
  { number: 1, label: "Location", path: "/book/zip" },
  { number: 2, label: "Home Size", path: "/book/sqft" },
  { number: 3, label: "Service", path: "/book/offer" },
  { number: 4, label: "Checkout", path: "/book/checkout" },
  { number: 5, label: "Details", path: "/book/details" },
  { number: 6, label: "Confirm", path: "/book/confirmation" },
];

// Membership features
const MEMBERSHIP_FEATURES = [
  "Same trusted cleaning team",
  "Priority scheduling & member perks",
  "Cancel or pause anytime",
  "48-hour re-clean guarantee",
  ...VALUE_STACK_HEADLINES,
];

export default function BookingOffer() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [selectedService, setSelectedService] = useState<'standard' | 'deep' | 'combo' | 'membership' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + 'T12:00:00') : undefined
  );

  // Get home size data
  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  // Calculate prices via the canonical pricing pipeline so the values
  // displayed on this page match Checkout.tsx EXACTLY (no rounding
  // drift between offer card and checkout summary).
  const prices = useMemo(() => {
    const homeSizeId = bookingData.homeSizeId || '0_999';

    // Pre-discount list prices (Zone B base — backend applies zone modifier)
    const standardList = getServicePrice(homeSizeId, 'standard', 'B');
    const deepList = getServicePrice(homeSizeId, 'deep', 'B');
    const comboList = getServicePrice(homeSizeId, 'combo', 'B');

    // Per-tier post-50%-off totals + 50% deposit, computed by the same
    // calculatePrice() the checkout summary calls — guarantees the
    // numbers on this card match the Pay-now figure on /book/checkout
    // and the Stripe Pay button to the cent.
    const stdPricing = calculatePrice(homeSizeId, 'standard', [], 'none', false, true, 0);
    const deepPricing = calculatePrice(homeSizeId, 'deep', [], 'none', false, true, 0);
    const comboPricing = calculatePrice(homeSizeId, 'combo', [], 'none', false, true, 0);

    // Membership prices (Zone B base — recurring tier untouched by the
    // 10% reduction in v3.4)
    const memberPrices = MEMBERSHIP_PRICES[homeSizeId] || { monthly: 129, biweekly: 199, weekly: 349 };

    // Per-clean cost for bi-weekly
    const biweeklyPerClean = Math.round((memberPrices.biweekly / 2) * 100) / 100;
    const biweeklySavingsPercent = standardList > 0
      ? Math.round((1 - biweeklyPerClean / standardList) * 100)
      : 34;

    return {
      standard: standardList,
      deepClean: deepList,
      combo: comboList,
      standardPromoTotal: stdPricing.total,
      standardPromoDeposit: stdPricing.deposit,
      standardPromoBalance: stdPricing.balanceDue,
      deepPromoTotal: deepPricing.total,
      deepPromoDeposit: deepPricing.deposit,
      deepPromoBalance: deepPricing.balanceDue,
      comboPromoTotal: comboPricing.total,
      comboPromoDeposit: comboPricing.deposit,
      comboPromoBalance: comboPricing.balanceDue,
      membership: {
        monthly: memberPrices.monthly,
        biweekly: memberPrices.biweekly,
        weekly: memberPrices.weekly,
        biweeklyPerClean,
        biweeklySavingsPercent,
      },
    };
  }, [bookingData.homeSizeId]);

  // Check for custom quote requirement (5000+ sq ft)
  const requiresCustomQuote = selectedHomeSize?.id === '5000_plus';

  const handleSelectStandard = () => {
    setSelectedService('standard');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'none',
    });
    trackViewContent(prices.standard, 'Standard Cleaning — 25% Off First Clean');
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectDeepClean = () => {
    setSelectedService('deep');
    updateBookingData({
      serviceType: 'deep',
      membershipPlan: 'none',
    });
    trackViewContent(prices.deepClean, 'Deep Cleaning — 25% Off First Clean');
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectCombo = () => {
    setSelectedService('combo');
    updateBookingData({
      serviceType: 'combo',
      membershipPlan: 'none',
    });
    trackViewContent(prices.combo, 'Deep + Standard Combo — 25% Off First Clean');
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleSelectMembership = () => {
    setSelectedService('membership');
    updateBookingData({
      serviceType: 'standard',
      membershipPlan: 'biweekly',
    });
    trackViewContent(prices.membership.biweekly, 'Novara Glow Membership — Bi-Weekly');
    setTimeout(() => {
      document.getElementById('schedule-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleContinueToCheckout = () => {
    if (!bookingData.serviceDate || !bookingData.timeSlot) {
      toast.error("Please select a date and time");
      return;
    }
    preloadStripe();
    setCurrentStep(4);
    router.push("/book/checkout");
  };

  // Warm Stripe.js while the customer is still on the offer step.
  useEffect(() => {
    if (bookingData.serviceDate && bookingData.timeSlot) {
      preloadStripe();
    }
  }, [bookingData.serviceDate, bookingData.timeSlot]);

  const handleBack = () => {
    setCurrentStep(2);
    router.push("/book/sqft");
  };

  // Custom Quote View
  if (requiresCustomQuote) {
    return (
      <PageTransition direction="forward">
        <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
          <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />
          
          <div className="container max-w-2xl mx-auto px-4 py-8 space-y-6">
            <Card className="border-2 border-primary/30">
              <CardContent className="pt-8 pb-8 text-center space-y-6">
                <h1 className="text-2xl md:text-3xl font-bold font-jakarta">Custom Quote Required</h1>
                <p className="text-muted-foreground">
                  Your home requires a customized quote to ensure accurate pricing.
                </p>
                
                <div className="flex items-center justify-center gap-2 text-lg font-semibold text-primary">
                  <RiPhoneLine className="w-5 h-5" />
                  <a href="tel:+18447352070">(844) 735-2070</a>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Button asChild size="lg" className="bg-gradient-primary">
                    <a href="tel:+18447352070">
                      <RiPhoneLine className="w-4 h-4 mr-2" />
                      Call Now
                    </a>
                  </Button>
                  <Button variant="ghost" size="lg" onClick={handleBack}>
                    <RiArrowLeftLine className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition direction="forward">
      <div className="min-h-screen bg-gradient-hero pb-32 md:pb-8">
        <SEO title="Choose Your Service" description="Select your cleaning service type and schedule. Standard, deep clean, or Novara Glow membership." />
        <BookingHeader currentStep={3} totalSteps={6} stepLabel="Service" />

        <div className="container max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8" id="offers-section">
          {/* Header — promo-led layout: badge + "Save 25%" hero +
              auto-applied-code line. Uses our primary purple in place
              of AlphaLux's gold. */}
          <div className="text-center space-y-3 md:space-y-4">
            <Badge className="bg-primary/10 text-primary border border-primary/40 px-3 py-1 text-xs font-bold uppercase tracking-wider">
              <RiSparklingLine className="h-3.5 w-3.5 mr-1.5" />
              New Customer Special — 25% Off
            </Badge>

            <h1 className="font-jakarta text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">
              Save{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent">
                25%
              </span>{" "}
              On Your First Cleaning
            </h1>

            <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-primary font-semibold">
              New-customer discount applied automatically at checkout
            </p>

            <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
              Pick a one-time deep clean or join the Glow membership — either way you save 25% on the first clean.
            </p>

            <div className="flex justify-center pt-1">
              <GoogleGuaranteedBadge variant="compact" />
            </div>
          </div>

          {/* "What's the difference?" comparison opener — sits between
              the page header and the offer cards so the customer can
              see the side-by-side without leaving the page. */}
          <div className="flex justify-center -mb-2">
            <button
              type="button"
              onClick={() => setShowComparisonModal(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.04] px-3 py-1.5 text-xs md:text-sm font-medium text-primary hover:bg-primary/10 hover:border-primary/50 transition-colors"
            >
              <RiInformationLine className="h-4 w-4" />
              What&apos;s the difference between Standard &amp; Deep?
            </button>
          </div>

          {/* Three offer cards: Standard Clean, Deep Clean (Most
              Popular), and Glow Membership. Standard + Deep both
              qualify for the 50% promo; Membership has its own
              per-clean discount (14–42%) and doesn't stack the 50%. */}
          <div className="grid gap-5 md:gap-6 max-w-xl mx-auto">
            {/* Standard Clean — 50% off */}
            {selectedHomeSize && prices.standard > 0 && (() => {
              const standardDiscounted = prices.standardPromoTotal;
              const standardDepositToday = prices.standardPromoDeposit;
              const standardBalanceAfter = prices.standardPromoBalance;
              const isSelected = selectedService === "standard";
              return (
                <Card
                  className={cn(
                    "relative border-2 transition-all duration-200 cursor-pointer hover:shadow-xl",
                    isSelected
                      ? "border-primary shadow-lg ring-2 ring-primary/20"
                      : "border-primary/20 hover:border-primary/50",
                  )}
                  onClick={handleSelectStandard}
                >
                  <CardContent className="pt-6 pb-6 px-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <RiSparklingLine className="h-4 w-4" />
                        </div>
                        <Badge
                          variant="outline"
                          className="bg-primary/10 text-primary border-primary/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        >
                          <RiPercentLine className="h-3 w-3 mr-1" />
                          25% off · auto-applied
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xl md:text-2xl font-bold font-jakarta">Standard Clean</h3>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        Regular maintenance cleaning — first-time customers save 25%.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                          ${standardDiscounted.toFixed(2)}
                        </span>
                        <span className="text-sm text-muted-foreground">total / clean</span>
                      </div>
                      <p className="text-xs text-primary font-semibold mt-1.5">
                        25% off applied automatically
                      </p>
                      <div className="mt-2 rounded-md bg-primary/5 border border-primary/15 px-3 py-2 text-xs space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Pay today (50% deposit)</span>
                          <span className="font-semibold text-foreground">${standardDepositToday.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Auto-charged after service</span>
                          <span className="font-semibold text-foreground">${standardBalanceAfter.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <ul className="space-y-2">
                      {[
                        "Kitchen: countertops, sink, stovetop, appliance exteriors",
                        "Bathrooms: sanitize fixtures, polish mirrors",
                        "Living areas: dust, vacuum, mop",
                        "Bedrooms: dust furniture, make beds on request",
                        "All supplies & equipment included",
                        ...VALUE_STACK_HEADLINES,
                      ].map((line) => (
                        <li key={line} className="flex items-start gap-2 text-xs md:text-sm">
                          <RiCheckLine className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-foreground">{line}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      size="lg"
                      className="w-full bg-gradient-primary hover:opacity-90 font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectStandard();
                      }}
                    >
                      Claim Offer — Save 25%
                      <RiArrowRightSLine className="w-4 h-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Deep Clean — 50% off (Most Popular) */}
            {selectedHomeSize && prices.deepClean > 0 && (() => {
              const deepDiscounted = prices.deepPromoTotal;
              const deepDepositToday = prices.deepPromoDeposit;
              const deepBalanceAfter = prices.deepPromoBalance;
              const isSelected = selectedService === "deep";
              return (
                <div className="relative pt-4">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-gradient-primary text-white font-bold shadow-lg px-4 py-1 text-[11px] uppercase tracking-wider">
                      <RiSparklingLine className="h-3 w-3 mr-1" />
                      Most Popular
                    </Badge>
                  </div>
                  <Card
                    className={cn(
                      "relative border-2 transition-all duration-200 cursor-pointer hover:shadow-xl",
                      isSelected
                        ? "border-primary shadow-lg ring-2 ring-primary/20"
                        : "border-primary/30 hover:border-primary/60",
                    )}
                    onClick={handleSelectDeepClean}
                  >
                    <CardContent className="pt-7 pb-6 px-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <RiSparklingLine className="h-4 w-4" />
                          </div>
                          <Badge
                            variant="outline"
                            className="bg-primary/10 text-primary border-primary/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                          >
                            <RiPercentLine className="h-3 w-3 mr-1" />
                            25% off · auto-applied
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-xl md:text-2xl font-bold font-jakarta">Deep Clean</h3>
                        <p className="text-xs md:text-sm text-muted-foreground">
                          Thorough top-to-bottom reset — first-time customers save 25%.
                        </p>
                      </div>

                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                            ${deepDiscounted.toFixed(2)}
                          </span>
                          <span className="text-sm text-muted-foreground">total / clean</span>
                        </div>
                        <p className="text-xs text-primary font-semibold mt-1.5">
                          25% off applied automatically
                        </p>
                        <div className="mt-2 rounded-md bg-primary/5 border border-primary/15 px-3 py-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Pay today (50% deposit)</span>
                            <span className="font-semibold text-foreground">${deepDepositToday.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Auto-charged after service</span>
                            <span className="font-semibold text-foreground">${deepBalanceAfter.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      <ul className="space-y-2">
                        {[
                          "Everything in Standard Clean",
                          "Inside cabinet cleaning & baseboards",
                          "Interior windows & sills",
                          "Eco-friendly products & HEPA vacuums",
                          "48-hour re-clean guarantee",
                          ...VALUE_STACK_HEADLINES,
                        ].map((line) => (
                          <li key={line} className="flex items-start gap-2 text-xs md:text-sm">
                            <RiCheckLine className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <span className="text-foreground">{line}</span>
                          </li>
                        ))}
                      </ul>

                      <Button
                        size="lg"
                        className="w-full bg-gradient-primary hover:opacity-90 font-semibold"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectDeepClean();
                        }}
                      >
                        Claim Offer — Save 25%
                        <RiArrowRightSLine className="w-4 h-4 ml-1" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              );
            })()}

            {/* Deep + Standard Combo — 50% off
                The Combo is one Deep Clean upfront + a follow-up Standard
                Clean inside the next 14 days, billed as a single bundle.
                Priced via SERVICE_TIER_PRICING.combo (2.5× standard) so
                it lines up with the Deep Clean number above + a follow-up
                Standard. The 50% new-customer promo applies to the whole
                bundle. */}
            {selectedHomeSize && prices.combo > 0 && (() => {
              const comboDiscounted = prices.comboPromoTotal;
              const comboDepositToday = prices.comboPromoDeposit;
              const comboBalanceAfter = prices.comboPromoBalance;
              const isSelected = selectedService === "combo";
              return (
                <Card
                  className={cn(
                    "relative border-2 transition-all duration-200 cursor-pointer hover:shadow-xl",
                    isSelected
                      ? "border-primary shadow-lg ring-2 ring-primary/20"
                      : "border-primary/20 hover:border-primary/50",
                  )}
                  onClick={handleSelectCombo}
                >
                  <CardContent className="pt-6 pb-6 px-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                          <RiSparklingLine className="h-4 w-4" />
                        </div>
                        <Badge
                          variant="outline"
                          className="bg-primary/10 text-primary border-primary/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        >
                          <RiPercentLine className="h-3 w-3 mr-1" />
                          25% off · auto-applied
                        </Badge>
                      </div>
                      <Badge
                        variant="outline"
                        className="bg-emerald-50 text-emerald-700 border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      >
                        Best value
                      </Badge>
                    </div>

                    <div>
                      <h3 className="text-xl md:text-2xl font-bold font-jakarta">
                        Deep + Standard Combo
                      </h3>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        One Deep Clean now + a Standard follow-up within 14 days.
                        Two visits, one price — first-time customers save 25%.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                          ${comboDiscounted.toFixed(2)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          bundle total
                        </span>
                      </div>
                      <p className="text-xs text-primary font-semibold mt-1.5">
                        25% off the entire bundle — applied automatically
                      </p>
                      <div className="mt-2 rounded-md bg-primary/5 border border-primary/15 px-3 py-2 text-xs space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Pay today (50% deposit)
                          </span>
                          <span className="font-semibold text-foreground">
                            ${comboDepositToday.toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Auto-charged after each visit
                          </span>
                          <span className="font-semibold text-foreground">
                            ${comboBalanceAfter.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <ul className="space-y-2">
                      {[
                        "Visit 1 — full Deep Clean (everything in Deep)",
                        "Visit 2 — Standard maintenance clean within 14 days",
                        "Same team both visits when possible",
                        "Inside cabinet cleaning & baseboards on visit 1",
                        "Eco-friendly products & HEPA vacuums",
                        "48-hour re-clean guarantee on both visits",
                        ...VALUE_STACK_HEADLINES,
                      ].map((line) => (
                        <li
                          key={line}
                          className="flex items-start gap-2 text-xs md:text-sm"
                        >
                          <RiCheckLine className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <span className="text-foreground">{line}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      size="lg"
                      className="w-full bg-gradient-primary hover:opacity-90 font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectCombo();
                      }}
                    >
                      Claim Combo — Save 25%
                      <RiArrowRightSLine className="w-4 h-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Novara Glow Membership card */}
            <Card
              className={cn(
                "relative border-2 transition-all duration-200 cursor-pointer hover:shadow-xl",
                selectedService === "membership"
                  ? "border-primary shadow-lg ring-2 ring-primary/20"
                  : "border-primary/20 hover:border-primary/50",
              )}
              onClick={handleSelectMembership}
            >
              <CardContent className="pt-6 pb-6 px-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <RiVipCrownLine className="h-4 w-4" />
                    </div>
                    <Badge
                      variant="outline"
                      className="bg-primary/10 text-primary border-primary/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    >
                      <RiStarLine className="h-3 w-3 mr-1" />
                      Save up to {prices.membership.biweeklySavingsPercent}%
                    </Badge>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl md:text-2xl font-bold font-jakarta">Novara Glow Membership</h3>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    Recurring cleaning — same trusted team, every visit.
                  </p>
                </div>

                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                      ${prices.membership.biweekly}
                    </span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <p className="text-xs text-primary font-semibold mt-1.5">
                    Bi-Weekly · 2 cleans/month at ${prices.membership.biweeklyPerClean}/clean
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Badge variant="secondary" className="text-[10px]">
                      Monthly: ${prices.membership.monthly}/mo
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Weekly: ${prices.membership.weekly}/mo
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Membership pricing already discounted — 25%-off promo does not stack.
                  </p>
                </div>

                <ul className="space-y-2">
                  {MEMBERSHIP_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs md:text-sm">
                      <RiCheckLine className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="space-y-2 pt-1">
                  <Button
                    size="lg"
                    className="w-full bg-gradient-primary hover:opacity-90 font-semibold"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectMembership();
                    }}
                  >
                    Get Started
                    <RiArrowRightSLine className="w-4 h-4 ml-1" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMembershipModal(true);
                    }}
                  >
                    What's Included?
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Schedule Picker - Shows after service selection with animation */}
          {selectedService && (
            <div
              id="schedule-section"
              className="scroll-mt-4 animate-fade-in"
              style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
            >
              <SchedulePicker
                selectedDate={selectedDate}
                selectedTime={bookingData.timeSlot}
                onDateSelect={(date) => {
                  setSelectedDate(date);
                  updateBookingData({
                    serviceDate: format(date, 'yyyy-MM-dd'),
                    timeSlot: ''
                  });
                }}
                onTimeSelect={(date, timeSlot, startTime, endTime) => {
                  updateBookingData({
                    serviceDate: format(date, 'yyyy-MM-dd'),
                    timeSlot,
                    startTime,
                    endTime
                  });
                  toast.success(`Scheduled for ${format(date, 'MMM d')} at ${timeSlot}`);
                }}
                onContinue={handleContinueToCheckout}
                showContinue={true}
                continueDisabled={!bookingData.serviceDate || !bookingData.timeSlot}
              />
            </div>
          )}

          {/* Back Navigation */}
          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleBack} className="text-muted-foreground">
              <RiArrowLeftLine className="w-4 h-4 mr-2" />
              Back to Home Size
            </Button>
          </div>
        </div>

        {/* Standard vs Deep comparison modal */}
        <CleanComparisonDialog
          open={showComparisonModal}
          onOpenChange={setShowComparisonModal}
        />

        {/* Membership Modal */}
        <Dialog open={showMembershipModal} onOpenChange={setShowMembershipModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-jakarta">Novara Glow Membership</DialogTitle>
              <DialogDescription>
                Recurring cleaning at a fraction of the one-time price.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {/* Frequency options */}
              <div className="grid gap-3">
                <div className="p-3 rounded-lg border bg-success/5 border-success/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RiStarLine className="w-4 h-4 text-success" />
                      <span className="font-semibold text-sm">Bi-Weekly (2x/month)</span>
                      <Badge className="bg-success/10 text-success border-0 text-[10px]">Best Value</Badge>
                    </div>
                    <span className="font-bold text-success">${prices.membership.biweekly}/mo</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RiSparklingLine className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">Monthly (1x/month)</span>
                    </div>
                    <span className="font-bold">${prices.membership.monthly}/mo</span>
                  </div>
                </div>
                <div className="p-3 rounded-lg border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RiVipCrownLine className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">Weekly (4x/month)</span>
                    </div>
                    <span className="font-bold">${prices.membership.weekly}/mo</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="grid gap-3">
                {[
                  "Same trusted cleaning team every visit",
                  "Priority scheduling",
                  "Free add-ons included",
                  "Cancel or pause anytime",
                  "48-hour re-clean guarantee",
                  "No long-term contracts",
                  ...VALUE_STACK_HEADLINES,
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <RiCheckLine className="w-4 h-4 text-success flex-shrink-0" />
                    <span className="text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Button className="w-full bg-success hover:bg-success/90" onClick={() => { setShowMembershipModal(false); handleSelectMembership(); }}>
                Get Started with Glow Membership
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </PageTransition>
  );
}
