"use client";

// Small interactive pieces for the main home page (novaracleaning.com).

import { useEffect, useRef, useState } from "react";
import { RiCheckLine, RiPhoneLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { useInViewSequence } from "@/components/landing/motion";
import { btnOutline, btnPrimary } from "@/components/landing/primitives";
import { TRY_URL, bookingHref } from "@/lib/landing/links";
import { cn } from "@/lib/utils";

/** Checklist card that ticks off its items when it scrolls into view. Complete under reduced motion. */
export function TickingChecklist({ title, items, className }: { title: string; items: string[]; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const done = useInViewSequence(ref, items.length, 520);
  return (
    <div ref={ref} className={cn("rounded-2xl border border-line bg-white/95 p-4 shadow-[0_24px_50px_-24px_rgba(11,10,17,0.45)] backdrop-blur", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5A1FD6]">{title}</p>
        <span className="rounded-full bg-[#F3EEFF] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#5A1FD6]">
          {done}/{items.length}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item, i) => {
          const checked = i < done;
          return (
            <li key={item} className="flex items-start gap-2.5 text-[13px] text-ink">
              <span
                className={cn(
                  "mt-px grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-[5px] border transition-all duration-300",
                  checked ? "border-[#6810FE] bg-[#6810FE] text-white" : "border-line bg-white text-transparent",
                )}
              >
                <RiCheckLine className="h-3 w-3" />
              </span>
              <span className={cn("transition-colors duration-300", checked ? "text-ink" : "text-ink-muted")}>{item}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Book Now" link to the try site, carrying ad and referral parameters from this page. */
export function BookNowLink({ children, className }: { children: React.ReactNode; className?: string }) {
  const [href, setHref] = useState(TRY_URL);
  useEffect(() => setHref(bookingHref(TRY_URL)), []);
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

/** Phone-only bottom bar: Call and Book Now. Appears after the hero scrolls away. */
export function HomeMobileBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("home-hero");
    if (!hero || typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setShow(!entries.some((e) => e.isIntersecting)), { threshold: 0.05 });
    io.observe(hero);
    return () => io.disconnect();
  }, []);
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-[1fr_1.5fr] gap-2 border-t border-line bg-white/95 px-3 pt-2 backdrop-blur transition-transform duration-200 md:hidden",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        show ? "translate-y-0" : "translate-y-full",
      )}
      aria-hidden={!show}
    >
      <a href={INBOUND_PHONE.tel} tabIndex={show ? 0 : -1} className={cn(btnOutline, "h-12")}>
        <RiPhoneLine className="h-5 w-5 text-[#6810FE]" />
        Call
      </a>
      <BookNowLink className={cn(btnPrimary, "h-12")}>Book Now</BookNowLink>
    </div>
  );
}

/**
 * Links across the site send "Book now" to "/#get-price" (the ZIP form). On
 * novaracleaning.com "/" is this home page, which has no form, so forward
 * those visits to the booking site, keeping the query (plan, ZIP, ads).
 */
export function ForwardBookingLinks() {
  useEffect(() => {
    if (window.location.hash !== "#get-price") return;
    window.location.replace(`${TRY_URL.replace(/\/$/, "")}/${window.location.search}#get-price`);
  }, []);
  return null;
}
