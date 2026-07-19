"use client";

import {
  RiArrowRightLine,
  RiCheckLine,
  RiFlashlightLine,
  RiGiftLine,
  RiHomeLine,
  RiPercentLine,
  RiPhoneLine,
  RiShieldLine,
  RiSparklingLine,
  RiStarLine,
  RiVipCrownLine,
} from "@remixicon/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  HOME_SIZE_RANGES,
  ADD_ONS,
  MEMBERSHIP_PRICES,
  calculatePrice,
  getServicePrice,
} from "@/lib/pricing-system";
import { SEO } from "@/components/SEO";
import { useBooking } from "@/contexts/BookingContext";

const logo = "/novara-logo.png";

type ServiceTab = "deep" | "standard" | "membership";
type MemberFreq = "biweekly" | "monthly" | "weekly";

// Home-size selector: every range with a real price; 5000+ falls
// through to the custom-quote tile.
const SIZE_OPTIONS = HOME_SIZE_RANGES.filter((s) => s.standardPrice > 0);

const SERVICE_TABS: Array<{ id: ServiceTab; label: string; icon: typeof RiHomeLine; badge?: string }> = [
  { id: "deep", label: "Deep Clean", icon: RiSparklingLine, badge: "Most Popular" },
  { id: "standard", label: "Standard Clean", icon: RiHomeLine },
  { id: "membership", label: "Glow Membership", icon: RiVipCrownLine },
];

const MEMBER_FREQUENCIES: Array<{
  id: MemberFreq;
  label: string;
  cleans: string;
  savingsLabel: string;
  highlight?: boolean;
}> = [
  { id: "biweekly", label: "Bi-Weekly", cleans: "2 cleans/month", savingsLabel: "Save up to 34%", highlight: true },
  { id: "monthly", label: "Monthly", cleans: "1 clean/month", savingsLabel: "Save up to 18%" },
  { id: "weekly", label: "Weekly", cleans: "4 cleans/month", savingsLabel: "Save up to 42%" },
];

export default function PricingSheet() {
  const router = useRouter();
  const { updateBookingData } = useBooking();

  // Interactive state — defaults to mid-range home + Deep Clean (the
  // most popular offer) so the page lands with a meaningful number.
  const [homeSizeId, setHomeSizeId] = useState<string>("1501_2000");
  const [serviceTab, setServiceTab] = useState<ServiceTab>("deep");
  const [memberFreq, setMemberFreq] = useState<MemberFreq>("biweekly");

  const selectedSize = useMemo(
    () => HOME_SIZE_RANGES.find((s) => s.id === homeSizeId) ?? SIZE_OPTIONS[0],
    [homeSizeId],
  );
  const isCustom = !selectedSize || selectedSize.standardPrice === 0;

  // One-time pricing (Standard / Deep) — runs the exact calculatePrice
  // pipeline the booking funnel uses, so post-50%-off / 50% deposit /
  // balance line up to the cent with /book/offer and /book/checkout.
  const oneTimePricing = useMemo(() => {
    if (isCustom) return null;
    if (serviceTab === "membership") return null;
    const listPrice = getServicePrice(homeSizeId, serviceTab, "B");
    const pricing = calculatePrice(homeSizeId, serviceTab, [], "none", false, true, 0);
    return { listPrice, ...pricing };
  }, [homeSizeId, serviceTab, isCustom]);

  // Membership pricing — uses the canonical rate-card numbers (no 50%
  // promo stacked; members already get the plan-level discount per
  // clean of 14–42%).
  const membershipPricing = useMemo(() => {
    if (isCustom) return null;
    const p = MEMBERSHIP_PRICES[homeSizeId];
    if (!p) return null;
    const standardList = getServicePrice(homeSizeId, "standard", "B");
    const perCleanRaw = (n: number, monthly: number) => Math.round((monthly / n) * 100) / 100;
    return {
      monthly: { monthly: p.monthly, perClean: perCleanRaw(1, p.monthly), savingsPct: Math.round((1 - p.monthly / standardList) * 100) },
      biweekly: { monthly: p.biweekly, perClean: perCleanRaw(2, p.biweekly), savingsPct: Math.round((1 - perCleanRaw(2, p.biweekly) / standardList) * 100) },
      weekly: { monthly: p.weekly, perClean: perCleanRaw(4, p.weekly), savingsPct: Math.round((1 - perCleanRaw(4, p.weekly) / standardList) * 100) },
    };
  }, [homeSizeId, isCustom]);

  const handleBookNow = () => {
    // Pre-fill the booking context so the booking funnel lands the
    // customer mid-flow rather than starting from scratch.
    if (!isCustom) {
      if (serviceTab === "membership") {
        updateBookingData({
          homeSizeId,
          serviceType: "standard",
          membershipPlan: memberFreq,
        });
      } else {
        updateBookingData({
          homeSizeId,
          serviceType: serviceTab,
          membershipPlan: "none",
        });
      }
    }
    router.push("/book/zip");
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Pricing"
        description="Pick your home size and see instant cleaning prices. New customers save 25% on their first clean. 50% deposit at booking — balance auto-charged after service."
      />

      {/* Nav */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-9 h-9 rounded-xl" />
            <span className="text-lg font-bold tracking-tight font-jakarta">
              Novara<span className="text-primary">Cleaning</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="tel:+18447352070"
              className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <RiPhoneLine className="w-4 h-4" />
              (844) 735-2070
            </a>
            <Button onClick={handleBookNow} className="h-10 px-6 font-semibold bg-gradient-primary hover:opacity-90 text-white">
              Book Now <RiArrowRightLine className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-background to-background" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-primary/[0.06] rounded-full blur-3xl" />
        <div className="relative container mx-auto px-4 pt-16 pb-8 md:pt-20 md:pb-10 max-w-3xl text-center space-y-5">
          <Badge className="bg-primary/10 text-primary border border-primary/40 px-3 py-1 text-xs font-bold uppercase tracking-wider">
            <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" />
            New Customer Special — 25% Off
          </Badge>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight font-jakarta leading-[1.1]">
            See your{" "}
            <span className="bg-gradient-primary bg-clip-text text-transparent">
              exact price
            </span>{" "}
            in seconds
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Pick your home size and service — we'll show you the total, the 50% deposit due today, and what gets auto-charged after the cleaning is complete. No call required.
          </p>
        </div>
      </section>

      {/* ─── Interactive calculator ────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-4xl pb-12">
        <Card className="border-2 border-primary/20 shadow-xl overflow-hidden">
          <CardContent className="p-5 md:p-8 space-y-6">

            {/* Step 1 — Home size */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">1</div>
                <h2 className="font-jakarta text-lg md:text-xl font-bold">How big is your home?</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {SIZE_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setHomeSizeId(s.id)}
                    className={cn(
                      "rounded-lg border-2 p-3 text-left transition-all hover:border-primary/60",
                      homeSizeId === s.id
                        ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                        : "border-border bg-background",
                    )}
                  >
                    <div className="text-xs font-semibold text-muted-foreground">{s.label.replace(' sq ft', '')} sq ft</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{s.bedroomRange}</div>
                  </button>
                ))}
                {/* 5,000+ → custom quote tile */}
                <button
                  type="button"
                  onClick={() => setHomeSizeId("5000_plus")}
                  className={cn(
                    "rounded-lg border-2 border-dashed p-3 text-left transition-all hover:border-primary/60",
                    homeSizeId === "5000_plus"
                      ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                      : "border-border bg-background",
                  )}
                >
                  <div className="text-xs font-semibold text-muted-foreground">5,000+ sq ft</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Custom quote</div>
                </button>
              </div>
            </div>

            {/* Step 2 — Service type */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">2</div>
                <h2 className="font-jakarta text-lg md:text-xl font-bold">Which service?</h2>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {SERVICE_TABS.map((t) => {
                  const Icon = t.icon;
                  const active = serviceTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setServiceTab(t.id)}
                      className={cn(
                        "relative rounded-lg border-2 px-3 py-3 transition-all hover:border-primary/60 flex flex-col items-center justify-center gap-1",
                        active
                          ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                          : "border-border bg-background",
                      )}
                    >
                      {t.badge && (
                        <span className="absolute -top-2 right-1.5 bg-gradient-primary text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                          {t.badge}
                        </span>
                      )}
                      <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("text-xs md:text-sm font-semibold", active && "text-primary")}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3 — Live price reveal */}
            <Separator />

            {isCustom ? (
              // ── Custom quote (5,000+ sq ft) ─────────────────────
              <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.04] p-5 text-center space-y-3">
                <Badge className="bg-primary/10 text-primary border-primary/40">Custom Quote Required</Badge>
                <h3 className="text-xl md:text-2xl font-bold font-jakarta">5,000+ sq ft — let's chat</h3>
                <p className="text-sm text-muted-foreground">
                  Estates over 5,000 sq ft get a tailored quote so the price reflects the actual scope. Call us and we'll lock in your number in under 5 minutes.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
                  <Button asChild size="lg" className="bg-gradient-primary hover:opacity-90 text-white font-semibold">
                    <a href="tel:+18447352070">
                      <RiPhoneLine className="w-4 h-4 mr-2" />
                      Call (844) 735-2070
                    </a>
                  </Button>
                </div>
              </div>
            ) : serviceTab !== "membership" && oneTimePricing ? (
              // ── One-time Standard / Deep Clean ──────────────────
              <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.04] p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Badge className="bg-primary/10 text-primary border-primary/40 mb-2">
                      <RiPercentLine className="w-3 h-3 mr-1" />
                      25% off · auto-applied
                    </Badge>
                    <h3 className="text-xl md:text-2xl font-bold font-jakarta">
                      {serviceTab === "deep" ? "Deep Clean" : "Standard Clean"}
                      {" — "}
                      <span className="text-muted-foreground font-normal text-base">
                        {selectedSize.label}
                      </span>
                    </h3>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-1">
                  {/* Total + strikethrough */}
                  <div className="rounded-lg border border-primary/15 bg-background/60 px-4 py-3">
                    <div className="text-xs text-muted-foreground line-through">
                      Regular: ${oneTimePricing.listPrice.toFixed(2)}
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="font-jakarta text-3xl md:text-4xl font-extrabold bg-gradient-primary bg-clip-text text-transparent">
                        ${oneTimePricing.total.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground">total / clean</span>
                    </div>
                    <p className="text-[11px] text-primary font-semibold mt-1">
                      You save ${(oneTimePricing.listPrice - oneTimePricing.total).toFixed(2)}
                    </p>
                  </div>

                  {/* Deposit + balance */}
                  <div className="rounded-lg border border-primary/15 bg-background/60 px-4 py-3 space-y-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Pay today (50% deposit)</span>
                      <span className="font-bold text-foreground">${oneTimePricing.deposit.toFixed(2)}</span>
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Auto-charged after service</span>
                      <span className="font-bold text-foreground">${oneTimePricing.balanceDue.toFixed(2)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Card is saved on file at booking — no second checkout step.
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleBookNow}
                  size="lg"
                  className="w-full bg-gradient-primary hover:opacity-90 text-white font-semibold"
                >
                  Book {serviceTab === "deep" ? "Deep Clean" : "Standard Clean"} — Pay ${oneTimePricing.deposit.toFixed(2)} Today
                  <RiArrowRightLine className="w-4 h-4 ml-2" />
                </Button>
              </div>
            ) : membershipPricing ? (
              // ── Glow Membership ─────────────────────────────────
              <div className="rounded-xl border-2 border-primary/30 bg-primary/[0.04] p-5 space-y-4">
                <div>
                  <Badge className="bg-primary/10 text-primary border-primary/40 mb-2">
                    <RiStarLine className="w-3 h-3 mr-1" />
                    Recurring · Up to 42% off per clean
                  </Badge>
                  <h3 className="text-xl md:text-2xl font-bold font-jakarta">
                    Novara Glow Membership
                    {" — "}
                    <span className="text-muted-foreground font-normal text-base">
                      {selectedSize.label}
                    </span>
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Same trusted team, every visit. Cancel or pause anytime.
                  </p>
                </div>

                {/* Frequency picker */}
                <div className="grid grid-cols-3 gap-2">
                  {MEMBER_FREQUENCIES.map((f) => {
                    const active = memberFreq === f.id;
                    const row = membershipPricing[f.id];
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setMemberFreq(f.id)}
                        className={cn(
                          "relative rounded-lg border-2 p-3 text-left transition-all hover:border-primary/60",
                          active
                            ? "border-primary bg-primary/[0.06] ring-2 ring-primary/20"
                            : "border-border bg-background",
                        )}
                      >
                        {f.highlight && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-gradient-primary text-white text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full">
                            Best Value
                          </span>
                        )}
                        <div className={cn("text-xs font-bold", active ? "text-primary" : "text-foreground")}>{f.label}</div>
                        <div className="text-[10px] text-muted-foreground">{f.cleans}</div>
                        <div className={cn("text-lg font-extrabold mt-1.5", active ? "bg-gradient-primary bg-clip-text text-transparent" : "text-foreground")}>
                          ${row.monthly}<span className="text-[10px] text-muted-foreground font-normal">/mo</span>
                        </div>
                        <div className="text-[10px] text-primary font-semibold mt-0.5">
                          Save ~{row.savingsPct}%
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected-plan breakdown */}
                <div className="grid sm:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-primary/15 bg-background/60 px-3 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Per month</div>
                    <div className="text-base font-bold text-foreground">${membershipPricing[memberFreq].monthly}</div>
                  </div>
                  <div className="rounded-lg border border-primary/15 bg-background/60 px-3 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Per clean</div>
                    <div className="text-base font-bold text-foreground">${membershipPricing[memberFreq].perClean.toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-primary/15 bg-background/60 px-3 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">vs one-time</div>
                    <div className="text-base font-bold text-primary">~{membershipPricing[memberFreq].savingsPct}% off</div>
                  </div>
                </div>

                <Button
                  onClick={handleBookNow}
                  size="lg"
                  className="w-full bg-gradient-primary hover:opacity-90 text-white font-semibold"
                >
                  Start {MEMBER_FREQUENCIES.find((f) => f.id === memberFreq)?.label} Membership
                  <RiArrowRightLine className="w-4 h-4 ml-2" />
                </Button>
              </div>
            ) : null}

            {/* Trust strip */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
              <span className="flex items-center gap-1.5">
                <RiShieldLine className="w-3.5 h-3.5 text-primary" /> Google Guaranteed
              </span>
              <span className="flex items-center gap-1.5">
                <RiFlashlightLine className="w-3.5 h-3.5 text-primary" /> 50% deposit · no balance invoice
              </span>
              <span className="flex items-center gap-1.5">
                <RiCheckLine className="w-3.5 h-3.5 text-primary" /> 48-hr re-clean guarantee
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── Offers strip ───────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-5xl pb-12">
        <div className="text-center mb-6">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Available offers</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Everything below applies automatically at checkout — no codes to remember.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="border-2 border-primary/30">
            <CardContent className="p-5 space-y-2">
              <Badge className="bg-primary/10 text-primary border-primary/40">
                <RiGiftLine className="w-3 h-3 mr-1" />
                New Customer
              </Badge>
              <h3 className="font-bold font-jakarta text-lg">25% Off First Clean</h3>
              <p className="text-sm text-muted-foreground">
                Auto-applied on Standard and Deep cleans. Stacks with no other promo needed.
              </p>
            </CardContent>
          </Card>
          <Card className="border-2 border-primary/30">
            <CardContent className="p-5 space-y-2">
              <Badge className="bg-primary/10 text-primary border-primary/40">
                <RiStarLine className="w-3 h-3 mr-1" />
                Glow Member
              </Badge>
              <h3 className="font-bold font-jakarta text-lg">Up to 42% Off Per Clean</h3>
              <p className="text-sm text-muted-foreground">
                Bi-Weekly is the best value (34% off). Weekly hits 42% off. Same team every visit.
              </p>
            </CardContent>
          </Card>
          <Card className="border-2 border-primary/30">
            <CardContent className="p-5 space-y-2">
              <Badge className="bg-primary/10 text-primary border-primary/40">
                <RiPercentLine className="w-3 h-3 mr-1" />
                Referral
              </Badge>
              <h3 className="font-bold font-jakarta text-lg">25% Off When You Refer</h3>
              <p className="text-sm text-muted-foreground">
                Your friends get 25% off their first clean, you earn a 25%-off credit when they complete it.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ─── Add-ons ─────────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-5xl pb-16">
        <div className="text-center mb-6">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Add-ons</h2>
          <p className="text-sm text-muted-foreground mt-1">Available with any service. Same price everywhere we serve.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(ADD_ONS).map(([key, addon]) => (
            <Card key={key} className="border border-border/60 hover:border-primary/30 transition-all">
              <CardContent className="p-4 text-center space-y-1">
                <p className="font-semibold">{addon.label}</p>
                <p className="text-2xl font-bold text-primary">+${addon.price}</p>
                <p className="text-xs text-muted-foreground">{addon.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────────── */}
      <section className="container mx-auto px-4 max-w-3xl pb-20 text-center space-y-5">
        <h2 className="text-2xl md:text-3xl font-bold font-jakarta">Ready when you are.</h2>
        <p className="text-muted-foreground">
          Book in under 2 minutes — 50% deposit today, the rest auto-charged after your cleaning is complete.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Button
            onClick={handleBookNow}
            size="lg"
            className="h-12 px-8 text-base font-semibold bg-gradient-primary hover:opacity-90 text-white shadow-lg"
          >
            Book Your Clean Now <RiArrowRightLine className="w-4 h-4 ml-2" />
          </Button>
          <a href="tel:+18447352070">
            <Button variant="outline" size="lg" className="h-12 px-8 text-base font-semibold border-primary/30 text-primary">
              <RiPhoneLine className="w-4 h-4 mr-2" />
              Call (844) 735-2070
            </Button>
          </a>
        </div>
      </section>
    </div>
  );
}
