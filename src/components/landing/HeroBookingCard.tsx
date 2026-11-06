"use client";

// The landing page's ZIP box. It hands the visitor to the booking flow
// (the ZIP form on try.novaracleaning.com) with the ZIP filled in; the booking flow
// checks coverage, captures the lead, and continues from there. Attribution
// parameters on the landing URL (ref, fbclid, utm_*) are passed along.

import { useState } from "react";
import { RiArrowRightLine, RiMapPin2Line } from "@/components/icons";
import { HERO } from "@/lib/landing/content";
import { bookingHref } from "@/lib/landing/links";
import { cn } from "@/lib/utils";
import { btnPrimary } from "./primitives";

const field =
  "relative rounded-[10px] border border-line bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition-colors focus-within:border-[#6810FE]/50 focus-within:shadow-[0_0_0_3px_rgba(104,16,254,0.14)]";
const control =
  "block h-12 w-full border-0 bg-transparent px-4 text-[15px] font-medium tracking-tight text-ink placeholder:font-normal placeholder:text-ink-muted/70 focus:outline-none";

export function HeroBookingCard({ centered = false }: { centered?: boolean }) {
  const [zipCode, setZipCode] = useState("");
  const [going, setGoing] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (zipCode.length !== 5) return;
    setGoing(true);
    window.location.assign(bookingHref("/", { zip: zipCode }));
  };

  return (
    <form id="get-price" onSubmit={submit} className={cn("scroll-mt-28", centered && "w-full")} aria-label="Get your price">
      <label htmlFor="zipCode" className={cn("mb-1.5 block text-[13px] font-medium text-ink", centered && "text-center")}>
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
        <button type="submit" disabled={zipCode.length !== 5 || going} className={btnPrimary}>
          {going ? "Opening…" : HERO.primaryCta}
          <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
