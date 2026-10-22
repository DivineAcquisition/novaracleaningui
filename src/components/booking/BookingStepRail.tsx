"use client";

import { RiCheckLine } from "@remixicon/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// Named checkout rail, adapted from the 21st.dev stepper and checkout
// breadcrumb patterns. Colors, type, and the existing progress bar stay
// Novara's. Completed steps can be reopened. Later steps cannot be skipped.

export const BOOKING_RAIL = [
  { number: 1, short: "ZIP", label: "Location", path: "/book/zip" },
  { number: 2, short: "Size", label: "Home size", path: "/book/sqft" },
  { number: 3, short: "Service", label: "Service", path: "/book/offer" },
  { number: 4, short: "Pay", label: "Checkout", path: "/book/checkout" },
  { number: 5, short: "Details", label: "Details", path: "/book/details" },
  { number: 6, short: "Done", label: "Confirmation", path: "/book/confirmation" },
] as const;

export function BookingStepRail({ currentStep }: { currentStep: number }) {
  const router = useRouter();

  return (
    <nav aria-label="Booking progress" className="w-full">
      <ol className="grid grid-cols-6 gap-1">
        {BOOKING_RAIL.map((step) => {
          const done = currentStep > step.number;
          const current = currentStep === step.number;
          const canOpen = done && step.number < 6;
          return (
            <li key={step.number}>
              <button
                type="button"
                disabled={!canOpen}
                aria-current={current ? "step" : undefined}
                aria-label={canOpen ? `Go back to ${step.label}` : step.label}
                onClick={() => {
                  if (canOpen) router.push(step.path);
                }}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  canOpen ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors",
                    done && "border-primary bg-primary text-primary-foreground",
                    current && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20",
                    !done && !current && "border-[color:var(--hairline)] bg-background text-muted-foreground",
                  )}
                >
                  {done ? <RiCheckLine className="h-3.5 w-3.5" /> : step.number}
                </span>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide",
                    current ? "font-semibold text-primary" : done ? "text-foreground/70" : "text-muted-foreground",
                  )}
                >
                  {step.short}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
