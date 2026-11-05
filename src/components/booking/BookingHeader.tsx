"use client";

// Booking flow header: logo, help links, and step progress. Same props as
// before, so every step keeps calling it the same way.

import { RiArrowRightUpLine, RiPhoneLine } from "@remixicon/react";
import { INBOUND_PHONE } from "@/config/brand-config";

interface BookingHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepLabel?: string;
}

export function BookingHeader({ currentStep, totalSteps, stepLabel }: BookingHeaderProps) {
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#E9E7EE] bg-white/90 backdrop-blur-md">
      <div className="container mx-auto max-w-6xl px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <a href="/" target="_blank" rel="noopener" className="flex items-center gap-2.5" aria-label="Novara Cleaning website (opens in a new tab)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" className="h-8 w-8 rounded-[9px] object-contain sm:h-9 sm:w-9" />
            <span className="text-[16px] font-medium tracking-[-0.02em] text-[#0B0A11]">Novara</span>
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <a
              href="/"
              target="_blank"
              rel="noopener"
              className="hidden items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13.5px] text-[#5F5B6B] hover:bg-[#F6F5F9] hover:text-[#0B0A11] sm:inline-flex"
            >
              Website
              <RiArrowRightUpLine className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            <a
              href={INBOUND_PHONE.tel}
              aria-label={`Call ${INBOUND_PHONE.display}`}
              className="inline-flex items-center gap-1.5 rounded-[9px] border border-[#E9E7EE] bg-white px-3 py-1.5 text-[13.5px] font-medium text-[#0B0A11] hover:bg-[#F6F5F9]"
            >
              <RiPhoneLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
              <span className="hidden sm:inline">{INBOUND_PHONE.display}</span>
              <span className="sm:hidden">Call</span>
            </a>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[13px] sm:mt-4">
          <p className="text-[#0B0A11]">
            <span className="font-mono text-[12px] text-[#8E5BFF]">
              {String(currentStep).padStart(2, "0")}/{String(totalSteps).padStart(2, "0")}
            </span>
            {stepLabel ? <span className="ml-2 font-medium">{stepLabel}</span> : null}
          </p>
          <p className="text-[#5F5B6B]">{progressPercent}%</p>
        </div>
        <div
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#ECEAF2]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
          aria-label={`Step ${currentStep} of ${totalSteps}${stepLabel ? `: ${stepLabel}` : ""}`}
        >
          <div className="h-full rounded-full bg-[#8E5BFF] transition-[width] duration-500 ease-out" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </header>
  );
}
