"use client";

import { RiFacebookCircleFill, RiInstagramLine } from "@remixicon/react";
import { openCookieSettings } from "@/components/compliance/CookieNotice";

const linkClass =
  "text-xs text-zinc-700 underline underline-offset-2 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded";

const LEGAL_LINKS = [
  { label: "Privacy Policy", href: "https://novaracleaning.com/privacy" },
  { label: "Terms", href: "https://novaracleaning.com/terms" },
  { label: "Cancellation Policy", href: "https://novaracleaning.com/cancellation-policy" },
  { label: "Refund Policy", href: "https://novaracleaning.com/refund-policy" },
  { label: "Membership Policy", href: "https://novaracleaning.com/membership-policy" },
  { label: "Disclaimer", href: "https://novaracleaning.com/disclaimer" },
  { label: "Privacy requests", href: "/privacy-request" },
];

export function BookingFooter({ licenseLine = "" }: { licenseLine?: string }) {
  return (
    <footer className="mt-auto border-t border-[color:var(--hairline)] bg-background px-4 py-8">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-4 text-center">
        <div className="flex items-center gap-3">
          <img src="/novara-logo.png" alt="Novara Cleaning" className="h-10 w-10 rounded-lg object-contain" />
          <div className="text-left">
            <p className="text-sm font-semibold leading-tight text-foreground">NovaraCleaning</p>
            <p className="text-xs text-zinc-600">Novara Cleaning LLC</p>
          </div>
        </div>
        {licenseLine ? <p className="text-xs text-zinc-600">{licenseLine}</p> : null}
        <p className="text-xs leading-5 text-zinc-700">
          7404 Executive Place, Lanham, MD 20706
          <br />
          <a href="tel:+18447352070" className={linkClass}>(844) 735-2070</a>
          <span className="mx-2 text-zinc-400">·</span>
          <a href="mailto:support@novaracleaning.com" className={linkClass}>support@novaracleaning.com</a>
          <span className="mx-2 text-zinc-400">·</span>
          <a href="mailto:privacy@novaracleaning.com" className={linkClass}>privacy@novaracleaning.com</a>
        </p>
        <nav aria-label="Policies" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </a>
          ))}
          <button type="button" onClick={openCookieSettings} className={linkClass}>
            Cookie settings
          </button>
        </nav>
        <div className="flex items-center gap-3">
          <a href="https://www.facebook.com/novaracleaning" aria-label="Novara Cleaning on Facebook" className="text-zinc-600 hover:text-foreground">
            <RiFacebookCircleFill className="h-5 w-5" />
          </a>
          <a href="https://www.instagram.com/novaracleaning" aria-label="Novara Cleaning on Instagram" className="text-zinc-600 hover:text-foreground">
            <RiInstagramLine className="h-5 w-5" />
          </a>
        </div>
        <p className="max-w-xl text-[11px] leading-5 text-zinc-500">
          This page is operated by Novara Cleaning LLC. The price shown in these booking steps is the price charged. Most bookings take a 50% deposit today. Focused cleans are paid in full.
        </p>
        <p className="text-xs text-zinc-500">© {new Date().getFullYear()} Novara Cleaning LLC</p>
      </div>
    </footer>
  );
}
