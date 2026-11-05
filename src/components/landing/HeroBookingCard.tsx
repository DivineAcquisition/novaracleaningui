"use client";

// The hero's two-step card: ZIP, then contact details, then the booking flow
// at /book/sqft. The lead webhook and BookingContext hand-off are unchanged
// from the previous landing page so the booking funnel receives the same data.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiArrowRightLine, RiCheckboxCircleLine, RiMapPinLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";

export function HeroBookingCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateBookingData } = useBooking();
  const fbclid = searchParams.get("fbclid");

  const [zipCode, setZipCode] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [zipValidated, setZipValidated] = useState(false);
  const [cityState, setCityState] = useState("");

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
      .maybeSingle();
    setCityState(coverage ? `${coverage.city}, ${coverage.state}` : "");
    setIsValidating(false);
    setZipValidated(true);
    updateBookingData({ zipCode });
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email || !phone) return;
    setIsSubmitting(true);
    const formattedPhone = phone.replace(/\D/g, "");

    updateBookingData({ firstName, lastName, email, phone: formattedPhone });

    // Lead capture webhook with a client-side duplicate guard.
    let capturedEmails: string[] = [];
    try {
      capturedEmails = JSON.parse(localStorage.getItem("lead_captured_emails") || "[]");
    } catch {
      capturedEmails = [];
    }
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
          try {
            localStorage.setItem(
              "lead_captured_emails",
              JSON.stringify([...capturedEmails, email.toLowerCase()]),
            );
          } catch {
            /* storage unavailable — the server dedupes too */
          }
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

  const phoneDigits = phone.replace(/\D/g, "").length;

  return (
    <div
      id="get-price"
      className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 shadow-[0_24px_60px_-30px_rgba(22,4,63,0.35)] md:p-7"
    >
      {!zipValidated ? (
        <form onSubmit={handleZipSubmit} className="space-y-4">
          <div>
            <p className="font-heading text-lg font-bold text-foreground">See your price</p>
            <p className="text-sm text-muted-foreground">
              Start with your ZIP code. No card needed to see pricing.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="zipCode" className="block text-sm font-semibold">
              ZIP code
            </label>
            <div className="relative">
              <RiMapPinLine
                className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="zipCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="postal-code"
                maxLength={5}
                placeholder="e.g. 20814"
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
                className="h-14 pl-11 text-lg"
              />
            </div>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={zipCode.length !== 5 || isValidating}
            className="h-13 w-full text-base font-semibold"
          >
            {isValidating ? "Checking…" : "Get my price"}
            <RiArrowRightLine className="ml-2 h-5 w-5" aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <form onSubmit={handleContactSubmit} className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-primary/10 bg-primary/[0.06] p-3">
            <RiCheckboxCircleLine className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {cityState ? `We clean in ${cityState}.` : `Thanks. Next, your details for ${zipCode}.`}
              </p>
              <p className="text-xs text-muted-foreground">
                Your quote is built for your home on the next screen.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="firstName" className="block text-xs font-semibold">
                First name
              </label>
              <Input
                id="firstName"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lastName" className="block text-xs font-semibold">
                Last name
              </label>
              <Input
                id="lastName"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs font-semibold">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="phone" className="block text-xs font-semibold">
              Mobile phone
            </label>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="(301) 555-0123"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              className="h-11"
              required
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={!firstName || !lastName || !email || phoneDigits !== 10 || isSubmitting}
            className="h-13 w-full text-base font-semibold"
          >
            {isSubmitting ? "Opening your quote…" : "See my quote"}
            <RiArrowRightLine className="ml-2 h-5 w-5" aria-hidden="true" />
          </Button>
          <button
            type="button"
            onClick={handleChangeZip}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Change ZIP code ({zipCode})
          </button>
        </form>
      )}
    </div>
  );
}
