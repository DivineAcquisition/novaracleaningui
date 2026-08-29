"use client";

import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCheckboxCircleLine,
  RiFlashlightLine,
  RiGroupLine,
  RiMapPinLine,
  RiPhoneLine,
  RiRepeatLine,
  RiShieldLine,
  RiSparklingLine,
  RiStarLine,
  RiTimeLine,
  RiTrophyLine
} from "@remixicon/react";
import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";

import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { RotatingSubheadline } from "@/components/booking/RotatingSubheadline";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { MagicCard } from "@/components/magicui/magic-card";
import { Marquee } from "@/components/magicui/marquee";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { Particles } from "@/components/magicui/particles";
import { ShineBorder } from "@/components/magicui/shine-border";
import { BRAND } from "@/lib/brand";
const logo = "/novara-logo.png";

const TRUST_STATS = [
  { label: "Homes Cleaned", value: 1200, suffix: "+", icon: RiCheckboxCircleLine },
  { label: "5-Star Reviews", value: 500, suffix: "+", icon: RiStarLine },
  { label: "Repeat Customers", value: 92, suffix: "%", icon: RiGroupLine },
  { label: "On-Time Rate", value: 99, suffix: "%", icon: RiTimeLine },
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
    description: "Our vetted, insured team arrives on time. Every time.",
    icon: RiFlashlightLine,
  },
];

const TESTIMONIALS = [
  {
    name: "Sarah M.",
    location: "Bethesda, MD",
    text: "Novara is the first cleaning service that actually shows up when they say they will. My home has never looked better.",
    rating: 5,
  },
  {
    name: "James R.",
    location: "Rockville, MD",
    text: "I signed up for the membership and it's been a game-changer. Same team every time, and they know exactly how I like things.",
    rating: 5,
  },
  {
    name: "Michelle T.",
    location: "Silver Spring, MD",
    text: "The deep clean exceeded my expectations. Every corner was spotless. Worth every penny.",
    rating: 5,
  },
];

const Index = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signOut } = useAuth();
  const { updateBookingData } = useBooking();
  const fbclid = searchParams.get('fbclid');
  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [zipValidated, setZipValidated] = useState(false);
  const [cityState, setCityState] = useState("");

  // Contact form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) return;
    setIsValidating(true);

    const { data: coverage } = await supabase
      .from("service_coverage_zones")
      .select("city, state")
      .eq("zip_code", zipCode)
      .eq("is_active", true)
      .single();
    if (coverage) {
      setCityState(`${coverage.city}, ${coverage.state}`);
    } else {
      setCityState("your area");
    }
    setIsValidating(false);
    setZipValidated(true);
    updateBookingData({ zipCode });
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    setIsSubmitting(true);
    const formattedPhone = phone.replace(/\D/g, "");

    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
    });

    // Send lead capture webhook with client-side duplicate guard
    const capturedEmails: string[] = JSON.parse(localStorage.getItem('lead_captured_emails') || '[]');
    if (!capturedEmails.includes(email.toLowerCase())) {
      supabase.functions
        .invoke("send-lead-capture-webhook", {
          body: {
            firstName,
            lastName,
            email,
            phone: formattedPhone,
            zipCode,
            city: cityState.split(", ")[0] || "",
            state: cityState.split(", ")[1] || "",
            source: "Website",
            landingPage: "/",
            fbclid: fbclid || undefined,
          },
        })
        .then(() => {
          const updated = [...capturedEmails, email.toLowerCase()];
          localStorage.setItem('lead_captured_emails', JSON.stringify(updated));
        })
        .catch((err) => console.error("Lead webhook error:", err));
    }
    router.push("/book/sqft");
  };

  const handleChangeZip = () => {
    setZipValidated(false);
    setZipCode("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhoneNumber(e.target.value);
    setPhone(formatted);
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Professional Home Cleaning in Maryland & DMV"
        description="Book top-rated home cleaning in the DMV area. Google Guaranteed cleaners, $99 first clean, transparent pricing, and 100% satisfaction guarantee. Book online in 60 seconds."
        canonical="https://novaracleaning.com"
      />
      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl hairline-glow">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="Novara Cleaning"
              className="w-9 h-9 rounded-xl"
            />
            <span className="text-lg font-bold tracking-tight font-heading">
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
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => router.push("/auth")}
            >
              Sign In
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <Particles
          className="absolute inset-0 z-0"
          quantity={48}
          color={BRAND.primary}
          ease={80}
          size={0.5}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] via-background to-background" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/[0.04] rounded-full blur-3xl" />

        <div className="relative container mx-auto px-4 pt-16 pb-20 md:pt-24 md:pb-28">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <BlurFade delay={0.04} inView>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/[0.04] backdrop-blur-sm">
                <RiShieldLine className="w-4 h-4 text-primary" />
                <AnimatedShinyText className="mx-0 max-w-none text-sm font-medium text-primary">
                  Google Guaranteed & Fully Insured
                </AnimatedShinyText>
              </div>
            </BlurFade>

            <BlurFade delay={0.1} inView>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight font-heading leading-[1.1]">
                Stop Spending Your
                <br />
                <span className="text-gradient">
                  One Day Off
                </span>{" "}
                Cleaning.
              </h1>
            </BlurFade>

            <p className="text-xl md:text-2xl lg:text-3xl font-bold font-heading">
              <span className="text-gradient">
                25% Off
              </span>{" "}
              Your First Cleaning
            </p>

            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Premium residential cleaning by vetted professionals. We show up
              on time, every time — so you can enjoy your weekends again.
            </p>

            {/* Rotating value-prop carousel: no call required / instant
                pricing / next-day availability. */}
            <RotatingSubheadline />

            {/* Booking Card */}
            <Card className="relative max-w-md mx-auto overflow-hidden panel">
              <ShineBorder borderWidth={1.5} duration={14} />
              <CardContent className="relative z-10 p-6 md:p-8">
                {/* ZIP Code Form */}
                <div
                  className={`transition-all duration-500 ease-out ${
                    zipValidated
                      ? "h-0 opacity-0 overflow-hidden"
                      : "h-auto opacity-100"
                  }`}
                >
                  <form onSubmit={handleZipSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <label
                        htmlFor="zipCode"
                        className="text-sm font-semibold text-left block"
                      >
                        Enter Your ZIP Code
                      </label>
                      <Input
                        id="zipCode"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={5}
                        placeholder="e.g. 20814"
                        value={zipCode}
                        onChange={(e) =>
                          setZipCode(e.target.value.replace(/\D/g, ""))
                        }
                        className="h-14 text-lg text-center bg-background/50 border-border/60"
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">
                        Check availability and see instant pricing
                      </p>
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      disabled={zipCode.length !== 5 || isValidating}
                      className="w-full h-13 text-base font-semibold bg-gradient-primary hover:opacity-90 transition-opacity"
                    >
                      {isValidating ? "Checking..." : "Get My Price"}
                      <RiArrowRightLine className="w-5 h-5 ml-2" />
                    </Button>
                  </form>
                </div>

                {/* Contact Details Form */}
                <div
                  className={`transition-all duration-500 ease-out ${
                    zipValidated
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-4 h-0 overflow-hidden"
                  }`}
                >
                  <form
                    onSubmit={handleContactSubmit}
                    className="space-y-4"
                  >
                    {/* Success Message */}
                    <div className="flex items-start gap-3 p-3 bg-primary/[0.06] rounded-xl border border-primary/10">
                      <RiCheckboxCircleLine className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="text-left">
                        <p className="font-semibold text-sm text-foreground">
                          We service {cityState}!
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Enter your details to see your personalized quote
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="firstName"
                          className="text-xs font-semibold text-left block"
                        >
                          First Name
                        </label>
                        <Input
                          id="firstName"
                          type="text"
                          placeholder="John"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          className="h-11 bg-background/50"
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="lastName"
                          className="text-xs font-semibold text-left block"
                        >
                          Last Name
                        </label>
                        <Input
                          id="lastName"
                          type="text"
                          placeholder="Smith"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          className="h-11 bg-background/50"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="email"
                        className="text-xs font-semibold text-left block"
                      >
                        Email
                      </label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-11 bg-background/50"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="phone"
                        className="text-xs font-semibold text-left block"
                      >
                        Phone Number
                      </label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="(301) 555-0123"
                        value={phone}
                        onChange={handlePhoneChange}
                        className="h-11 bg-background/50"
                        required
                      />
                    </div>

                    <Button
                      type="submit"
                      size="lg"
                      disabled={
                        !firstName ||
                        !lastName ||
                        !email ||
                        phone.replace(/\D/g, "").length !== 10 ||
                        isSubmitting
                      }
                      className="w-full h-13 text-base font-semibold bg-gradient-primary hover:opacity-90 transition-opacity"
                    >
                      {isSubmitting ? "Processing..." : "See My Quote"}
                      <RiArrowRightLine className="w-5 h-5 ml-2" />
                    </Button>

                    <button
                      type="button"
                      onClick={handleChangeZip}
                      className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                    >
                      Change ZIP code ({zipCode})
                    </button>
                  </form>
                </div>
              </CardContent>
            </Card>

            {/* Sub-text */}
            <p className="text-xs text-muted-foreground">
              No credit card required to see pricing. Cancel anytime.
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof Stats */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {TRUST_STATS.map((stat, i) => (
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
      <section className="container mx-auto px-4 py-16 md:py-24">
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

      {/* Why Novara */}
      <section className="bg-muted/30 border-y border-border/40">
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
                  icon: RiShieldLine,
                  title: "Fully Insured & Bonded",
                  description:
                    "Every team is background-checked, insured, and bonded for your peace of mind.",
                },
                {
                  icon: RiTimeLine,
                  title: "Always On Time",
                  description:
                    "99% on-time arrival rate. If we're late, your next clean is on us.",
                },
                {
                  icon: RiSparklingLine,
                  title: "48-Hour Re-Clean Guarantee",
                  description:
                    "Not satisfied? We'll come back within 48 hours and re-clean for free.",
                },
                {
                  icon: RiTrophyLine,
                  title: "Google Guaranteed",
                  description:
                    "Backed by Google's $2,000 guarantee. Your home is in trusted hands.",
                },
                {
                  icon: RiGroupLine,
                  title: "Same Team Every Time",
                  description:
                    "Members get the same trusted cleaning team for every visit.",
                },
                {
                  icon: RiCalendarCheckLine,
                  title: "Flexible Scheduling",
                  description:
                    "Book, reschedule, or cancel anytime. No long-term contracts.",
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

      {/* Testimonials */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <Badge
              variant="secondary"
              className="mb-4 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
            >
              Testimonials
            </Badge>
            <h2 className="text-3xl md:text-4xl font-bold font-heading">
              Loved by Homeowners
            </h2>
          </div>

          <div className="relative overflow-hidden">
            <Marquee pauseOnHover className="[--duration:42s]">
              {TESTIMONIALS.map((testimonial) => (
                <Card
                  key={testimonial.name}
                  className="w-[280px] shrink-0"
                >
                  <CardContent className="p-5 space-y-4">
                    <div className="flex gap-0.5">
                      {Array.from({ length: testimonial.rating }).map((_, i) => (
                        <RiStarLine
                          key={i}
                          className="w-4 h-4 fill-amber-400 text-amber-400"
                        />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed italic">
                      "{testimonial.text}"
                    </p>
                    <div>
                      <p className="text-sm font-semibold">{testimonial.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {testimonial.location}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </Marquee>
          </div>
        </div>
      </section>

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
              Join 1,200+ homeowners who trust Novara for their cleaning needs.
              Book your first clean today.
            </p>
            <Button
              size="lg"
              className="h-14 px-10 text-base font-semibold bg-gradient-primary hover:opacity-90 transition-opacity shadow-lg"
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

      {/* Footer */}
      <footer className="border-t border-border/40 bg-muted/20">
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-8">
              {/* Brand */}
              <div className="flex flex-col items-center md:items-start gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={logo}
                    alt="Novara Cleaning"
                    className="w-8 h-8 rounded-lg"
                  />
                  <span className="text-base font-bold font-heading">
                    Novara<span className="text-primary">Cleaning</span>
                  </span>
                </div>
                <p className="text-sm text-muted-foreground text-center md:text-left max-w-xs">
                  Premium residential cleaning service. Trusted, insured, and
                  Google Guaranteed.
                </p>
              </div>

              {/* Links */}
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <a
                  href="https://novaracleaning.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  Privacy Policy
                </a>
                <a
                  href="https://novaracleaning.com/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  Terms of Service
                </a>
                <a
                  href="tel:+18447352070"
                  className="hover:text-foreground transition-colors"
                >
                  (844) 735-2070
                </a>
                <a
                  href="mailto:support@novaracleaning.com"
                  className="hover:text-foreground transition-colors"
                >
                  support@novaracleaning.com
                </a>
              </div>
            </div>

            <Separator className="my-6" />

            <p className="text-xs text-center text-muted-foreground">
              &copy; {new Date().getFullYear()} Novara Cleaning LLC. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
