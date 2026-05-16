"use client";
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiCheckLine,
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
import {
  HOME_SIZE_RANGES,
  MEMBERSHIP_PRICES,
  calculatePrice,
  getServicePrice,
} from "@/lib/pricing-system";
import { SEO } from "@/components/SEO";
import { format } from "date-fns";
import { toast } from "sonner";

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
];

export default function BookingOffer() {
  const router = useRouter();
  const { bookingData, updateBookingData, setCurrentStep } = useBooking();
  const [showMembershipModal, setShowMembershipModal] = useState(false);
  const [selectedService, setSelectedService] = useState<'combo' | 'membership' | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    bookingData.serviceDate ? new Date(bookingData.serviceDate + 'T12:00:00') : undefined
  );

  // Get home size data
  const selectedHomeSize = useMemo(() => {
    return HOME_SIZE_RANGES.find(h => h.id === bookingData.homeSizeId);
  }, [bookingData.homeSizeId]);

  // Calculate prices via the canonical pricing pipeline so the values
  // displayed on this page match Checkout.tsx EXACTLY (no rounding
  // drift between offer card and checkout summary). We assume new
  // customer for the displayed promo math; the server re-verifies
  // before issuing the discount.
  const prices = useMemo(() => {
    const homeSizeId = bookingData.homeSizeId || '0_999';

    // Pre-discount list prices (Zone B base — backend applies zone modifier)
    const standardList = getServicePrice(homeSizeId, 'standard', 'B');
    const deepList = getServicePrice(homeSizeId, 'deep', 'B');
    const comboList = standardList + deepList; // Deep + Standard bundle

    // Combo post-50%-off totals + 50% deposit (matches calculatePrice
    // for serviceType='combo' in Checkout exactly).
    const comboPricing = calculatePrice(homeSizeId, 'combo', [], 'none', false, /* isNewCustomer */ true, 0);

    // Membership prices (Zone B base)
    const memberPrices = MEMBERSHIP_PRICES[homeSizeId] || { monthly: 129, biweekly: 199, weekly: 349 };

    // Per-clean cost for bi-weekly
    const biweeklyPerClean = Math.round((memberPrices.biweekly / 2) * 100) / 100;
    const biweeklySavingsPercent = standardList > 0
      ? Math.round((1 - biweeklyPerClean / standardList) * 100)
      : 34;

    return {
      standard: standardList,
      deepClean: deepList,
      comboList,
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

  const handleSelectCombo = () => {
    setSelectedService('combo');
    updateBookingData({
      // serviceType stays 'combo' so the server prices both visits as a
      // bundle. The first visit (Deep Clean) date is picked here on
      // /book/offer; the second visit (Standard Clean follow-up) is
      // captured on /book/details after deposit.
      serviceType: 'combo',
      membershipPlan: 'none',
    });
    trackViewContent(prices.comboList, 'Deep + Standard Combo — 50% Off First Clean');
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
    setCurrentStep(4);
    router.push("/book/checkout");
  };

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
          {/* Header — promo-led layout: badge + "Save 50%" hero +
              auto-applied-code line. Uses our primary purple in place
              of AlphaLux's gold. */}
          <div className="text-center space-y-3 md:space-y-4">
            <Badge className="bg-primary/10 text-primary border border-primary/40 px-3 py-1 text-xs font-bold uppercase tracking-wider">
              <RiSparklingLine className="h-3.5 w-3.5 mr-1.5" />
              New Customer Special — 50% Off
            </Badge>

            <h1 className="font-jakarta text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">
              Save{" "}
              <span className="bg-gradient-primary bg-clip-text text-transparent">
                50%
              </span>{" "}
              On Your First Cleaning
            </h1>

            <p className="text-xs md:text-sm uppercase tracking-[0.22em] text-primary font-semibold">
              New-customer discount applied automatically at checkout
            </p>

            <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
              Pick a one-time deep clean or join the Glow membership — either way you save 50% on the first clean.
            </p>

            <div className="flex justify-center pt-1">
              <GoogleGuaranteedBadge variant="compact" />
            </div>
          </div>

          {/* Two offer cards: Deep + Standard Combo (one-time bundle)
              and Glow Membership (recurring). Combo qualifies for the
              50% new-customer promo; Membership has its own per-clean
              discount (14–42%) and does NOT stack the 50% off. */}
          <div className="grid gap-5 md:gap-6 max-w-xl mx-auto">
            {/* Deep + Standard Combo — 50% off card (Most Popular) */}
            {selectedHomeSize && prices.comboList > 0 && (() => {
              const comboDiscounted = prices.comboPromoTotal;
              const comboDepositToday = prices.comboPromoDeposit;
              const comboBalanceAfter = prices.comboPromoBalance;
              const isSelected = selectedService === "combo";
              return (
                <div className="relative pt-4">
                  {/* Most Popular ribbon — rendered outside the Card so
                      the Card can keep its rounded edges without being
                      clipped by overflow-hidden. */}
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
                    onClick={handleSelectCombo}
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
                            50% off · auto-applied
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-xl md:text-2xl font-bold font-jakarta">Deep + Standard Combo</h3>
                        <p className="text-xs md:text-sm text-muted-foreground">
                          Initial Deep Clean + a follow-up Standard Clean within 14 days. Schedule the second visit on the next page.
                        </p>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground line-through mb-1">
                          Regular: ${prices.comboList.toFixed(2)} (2 visits)
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                            ${comboDiscounted.toFixed(2)}
                          </span>
                          <span className="text-sm text-muted-foreground">total · 2 visits</span>
                        </div>
                        <p className="text-xs text-primary font-semibold mt-1.5">
                          50% off applied automatically — both visits
                        </p>
                        <div className="mt-2 rounded-md bg-primary/5 border border-primary/15 px-3 py-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Pay today (50% deposit)</span>
                            <span className="font-semibold text-foreground">${comboDepositToday.toFixed(2)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Auto-charged after second clean</span>
                            <span className="font-semibold text-foreground">${comboBalanceAfter.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      <ul className="space-y-2">
                        {[
                          "Visit 1 — Deep Clean: top-to-bottom reset",
                          "Visit 2 — Standard Clean within 14 days",
                          "Same trusted 2-person team for both visits",
                          "Eco-friendly products & HEPA vacuums",
                          "48-hour re-clean guarantee",
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
                          handleSelectCombo();
                        }}
                      >
                        Claim Offer — Save 50%
                        <RiArrowRightSLine className="w-4 h-4 ml-1" />
                      </Button>
                    </CardContent>
                  </Card>
                </div>
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
                    Membership pricing already discounted — 50%-off promo does not stack.
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
              {selectedService === 'combo' && (
                <div className="max-w-xl mx-auto mb-3 rounded-lg bg-primary/5 border border-primary/20 px-4 py-2 text-xs md:text-sm text-foreground">
                  <strong>Visit 1 — Deep Clean.</strong> Pick the date below.
                  You'll lock in your <strong>Visit 2 — Standard Clean</strong>{' '}
                  on the next page (within 14 days of the deep).
                </div>
              )}
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
