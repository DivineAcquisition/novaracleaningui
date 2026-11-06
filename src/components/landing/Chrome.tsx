"use client";

// Page chrome and the interactive bits shared by server sections: header,
// "get my price" button, and the phone-only call / price bar.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowsClockwise,
  Bed,
  Briefcase,
  Buildings,
  CaretDown,
  ClipboardText,
  Key,
  List,
  ListChecks,
  Path,
  Phone,
  Question,
  SealCheck,
  Sparkle,
  SprayBottle,
  Truck,
  X,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { RiPhoneLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { MENUS, NAV, PROMO } from "@/lib/landing/content";
import { BOOK_PATH } from "@/lib/landing/links";
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

const MENU_ICONS: Record<string, PhosphorIcon> = {
  sparkles: Sparkle,
  spray: SprayBottle,
  truck: Truck,
  repeat: ArrowsClockwise,
  list: ListChecks,
  bed: Bed,
  key: Key,
  building: Buildings,
  clipboard: ClipboardText,
  route: Path,
  shield: SealCheck,
  phone: Phone,
  help: Question,
  briefcase: Briefcase,
};

/** The Thanksgiving promo strip, shared by the marketing site and the booking flow. */
export function PromoBanner({ showCta = true }: { showCta?: boolean }) {
  if (!PROMO.active) return null;
  return (
    <div className="bg-[#16043F] px-4 py-2 text-center text-[13.5px] text-white">
      <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        <span aria-hidden="true">🦃</span>
        <strong className="font-semibold">{PROMO.text}</strong>
        {showCta ? (
          <a href={BOOK_PATH} className="inline-flex items-center gap-1 font-medium text-[#C9B6FF] underline-offset-4 hover:text-white hover:underline">
            {PROMO.cta}
            <ArrowRight className="h-3.5 w-3.5" weight="bold" aria-hidden="true" />
          </a>
        ) : null}
      </span>
    </div>
  );
}

/** Logo and the full company name. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/novara-logo.png" alt="" width={36} height={36} className="h-9 w-9 rounded-[10px]" />
      <span className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em] text-ink">Novara Cleaning</span>
    </span>
  );
}

function MenuItemLink({ item, onNavigate }: { item: (typeof MENUS)[number]["items"][number]; onNavigate?: () => void }) {
  const Icon = MENU_ICONS[item.icon] ?? Sparkle;
  const external = item.href.startsWith("http");
  return (
    <a
      href={item.href}
      onClick={onNavigate}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className="group flex items-start gap-3 rounded-xl p-2.5 transition hover:bg-[#F6F5F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]"
    >
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-[#F3EEFF] text-[#6810FE] transition group-hover:bg-[#6810FE] group-hover:text-white">
        <Icon className="h-5 w-5" weight="duotone" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[14.5px] font-medium text-ink">
          {item.title}
          {external ? <ArrowUpRight className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" /> : null}
        </span>
        <span className="block text-[13px] leading-snug text-ink-muted">{item.body}</span>
      </span>
    </a>
  );
}

/** Site header. `withMenus` adds the dropdown nav; only the main landing page passes it. */
export function SiteHeader({ withMenus = false }: { withMenus?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(MENUS[0].label);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-md bg-white px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <PromoBanner />
      <header
        className={cn(
          gutter,
          "sticky top-0 z-50 border-b bg-white/90 backdrop-blur-md transition-colors",
          scrolled || mobileOpen ? "border-line" : "border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4">
          <Link href="/" aria-label="Novara Cleaning home" onClick={() => setMobileOpen(false)}>
            <BrandMark />
          </Link>

          {withMenus ? (
          <NavigationMenu.Root className="relative hidden lg:block" delayDuration={80}>
            <NavigationMenu.List className="flex items-center gap-0.5">
              {MENUS.map((menu) => (
                <NavigationMenu.Item key={menu.label}>
                  <NavigationMenu.Trigger className="group inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[14.5px] text-ink-muted transition hover:bg-[#F6F5F9] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] data-[state=open]:bg-[#F6F5F9] data-[state=open]:text-ink">
                    {menu.label}
                    <CaretDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden="true" />
                  </NavigationMenu.Trigger>
                  <NavigationMenu.Content className="absolute left-0 top-0 w-[380px] p-2">
                    <ul className="grid gap-0.5">
                      {menu.items.map((item) => (
                        <li key={item.title}>
                          <NavigationMenu.Link asChild>
                            <MenuItemLink item={item} />
                          </NavigationMenu.Link>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenu.Content>
                </NavigationMenu.Item>
              ))}
            </NavigationMenu.List>
            <div className="absolute left-0 top-full flex justify-center pt-2">
              <NavigationMenu.Viewport className="relative h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_50px_-24px_rgba(11,10,17,0.35)] transition-[width,height] duration-200" />
            </div>
          </NavigationMenu.Root>
          ) : null}

          <div className="flex items-center gap-2">
            <a href={INBOUND_PHONE.tel} className="hidden items-center gap-1.5 px-2 py-1.5 text-[14px] font-medium text-ink xl:inline-flex">
              <Phone className="h-4 w-4 text-[#6810FE]" weight="duotone" aria-hidden="true" />
              {INBOUND_PHONE.display}
            </a>
            <Link href="/auth" className="hidden px-2 py-1.5 text-[14px] text-ink-muted hover:text-ink sm:inline">
              {NAV.signIn}
            </Link>
            <a href={BOOK_PATH} className={cn(btnPrimary, "hidden h-10 px-4 text-[14px] sm:inline-flex")}>
              Book now
            </a>
            {withMenus ? (
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink lg:hidden"
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <List className="h-5 w-5" />}
            </button>
            ) : (
              <a href={INBOUND_PHONE.tel} aria-label={`Call ${INBOUND_PHONE.display}`} className="grid h-10 w-10 place-items-center rounded-lg border border-line text-[#6810FE] sm:hidden">
                <Phone className="h-5 w-5" weight="duotone" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>

        {withMenus && mobileOpen ? (
          <nav id="mobile-menu" aria-label="Main" className="mx-auto max-h-[calc(100dvh-7rem)] max-w-6xl overflow-y-auto border-t border-line pb-6 lg:hidden">
            <ul className="divide-y divide-line">
              {MENUS.map((menu) => {
                const open = openSection === menu.label;
                return (
                  <li key={menu.label}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenSection(open ? null : menu.label)}
                      className="flex w-full items-center justify-between py-4 text-left text-[16px] font-medium text-ink"
                    >
                      {menu.label}
                      <CaretDown className={cn("h-5 w-5 text-ink-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
                    </button>
                    {open ? (
                      <ul className="grid gap-0.5 pb-3">
                        {menu.items.map((item) => (
                          <li key={item.title}>
                            <MenuItemLink item={item} onNavigate={() => setMobileOpen(false)} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 grid gap-2">
              <a href={BOOK_PATH} className={cn(btnPrimary, "w-full")}>
                Book now
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a href={INBOUND_PHONE.tel} className={cn(btnOutline, "w-full")}>
                  <Phone className="h-4 w-4 text-[#6810FE]" weight="duotone" aria-hidden="true" />
                  Call
                </a>
                <Link href="/auth" className={cn(btnOutline, "w-full")} onClick={() => setMobileOpen(false)}>
                  {NAV.signIn}
                </Link>
              </div>
            </div>
          </nav>
        ) : null}
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
