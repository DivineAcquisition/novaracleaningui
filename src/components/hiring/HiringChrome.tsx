"use client";

// ─── hiring.novaracleaning.com — shared chrome ──────────────────────────────
//
// Light theme in the main site's style (Inter, ink text, Novara purple).
// Layout mirrors the DA hiring site structure (nav → hero → open roles).

import Link from "next/link";
import { RiArrowRightLine } from "@/components/icons";
import { BRAND } from "@/lib/brand";
import { DEFAULT_INTAKE_SETTINGS } from "@/lib/contractor-intake/settings";
import { SUPPORT_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/landing/Chrome";
import { btnOutline, btnPrimary, gutter } from "@/components/landing/primitives";

export const HIRING_GRADIENT = BRAND.gradient;

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
    <header className={cn(gutter, "sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur-md")}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4">
        <Link href="/hiring" aria-label="Novara Cleaning careers home" className="transition-opacity hover:opacity-85">
          <BrandMark />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/hiring/field-tech" className={cn(btnOutline, "hidden h-10 px-4 text-[14px] sm:inline-flex")}>
            Field Cleaner
          </Link>
          <a href={ctaHref} className={cn(btnPrimary, "h-10 px-4 text-[14px]")}>
            {ctaLabel}
            <RiArrowRightLine className="h-4 w-4" />
          </a>
        </div>
      </div>
    </header>
  );
}

const POLICY_LINKS = [
  { href: "/hiring/policies/applicant-privacy", label: "Applicant privacy" },
  { href: "/hiring/policies/background-check", label: "Background checks" },
  { href: "/hiring/policies/contractor-terms", label: "Contractor terms" },
  { href: "/hiring/policies/text-messages", label: "Text message terms" },
  { href: "/hiring/policies/equal-opportunity", label: "Equal opportunity" },
];

export function HiringFooter() {
  return (
    <footer className={cn(gutter, "border-t border-line bg-[#FAFAFC]")}>
      <div className="mx-auto grid max-w-6xl gap-8 py-12 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Link href="/hiring">
            <BrandMark />
          </Link>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-muted">
            Independent contractor cleaning work across Maryland, DC, and Northern Virginia.
          </p>
        </div>
        <div className="text-[14px] leading-relaxed text-ink-muted">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">Contact</p>
          <p>{DEFAULT_INTAKE_SETTINGS.legalName}</p>
          <p>{DEFAULT_INTAKE_SETTINGS.legalAddress}</p>
          <p>
            <a href={SUPPORT_PHONE.tel} className="hover:text-ink">{DEFAULT_INTAKE_SETTINGS.applicantPhone}</a>
          </p>
          <p>
            <a href={`mailto:${DEFAULT_INTAKE_SETTINGS.applicantEmail}`} className="hover:text-ink">{DEFAULT_INTAKE_SETTINGS.applicantEmail}</a>
          </p>
        </div>
        <div className="text-[14px]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink">Hiring policies</p>
          <ul className="space-y-1.5">
            {POLICY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-ink-muted hover:text-ink">{l.label}</Link>
              </li>
            ))}
            <li>
              <Link href="/hiring/policies" className="font-medium text-[#5A1FD6] hover:underline">All hiring policies</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-6xl border-t border-line py-5 text-[12.5px] text-ink-muted">
        If you need an accommodation to apply, email {DEFAULT_INTAKE_SETTINGS.applicantEmail}.
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
    <div className="book-theme landing min-h-screen bg-background text-foreground">
      <HiringMotionStyle />
      {children}
    </div>
  );
}
