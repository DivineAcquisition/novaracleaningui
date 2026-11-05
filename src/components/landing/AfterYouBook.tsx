"use client";

// "What happens after you book" — the booking and dispatch automation shown as
// plain-language steps. It plays once when scrolled into view; with reduced
// motion every step simply shows as done.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useInViewOnce, useReducedMotion } from "./shared";

const STEPS = [
  { title: "Exact price for your home", body: "Built from your ZIP code, home size, and the condition it's in. You see it before you pay." },
  { title: "Pick a time that works", body: "Choose from open times. Reschedule from your text or email link." },
  { title: "Matched with your cleaner", body: "Based on where you live, who's available, and their ratings. Bi-weekly and weekly members get a dedicated cleaner." },
  { title: "Text updates", body: "Confirmation and reminders by text, so you know when your cleaner is coming." },
  { title: "Cleaned to a written checklist", body: "Your cleaner works room by room from the checklist for your service and photographs the finished job." },
  { title: "Rate it. We fix anything missed.", body: "Tell us within 48 hours if something isn't right and we come back to re-clean it free." },
];

export function AfterYouBook() {
  const reduced = useReducedMotion();
  const { ref, seen } = useInViewOnce<HTMLOListElement>(0.3);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      setActive(STEPS.length);
      return;
    }
    setActive(0);
    const id = window.setInterval(() => {
      setActive((a) => {
        if (a >= STEPS.length) {
          window.clearInterval(id);
          return a;
        }
        return a + 1;
      });
    }, 700);
    return () => window.clearInterval(id);
  }, [seen, reduced]);

  return (
    <ol ref={ref} className="relative grid gap-0">
      {STEPS.map((step, i) => {
        const state = active === -1 ? "idle" : i < active ? "done" : i === active ? "active" : "pending";
        return (
          <li key={step.title} className="relative grid grid-cols-[28px_1fr] gap-4 pb-6 last:pb-0">
            {i < STEPS.length - 1 && (
              <span
                className={cn(
                  "absolute left-[13px] top-8 bottom-1 w-0.5 transition-colors duration-500",
                  state === "done" ? "bg-emerald-600/60" : "bg-border",
                )}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                "relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 bg-background transition-colors duration-300",
                state === "done" && "border-emerald-600 bg-emerald-600",
                state === "active" && "border-primary",
                (state === "pending" || state === "idle") && "border-border",
              )}
              aria-hidden="true"
            >
              {state === "done" ? (
                <svg viewBox="0 0 12 12" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : state === "active" ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">{i + 1}</span>
              )}
            </span>
            <div className={cn("transition-opacity duration-300", state === "pending" ? "opacity-50" : "opacity-100")}>
              <p className="font-semibold text-foreground">{step.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
