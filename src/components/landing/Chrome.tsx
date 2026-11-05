"use client";

// Page chrome and the interactive bits shared by server sections: header,
// "get my price" button, and the phone-only call / price bar.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { RiPhoneLine } from "@remixicon/react";
import { INBOUND_PHONE } from "@/config/brand-config";
import { HERO, NAV } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { scrollToBooking } from "./motion";
import { btnOutline, btnPrimary, gutter } from "./primitives";

export function PriceButton({ children, variant = "primary", className }: { children: ReactNode; variant?: "primary" | "outline"; className?: string }) {
  return (
    <button type="button" onClick={scrollToBooking} className={cn(variant === "primary" ? btnPrimary : btnOutline, className)}>
      {children}
    </button>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-md bg-white px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <div className="bg-[#0B0A11] px-4 py-2 text-center text-[13px] text-white/85">{HERO.offer}</div>
      <header
        className={cn(
          gutter,
          "sticky top-0 z-50 border-b bg-white/85 backdrop-blur-md transition-colors",
          scrolled ? "border-line" : "border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Novara Cleaning home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] rounded-[9px]" />
            <span className="text-[16px] font-medium tracking-[-0.02em] text-ink">Novara</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 rounded-xl border border-line bg-white/70 p-1 md:flex">
            {NAV.links.map((l) => (
              <a key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 text-[14px] text-ink-muted transition hover:bg-[#F6F5F9] hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/auth" className="hidden px-2 py-1.5 text-[14px] text-ink-muted hover:text-ink sm:inline">
              {NAV.signIn}
            </Link>
            <PriceButton className="h-10 px-4 text-[14px]">{NAV.cta}</PriceButton>
          </div>
        </div>
      </header>
    </>
  );
}

export function StickyMobileBar() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const form = document.getElementById("get-price");
    if (!form || typeof IntersectionObserver === "undefined") {
      setHidden(false);
      return;
    }
    const io = new IntersectionObserver((entries) => setHidden(entries.some((e) => e.isIntersecting)), { threshold: 0.1 });
    io.observe(form);
    return () => io.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid grid-cols-[1fr_1.5fr] gap-2 border-t border-line bg-white/95 px-3 pt-2 backdrop-blur transition-transform duration-200 md:hidden",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        hidden ? "translate-y-full" : "translate-y-0",
      )}
      aria-hidden={hidden}
    >
      <a href={INBOUND_PHONE.tel} tabIndex={hidden ? -1 : 0} className={cn(btnOutline, "h-12")}>
        <RiPhoneLine className="h-5 w-5 text-[#6810FE]" aria-hidden="true" />
        Call
      </a>
      <button type="button" tabIndex={hidden ? -1 : 0} onClick={scrollToBooking} className={cn(btnPrimary, "h-12")}>
        {NAV.cta}
      </button>
    </div>
  );
}

export function CookieSettingsLink() {
  return (
    <button
      type="button"
      onClick={() => {
        void import("@/components/compliance/CookieNotice").then((m) => m.openCookieSettings());
      }}
      className="text-[14px] text-ink-muted hover:text-ink"
    >
      Cookie settings
    </button>
  );
}
