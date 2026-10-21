"use client";

// ─── hiring.novaracleaning.com — shared chrome ──────────────────────────────
//
// White theme + Novara brand (#5C0FFE / #8F7BFD). Layout mirrors the DA hiring
// site structure (nav → hero → open roles) without the black theme.

import Link from "next/link";
import { RiArrowRightLine } from "@remixicon/react";
import { BRAND } from "@/lib/brand";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";
import { cn } from "@/lib/utils";

export const HIRING_GRADIENT = BRAND.gradient;
const LOGO = "/novara-logo.png";

export function HiringMotionStyle() {
  return (
    <style>{`
@keyframes nvHireRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes nvHireDrift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(18px,-12px,0)}}
.nv-hire-rise{animation:nvHireRise .7s cubic-bezier(.22,1,.36,1) both}
.nv-hire-rise-d1{animation-delay:.08s}
.nv-hire-rise-d2{animation-delay:.16s}
.nv-hire-rise-d3{animation-delay:.24s}
.nv-hire-drift{animation:nvHireDrift 16s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){
  .nv-hire-rise,.nv-hire-rise-d1,.nv-hire-rise-d2,.nv-hire-rise-d3{animation:none;opacity:1;transform:none}
  .nv-hire-drift{animation:none}
}
`}</style>
  );
}

export function HiringNav({ ctaHref = "#positions", ctaLabel = "Open roles" }: { ctaHref?: string; ctaLabel?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--hairline)] bg-background/85 backdrop-blur-xl hairline-glow">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/hiring"
          aria-label="Novara Cleaning careers home"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-heading text-[15px] font-bold tracking-tight text-foreground sm:text-base">
            Novara<span className="text-primary">Cleaning</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/hiring/field-tech"
            className="hidden rounded-full border border-border bg-background px-3.5 py-2 text-[13px] font-semibold text-foreground transition hover:border-primary/30 hover:bg-brand-50 sm:inline-flex"
          >
            Field Tech
          </Link>
          <a
            href={ctaHref}
            className="btn-coss btn-trail inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-[13px] font-semibold text-white shadow-[0_10px_28px_-12px_rgba(92,15,254,0.55)] transition hover:opacity-95"
            style={{ background: HIRING_GRADIENT }}
          >
            {ctaLabel}
            <RiArrowRightLine className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

export function HiringFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row sm:px-6">
        <Link href="/hiring" className="flex items-center gap-2.5">
          <img src={LOGO} alt="" className="h-7 w-7 rounded-md opacity-90" />
          <span className="font-heading text-sm font-bold text-foreground">
            Novara<span className="text-primary">Cleaning</span>
          </span>
        </Link>
        <div className="max-w-xl text-center text-xs font-medium leading-relaxed text-muted-foreground sm:text-right">
          <p>{DEFAULT_INTAKE_SETTINGS.legalName}</p>
          <p>{DEFAULT_INTAKE_SETTINGS.legalAddress}</p>
          <p>
            <a href="tel:+18447352070" className="hover:text-foreground">{DEFAULT_INTAKE_SETTINGS.applicantPhone}</a>
            {" · "}
            <a href={`mailto:${DEFAULT_INTAKE_SETTINGS.applicantEmail}`} className="hover:text-foreground">{DEFAULT_INTAKE_SETTINGS.applicantEmail}</a>
          </p>
          <p className="mt-2 flex flex-wrap justify-center gap-4 sm:justify-end">
            <a href="https://novaracleaning.com/privacy" className="hover:text-foreground">Privacy notice</a>
            <a href="https://novaracleaning.com/sms-consent" className="hover:text-foreground">Text message terms</a>
            <Link href="/hiring" className="hover:text-foreground">Careers</Link>
          </p>
          <p className="mt-2">If you need an accommodation to apply, email {DEFAULT_INTAKE_SETTINGS.applicantEmail}.</p>
        </div>
      </div>
    </footer>
  );
}

export function EvergreenBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800",
        className,
      )}
    >
      Opening soon
    </span>
  );
}

export function HiringShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <HiringMotionStyle />
      {children}
    </div>
  );
}
