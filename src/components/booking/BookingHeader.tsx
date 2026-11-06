"use client";

// Booking flow header: logo, help links, and step progress. Same props as
// before, so every step keeps calling it the same way.

import { useEffect, useMemo, useRef, useState } from "react";
import { RiArrowRightUpLine, RiPhoneLine } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { useBooking } from "@/contexts/BookingContext";
import { useReducedMotion } from "@/components/landing/motion";
import { MEMBERSHIP_PRICES, calculatePrice, getServiceFinalPrice } from "@/lib/pricing";

interface BookingHeaderProps {
  currentStep: number;
  totalSteps: number;
  stepLabel?: string;
  /** Exact amount from the step. Checkout passes its own total, which
   *  includes same-day and focused pricing. Omit to work it out from the
   *  saved booking. */
  runningTotal?: number | null;
  runningLabel?: string;
}

const LAST_TOTAL_KEY = "novara_running_total";

function money(v: number): string {
  const cents = Math.round(v * 100);
  return "$" + (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** The price so far, from the same tables checkout charges from. */
function useStepTotal(currentStep: number): { value: number; label: string } | null {
  const { bookingData } = useBooking();
  return useMemo(() => {
    const size = bookingData.homeSizeId;
    if (!size) return null;
    const plan = bookingData.membershipPlan;
    if (plan === "monthly" || plan === "biweekly" || plan === "weekly") {
      const monthly = MEMBERSHIP_PRICES[size]?.[plan] || 0;
      return monthly > 0 ? { value: monthly, label: "Per month" } : null;
    }
    // Until a service is picked (home size and service steps), show the
    // lowest price for this home: a standard clean after the online discount.
    const service = bookingData.serviceType;
    if (currentStep < 4 || !service || service === "focused") {
      const from = getServiceFinalPrice(size, "standard");
      return from > 0 ? { value: from, label: "From" } : null;
    }
    const total = calculatePrice(size, service, bookingData.addOns || [], "none", false).total;
    return total > 0 ? { value: total, label: "Your price" } : null;
  }, [bookingData.homeSizeId, bookingData.membershipPlan, bookingData.serviceType, bookingData.addOns, currentStep]);
}

/** Counts from the last total the visitor saw (kept across steps) to the new one. */
function useRunningNumber(target: number | null, reduced: boolean): number | null {
  const [value, setValue] = useState<number | null>(null);
  const fromRef = useRef<number | null>(null);
  useEffect(() => {
    if (target === null) {
      setValue(null);
      return;
    }
    if (fromRef.current === null) {
      const saved = Number(sessionStorage.getItem(LAST_TOTAL_KEY));
      fromRef.current = Number.isFinite(saved) && saved > 0 ? saved : 0;
    }
    sessionStorage.setItem(LAST_TOTAL_KEY, String(target));
    const from = fromRef.current;
    if (reduced || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const tick = (now: number) => {
      const q = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - q, 3));
      fromRef.current = v;
      setValue(v);
      if (q < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return value;
}

function RunningTotal({ currentStep, override, overrideLabel }: { currentStep: number; override?: number | null; overrideLabel?: string }) {
  // Booking state comes from localStorage, so render only after mount to
  // keep the server and browser HTML the same.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const reduced = useReducedMotion();
  const computed = useStepTotal(currentStep);
  const hasOverride = override != null && override > 0;
  const target = hasOverride ? (override as number) : computed?.value ?? null;
  const label = hasOverride ? overrideLabel || "Your price" : computed?.label || "";
  const shown = useRunningNumber(mounted ? target : null, reduced);
  if (!mounted || shown === null || target === null) return null;
  return (
    <p className="inline-flex items-baseline gap-1.5 rounded-full bg-[#F3EEFF] px-2.5 py-0.5" aria-live="polite">
      <span className="text-[11.5px] text-[#5A1FD6]">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums tracking-tight text-[#0B0A11]">{money(shown)}</span>
    </p>
  );
}

export function BookingHeader({ currentStep, totalSteps, stepLabel, runningTotal, runningLabel }: BookingHeaderProps) {
  const progressPercent = Math.round((currentStep / totalSteps) * 100);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#E9E7EE] bg-white/90 backdrop-blur-md">
      <div className="container mx-auto max-w-6xl px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-3">
          <a href="/" target="_blank" rel="noopener" className="flex items-center gap-2.5" aria-label="Novara Cleaning website (opens in a new tab)">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/novara-logo.png" alt="" className="h-8 w-8 rounded-[9px] object-contain sm:h-9 sm:w-9" />
            <span className="text-[16px] font-semibold tracking-[-0.02em] text-[#0B0A11]">Novara Cleaning</span>
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
          <div className="flex items-center gap-2.5">
            <RunningTotal currentStep={currentStep} override={runningTotal} overrideLabel={runningLabel} />
            <p className="text-[#5F5B6B]">{progressPercent}%</p>
          </div>
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
