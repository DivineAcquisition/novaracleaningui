"use client";

// ─── hiring.novaracleaning.com — shared chrome ──────────────────────────────
//
// White theme + Novara brand (#5C0FFE / #8F7BFD). Layout mirrors the DA hiring
// site structure (nav → hero → open roles) without the black theme.

import Link from "next/link";
import { RiArrowRightLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

export const HIRING_GRADIENT = "linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%)";
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

export function HiringNav({ ctaHref = "#positions" }: { ctaHref?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/hiring"
          aria-label="Novara Cleaning careers home"
          className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        >
          <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-jakarta text-[15px] font-bold tracking-tight text-slate-900 sm:text-base">
            Novara<span className="text-[#5C0FFE]">Cleaning</span>
          </span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/hiring/field-tech"
            className="hidden rounded-full border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 sm:inline-flex"
          >
            Field Tech
          </Link>
          <a
            href={ctaHref}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white shadow-[0_10px_28px_-12px_rgba(92,15,254,0.55)] transition hover:opacity-95"
            style={{ background: HIRING_GRADIENT }}
          >
            Open roles
            <RiArrowRightLine className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

export function HiringFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row sm:px-6">
        <Link href="/hiring" className="flex items-center gap-2.5">
          <img src={LOGO} alt="" className="h-7 w-7 rounded-md opacity-90" />
          <span className="font-jakarta text-sm font-bold text-slate-800">
            Novara<span className="text-[#5C0FFE]">Cleaning</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-slate-500">
          <a
            href="https://novaracleaning.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-slate-800"
          >
            novaracleaning.com
          </a>
          <a href="mailto:hello@novaracleaning.com" className="transition hover:text-slate-800">
            hello@novaracleaning.com
          </a>
          <Link href="/hiring" className="transition hover:text-slate-800">
            Careers
          </Link>
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
      Active evergreen list
    </span>
  );
}

export function HiringShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAFAFC] text-slate-900">
      <HiringMotionStyle />
      {children}
    </div>
  );
}
