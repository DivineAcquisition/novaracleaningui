"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useBooking } from "@/contexts/BookingContext";
import { ArrowRight, CheckCircle } from "lucide-react";
import { HeaderNav } from "@/components/HeaderNav";
import { BookingFooter } from "@/components/booking/BookingFooter";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";

export default function Home() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { updateBookingData } = useBooking();
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

  const handleSignOut = async () => {
    await signOut();
  };

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) return;
    setIsValidating(true);

    // Check if ZIP is in service coverage
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

    // Update booking data
    updateBookingData({
      firstName,
      lastName,
      email,
      phone: formattedPhone,
    });

    // Send lead capture webhook (fire and forget)
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
        },
      })
      .catch((err) => console.error("Lead webhook error:", err));

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
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <HeaderNav onSignOut={handleSignOut} />

      {/* Promo Banner */}
      <div className="bg-gradient-primary py-3">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-center gap-2 text-white">
            <p className="text-sm md:text-base text-center font-semibold">
              We Show Up. On Time. Every Time.
            </p>
          </div>
        </div>
      </div>

      {/* Hero + Booking Section */}
      <section className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-3xl md:text-4xl tracking-tight text-center font-extrabold font-jakarta mx-auto max-w-4xl lg:text-4xl">
              Stop Spending Your One Day Off Scrubbing Bathrooms.
            </h1>
            <p className="text-[#2c2c2c] font-normal md:text-sm text-sm">
              Enter your ZIP to get started
            </p>
          </div>

          {/* ZIP Code Entry or Contact Form */}
          <Card variant="outlined" className="border-primary/30 shadow-card overflow-hidden">
            <CardContent className="pt-8 pb-8 space-y-6">
              {/* ZIP Code Form */}
              <div
                className={`transition-all duration-500 ease-out ${
                  zipValidated ? "h-0 opacity-0 overflow-hidden" : "h-auto opacity-100"
                }`}
              >
                <form onSubmit={handleZipSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="zipCode" className="text-sm font-medium text-left block">
                      Enter Your ZIP Code
                    </label>
                    <Input
                      id="zipCode"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={5}
                      placeholder="12345"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                      className="h-14 text-lg text-center"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground">
                      We&apos;ll check if we service your area
                    </p>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={zipCode.length !== 5 || isValidating}
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                  >
                    {isValidating ? "Checking..." : "Continue"}
                    <ArrowRight className="w-4 h-4 md:w-5 md:h-5 ml-2" />
                  </Button>
                </form>
              </div>

              {/* Contact Details Form - Animated */}
              <div
                className={`transition-all duration-500 ease-out ${
                  zipValidated
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4 h-0 overflow-hidden"
                }`}
              >
                <form onSubmit={handleContactSubmit} className="space-y-5">
                  {/* Success Message */}
                  <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg animate-fade-in">
                    <CheckCircle className="w-6 h-6 text-primary flex-shrink-0 mt-0.5" />
                    <div className="text-left">
                      <p className="font-semibold text-foreground">
                        Great news! We service {cityState}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Enter your details to claim your New Year discount
                      </p>
                    </div>
                  </div>

                  {/* Name Fields */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="firstName" className="text-sm font-medium text-left block">
                        First Name
                      </label>
                      <Input
                        id="firstName"
                        type="text"
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="lastName" className="text-sm font-medium text-left block">
                        Last Name
                      </label>
                      <Input
                        id="lastName"
                        type="text"
                        placeholder="Smith"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="h-12"
                        required
                      />
                    </div>
                  </div>

                  {/* Email Field */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-left block">
                      Email
                    </label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Phone Field */}
                  <div className="space-y-2">
                    <label htmlFor="phone" className="text-sm font-medium text-left block">
                      Phone Number
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="(972) 555-0123"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="h-12"
                      required
                    />
                  </div>

                  {/* Submit Button */}
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
                    className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-primary"
                  >
                    {isSubmitting ? "Processing..." : "Claim My Discount →"}
                  </Button>

                  {/* Change ZIP Link */}
                  <button
                    type="button"
                    onClick={handleChangeZip}
                    className="text-sm text-primary hover:text-primary-hover underline underline-offset-2"
                  >
                    ← Change ZIP code ({zipCode})
                  </button>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <BookingFooter />
    </div>
  );
}
