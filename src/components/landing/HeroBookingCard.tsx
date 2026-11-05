"use client";

// The hero's booking form: ZIP first, then contact details, then the booking
// flow at /book/sqft. The lead webhook and BookingContext hand-off are the
// same as before, so the booking funnel receives the same data.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiArrowRightLine, RiCheckboxCircleFill, RiMapPin2Line } from "@remixicon/react";
import { useBooking } from "@/contexts/BookingContext";
import { supabase } from "@/integrations/supabase/client";
import { formatPhoneNumber } from "@/lib/input-formatters";
import { HERO } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { btnPrimary } from "./primitives";

const field =
  "relative rounded-[10px] border border-line bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors focus-within:border-[#6810FE]/50 focus-within:shadow-[0_0_0_3px_rgba(104,16,254,0.14)]";
const control =
  "block h-12 w-full border-0 bg-transparent px-4 text-[15px] font-medium tracking-tight text-ink placeholder:font-normal placeholder:text-ink-muted/70 focus:outline-none";
const label = "mb-1.5 block text-[13px] font-medium text-ink";

export function HeroBookingCard({ centered = false }: { centered?: boolean }) {
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

    let captured: string[] = [];
    try {
      captured = JSON.parse(localStorage.getItem("lead_captured_emails") || "[]");
    } catch {
      captured = [];
    }
    if (!captured.includes(email.toLowerCase())) {
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
            localStorage.setItem("lead_captured_emails", JSON.stringify([...captured, email.toLowerCase()]));
          } catch {
            /* storage unavailable; the server dedupes too */
          }
        })
        .catch((err) => console.error("Lead webhook error:", err));
    }
    router.push("/book/sqft");
  };

  const reset = () => {
    setZipValidated(false);
    setZipCode("");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
  };

  const phoneDigits = phone.replace(/\D/g, "").length;

  if (!zipValidated) {
    return (
      <form id="get-price" onSubmit={handleZipSubmit} className={cn("scroll-mt-28", centered && "w-full")} aria-label="Get your price">
        <label htmlFor="zipCode" className={cn(label, centered && "text-center")}>
          {HERO.zipLabel}
        </label>
        <div className={cn("flex flex-col gap-2.5 sm:flex-row", centered && "sm:justify-center")}>
          <div className={cn(field, centered ? "sm:flex-1" : "sm:w-56")}>
            <RiMapPin2Line className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              id="zipCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="postal-code"
              maxLength={5}
              placeholder={HERO.zipPlaceholder}
              value={zipCode}
              onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
              className={cn(control, "pl-10")}
            />
          </div>
          <button type="submit" disabled={zipCode.length !== 5 || isValidating} className={btnPrimary}>
            {isValidating ? "Checking…" : HERO.primaryCta}
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      id="get-price"
      onSubmit={handleContactSubmit}
      className="scroll-mt-28 w-full rounded-2xl border border-line bg-white p-5 text-left shadow-[0_24px_50px_-30px_rgba(11,10,17,0.35)]"
      aria-label="Your details"
    >
      <p className="flex items-start gap-2 text-[15px] font-medium text-ink">
        <RiCheckboxCircleFill className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
        {cityState ? `We clean in ${cityState}.` : `Got it: ${zipCode}.`} Where should we send your quote?
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="firstName" className={label}>First name</label>
          <div className={field}>
            <input id="firstName" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={control} required />
          </div>
        </div>
        <div>
          <label htmlFor="lastName" className={label}>Last name</label>
          <div className={field}>
            <input id="lastName" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={control} required />
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="email" className={label}>Email</label>
          <div className={field}>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={control} required />
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="phone" className={label}>Mobile phone</label>
          <div className={field}>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="(301) 555-0123"
              value={phone}
              onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              className={control}
              required
            />
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={!firstName || !lastName || !email || phoneDigits !== 10 || isSubmitting}
          className={btnPrimary}
        >
          {isSubmitting ? "Opening your quote…" : "See my quote"}
          <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={reset} className="text-[13px] font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          Change ZIP ({zipCode})
        </button>
      </div>
    </form>
  );
}
