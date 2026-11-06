"use client";

import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiMapPinLine,
  RiPhoneLine,
  RiShieldLine,
  RiSparklingLine,
  RiTimeLine,
  RiListCheck2,
  RiShoppingBasket2Line,
  RiPriceTag3Line,
  RiUserLine,
} from "@/components/icons";
import { type ReactNode } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookingStartForm } from "@/components/booking/BookingStartForm";

import { SiteHeader, StickyMobileBar } from "@/components/landing/Chrome";
import { INBOUND_PHONE } from "@/config/brand-config";
import { SiteFooter } from "@/components/landing/Footer";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { MagicCard } from "@/components/magicui/magic-card";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { ShineBorder } from "@/components/magicui/shine-border";

// True, checkable facts from the booking code: online discounts, the re-clean
// window, and the deposit most bookings take.
const FACTS = [
  { label: "Off a standard clean booked online", value: 15, suffix: "%", icon: RiPriceTag3Line },
  { label: "Off a deep clean booked online", value: 25, suffix: "%", icon: RiSparklingLine },
  { label: "Free re-clean window", value: 24, suffix: " hr", icon: RiTimeLine },
  { label: "Deposit to book most cleans", value: 50, suffix: "%", icon: RiCheckboxCircleLine },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Enter Your ZIP",
    description: "Check if we service your area and see instant pricing.",
    icon: RiMapPinLine,
  },
  {
    step: "2",
    title: "Choose Your Service",
    description: "Select from deep clean, standard, or recurring plans.",
    icon: RiCalendarCheckLine,
  },
  {
    step: "3",
    title: "We Show Up",
    description: "Your cleaner brings supplies and works from the written checklist.",
    icon: RiFlashlightLine,
  },
];

type IndexProps = {
  /** "Standard from $X" after the online discount, from the checkout tables. */
  standardFrom?: string | null;
  /** Sections rendered after How it works and after Why Novara. */
  afterHow?: ReactNode;
  afterWhy?: ReactNode;
};

const Index = ({ standardFrom = null, afterHow = null, afterWhy = null }: IndexProps) => {
  return (
    <div className="book-theme landing min-h-screen bg-background">
      <SEO
        title="Professional Home Cleaning in Maryland & DMV"
        description="Book home cleaning in Maryland, DC and Northern Virginia. See the exact price for your home, a written checklist on every visit, and a 24-hour re-clean guarantee."
        canonical="https://try.novaracleaning.com/"
      />
      <SiteHeader withMenus />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] via-background to-background" />

        <div className="relative container mx-auto px-4 pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <BlurFade delay={0.04} inView>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/[0.04] backdrop-blur-sm">
                <RiMapPinLine className="w-4 h-4 text-primary" />
                <AnimatedShinyText className="mx-0 max-w-none text-sm font-medium text-primary">
                  <span className="sm:hidden">House cleaning · MD, DC &amp; VA</span>
                  <span className="hidden sm:inline">House cleaning in Maryland, DC &amp; Northern Virginia</span>
                </AnimatedShinyText>
              </div>
            </BlurFade>

            <h1 className="text-[2.05rem] sm:text-5xl lg:text-6xl !font-bold tracking-tight font-heading leading-[1.1]">
              Stop Spending Your
              <br />
              <span className="text-[#6810FE]">
                One Day Off
              </span>{" "}
              Cleaning.
            </h1>

            <p className="mx-auto max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
              <span className="font-heading text-xl font-bold text-foreground md:text-2xl">
                <span className="text-[#6810FE]">Standard 15% off. Deep 25% off.</span>
              </span>{" "}
              Enter your ZIP code and we will show the price for your home. Most bookings take a 50% deposit.
            </p>

            {/* Booking Card */}
            <Card id="get-price" className="relative max-w-md mx-auto overflow-hidden panel scroll-mt-28">
              <ShineBorder borderWidth={1.5} duration={14} />
              <CardContent className="relative z-10 p-6 md:p-8">
                <BookingStartForm />
              </CardContent>
            </Card>

            {/* Sub-text */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {standardFrom ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                  <RiPriceTag3Line className="h-3.5 w-3.5 text-primary" />
                  Standard clean from {standardFrom} online
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                <RiShieldLine className="h-3.5 w-3.5 text-primary" />
                24-hour re-clean guarantee
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                <RiListCheck2 className="h-3.5 w-3.5 text-primary" />
                Written checklist every visit
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              No credit card required to see pricing. Prefer to talk?{" "}
              <a href={INBOUND_PHONE.tel} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
                <RiPhoneLine className="h-4 w-4 text-primary" />
                {INBOUND_PHONE.display}
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof Stats */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {FACTS.map((stat, i) => (
              <BlurFade key={stat.label} delay={0.04 * i} inView>
                <div className="text-center space-y-2">
                  <stat.icon className="w-6 h-6 text-primary mx-auto" />
                  <p className="text-2xl md:text-3xl font-extrabold font-heading text-foreground">
                    <NumberTicker value={stat.value} />
                    {stat.suffix}
                  </p>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                </div>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how" className="scroll-mt-20 container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <Badge
              variant="secondary"
              className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
            >
              How It Works
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold font-heading">
              Book in Under 2 Minutes
            </h2>
            <p className="text-muted-foreground mt-3 text-lg">
              Simple, transparent, no-surprise pricing.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 md:gap-8">
            {HOW_IT_WORKS.map((item, i) => (
              <BlurFade key={item.step} delay={0.08 * i} inView>
                <Card className="relative overflow-hidden panel-hover group">
                  <MagicCard className="rounded-2xl">
                    <CardContent className="relative z-10 p-6 text-center space-y-4">
                      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/[0.08] group-hover:bg-primary/[0.12] transition-colors">
                        <item.icon className="w-7 h-7 text-primary" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-primary uppercase tracking-wider">
                          Step {item.step}
                        </p>
                        <h3 className="text-lg font-bold font-heading">
                          {item.title}
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </CardContent>
                  </MagicCard>
                </Card>
              </BlurFade>
            ))}
          </div>
        </div>
      </section>

      {afterHow}

      {/* Why Novara */}
      <section id="why" className="scroll-mt-20 bg-muted/30 border-y border-border/40">
        <div className="container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <Badge
                variant="secondary"
                className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
              >
                Why Novara
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold font-heading">
                The Premium Standard
              </h2>
              <p className="text-muted-foreground mt-3 text-lg">
                What sets us apart from every other cleaning service.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 md:gap-5">
              {[
                {
                  icon: RiPriceTag3Line,
                  title: "The Price Comes First",
                  description:
                    "You see the price for your home before you book. No surprise fees at the door.",
                },
                {
                  icon: RiListCheck2,
                  title: "A Written Checklist",
                  description:
                    "Every service has a written checklist. Your cleaner works from it, and you can hold us to it.",
                },
                {
                  icon: RiSparklingLine,
                  title: "24-Hour Re-Clean Guarantee",
                  description:
                    "Missed something? Tell us within 24 hours and we come back to re-clean it free.",
                },
                {
                  icon: RiShoppingBasket2Line,
                  title: "Supplies Included",
                  description:
                    "Your cleaner brings the products and equipment. You don't need to buy anything.",
                },
                {
                  icon: RiUserLine,
                  title: "A Dedicated Cleaner",
                  description:
                    "Bi-weekly and weekly members get a dedicated cleaner who learns your home.",
                },
                {
                  icon: RiShieldLine,
                  title: "Insured",
                  description:
                    "Novara Cleaning carries business insurance. Ask us for the certificate.",
                },
              ].map((feature) => (
                <Card
                  key={feature.title}
                  className="border border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/20 transition-all duration-300"
                >
                  <CardContent className="p-5 flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-primary/[0.08] flex items-center justify-center">
                        <feature.icon className="w-5 h-5 text-primary" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm">{feature.title}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {afterWhy}

      {/* CTA Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.06] to-accent/[0.04]" />
        <div className="relative container mx-auto px-4 py-16 md:py-24">
          <div className="relative max-w-2xl mx-auto overflow-hidden rounded-3xl panel p-10 sm:p-12 text-center space-y-6">
            <BorderBeam size={120} duration={8} />
            <h2 className="text-3xl md:text-4xl font-bold font-heading">
              Ready for a Spotless Home?
            </h2>
            <p className="text-lg text-muted-foreground">
              See the price for your home in under a minute, then pick a
              day. Book your first clean today.
            </p>
            <Button
              size="lg"
              className="h-14 px-10 text-base font-semibold"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Book Your Clean
              <RiArrowRightLine className="w-5 h-5 ml-2" />
            </Button>
            <p className="text-xs text-muted-foreground">
              Pay 50% deposit on total to book. No hidden fees.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
      <StickyMobileBar />
    </div>
  );
};

export default Index;
