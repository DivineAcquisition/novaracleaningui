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
} from "@remixicon/react";
import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Particles } from "@/components/magicui/particles";
import { ShineBorder } from "@/components/magicui/shine-border";
import { BRAND } from "@/lib/brand";
import { CANCEL_SUMMARY, OFFER_SUMMARY, PAYMENT_SUMMARY, PROMISE_SUMMARY } from "@/lib/public-site";
import { SiteLegalFooter } from "@/components/site/SiteLegalFooter";
const logo = "/novara-logo.png";

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
    description: "An insured team arrives for the visit you booked.",
    icon: RiFlashlightLine,
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
        description="Book home cleaning in the DMV. Standard cleans are 15% off the regular price and deep cleans are 25% off. Insured. Most bookings take a 50% deposit."
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
                  Insured
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

            <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {OFFER_SUMMARY}
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
                      className="w-full h-13 text-base font-semibold"
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
                      className="w-full h-13 text-base font-semibold"
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
              No card is required to see the price. {CANCEL_SUMMARY}
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof Stats */}
      <section className="border-y border-border/40 bg-muted/30">
        <div className="container mx-auto px-4 py-10 md:py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            <p className="text-center text-sm text-muted-foreground">
              {PROMISE_SUMMARY}
            </p>
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
                  title: "Insured",
                  description: "General liability insurance.",
                },
                {
                  icon: RiSparklingLine,
                  title: "Re-clean promise",
                  description: PROMISE_SUMMARY,
                },
                {
                  icon: RiCalendarCheckLine,
                  title: "Notice to change a visit",
                  description: CANCEL_SUMMARY,
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
              See the price for your home, then book if it works.
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
              {PAYMENT_SUMMARY}
            </p>
          </div>
        </div>
      </section>

      <SiteLegalFooter />
    </div>
  );
};

export default Index;
