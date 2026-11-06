"use client";

// "What happens next" timeline on checkout. Each step is something the booking
// system actually does after payment, so the customer sees the whole path
// before paying. Steps light up one by one when the card scrolls into view;
// under reduced motion they render complete.

import { useRef } from "react";
import { RiCalendarCheckLine, RiCameraLine, RiCheckLine, RiListCheck2, RiMailLine, RiRefreshLine, RiWallet3Line } from "@/components/icons";
import { useInViewSequence } from "@/components/landing/motion";
import { cn } from "@/lib/utils";

type Step = { title: string; body: string; icon: typeof RiCheckLine };

export type PayMode = "deposit" | "full" | "membership" | "credit";

export function WhatHappensNext({ mode = "deposit" }: { mode?: PayMode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const steps: Step[] = [
    mode === "full"
      ? { title: "Pay today", body: "Focused cleans are paid in full when you book.", icon: RiWallet3Line }
      : mode === "membership"
        ? { title: "First month today", body: "Your first month and the one-time deep clean are charged now.", icon: RiWallet3Line }
        : mode === "credit"
          ? { title: "One credit used", body: "This visit uses a membership credit. Nothing is charged today.", icon: RiWallet3Line }
          : { title: "Deposit today", body: "50% now. Your card is saved for the balance.", icon: RiWallet3Line },
    { title: "Confirmation", body: "You get one confirmation with your private checklist link.", icon: RiMailLine },
    { title: "Your visit", body: "Your cleaner arrives at the time you picked and works from the written checklist.", icon: RiListCheck2 },
    { title: "Photo report", body: "Before and after photos are sent to you when the clean is done.", icon: RiCameraLine },
    mode !== "deposit"
      ? { title: "Nothing else to pay", body: "There is no balance after this visit.", icon: RiCalendarCheckLine }
      : { title: "Balance after the clean", body: "The other 50% is charged to your saved card after the visit.", icon: RiCalendarCheckLine },
    { title: "48 hours to flag anything", body: "Missed a spot? Tell us within 48 hours and we come back to re-clean it free.", icon: RiRefreshLine },
  ];

  const lit = useInViewSequence(ref, steps.length, 450);

  return (
    <div ref={ref} className="rounded-2xl border border-line bg-white p-5 shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)] sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">What happens next</p>
      <h3 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-ink">From this page to a checked clean</h3>
      <ol className="relative mt-5">
        {steps.map((s, i) => {
          const done = i < lit;
          const last = i === steps.length - 1;
          const Icon = s.icon;
          return (
            <li key={s.title} className="relative flex gap-3 pb-5 last:pb-0">
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px transition-colors duration-500", done ? "bg-[#C9B6FF]" : "bg-line")}
                />
              ) : null}
              <span
                className={cn(
                  "relative z-[1] grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl border transition-all duration-500",
                  done ? "border-transparent bg-[#6810FE] text-white shadow-[0_8px_20px_-10px_rgba(104,16,254,0.8)]" : "border-line bg-[#FAFAFC] text-ink-muted",
                )}
              >
                {done ? <RiCheckLine className="h-4 w-4" /> : <Icon className="h-[18px] w-[18px]" />}
              </span>
              <div className={cn("pt-1 transition-opacity duration-500", done ? "opacity-100" : "opacity-60")}>
                <p className="text-[14.5px] font-medium text-ink">{s.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
