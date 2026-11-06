"use client";

// How it works, played as a run. Each card reports what its step did, and the
// last one waits on the customer. Sample values; the resting frame is finished.

import { useRef } from "react";
import { RiArrowRightLine, RiCheckboxCircleLine, RiLoader4Line, RiStarFill, RiTimeLine } from "@/components/icons";
import { HOW } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { useInViewSequence } from "./motion";
import { Chip, Section } from "./primitives";

function Visual({ id }: { id: string }) {
  switch (id) {
    case "quote":
      return (
        <div className="space-y-1.5">
          {[78, 46, 30].map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="h-2 rounded-full bg-[#ECEAF2]" style={{ width: `${w}%` }} />
              <span className="h-2 w-6 rounded-full bg-[#C9B6FF]" />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-ink/80 pt-1.5">
            <span className="h-2 w-10 rounded-full bg-ink/70" />
            <span className="h-2.5 w-9 rounded-full bg-[#6810FE]" />
          </div>
        </div>
      );
    case "schedule":
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {["9:00", "1:00", "3:30", "9:00", "11:00", "2:00"].map((t, i) => (
            <span
              key={i}
              className={cn(
                "rounded-md border py-1 text-center text-[10.5px]",
                i === 0 ? "border-[#6810FE] bg-[#6810FE] text-white" : "border-line bg-white text-ink-muted",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      );
    case "match":
      return (
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#E9DCC6] to-[#C9B08A] text-[13px] font-semibold text-white">MR</span>
          <div className="space-y-1">
            <span className="block h-2 w-16 rounded-full bg-ink/70" />
            <span className="block h-2 w-24 rounded-full bg-[#ECEAF2]" />
          </div>
        </div>
      );
    case "clean":
      return (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid h-3.5 w-3.5 place-items-center rounded-[4px] bg-[#6810FE]">
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="h-2 rounded-full bg-[#ECEAF2]" style={{ width: `${70 - i * 14}%` }} />
            </div>
          ))}
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-between">
          <span className="flex gap-0.5 text-[#E8A400]" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <RiStarFill key={i} className="h-4 w-4" />
            ))}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[10.5px] text-ink-muted">
            <RiTimeLine className="h-3 w-3" aria-hidden="true" /> 48h
          </span>
        </div>
      );
  }
}

export function HowRun() {
  const ref = useRef<HTMLOListElement>(null);
  const steps = HOW.steps;
  const progress = useInViewSequence(ref, steps.length, 750);

  return (
    <Section id={HOW.id} headline={HOW.headline} lead={HOW.lead}>
      <ol ref={ref} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const state = i < progress ? (isLast ? "waiting" : "done") : i === progress ? "running" : "queued";
          return (
            <li key={step.id} className="relative">
              <div
                className={cn(
                  "flex h-full flex-col rounded-2xl border bg-white p-4 shadow-[0_16px_40px_-30px_rgba(11,10,17,0.35)] transition-colors duration-500",
                  state === "running" ? "border-[#C9B6FF]" : "border-line",
                )}
              >
                <div className="rounded-xl border border-line bg-[#FAFAFC] p-3">
                  <Visual id={step.id} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="rounded-full border border-line px-1.5 font-mono text-[11px] text-ink-muted">{String(i + 1).padStart(2, "0")}</span>
                  {state === "done" ? (
                    <Chip tone="good">
                      <RiCheckboxCircleLine className="h-3 w-3" aria-hidden="true" /> {HOW.labels.done}
                    </Chip>
                  ) : state === "waiting" ? (
                    <Chip tone="warn">
                      <RiTimeLine className="h-3 w-3" aria-hidden="true" /> {HOW.labels.waiting}
                    </Chip>
                  ) : state === "running" ? (
                    <Chip tone="brand">
                      <RiLoader4Line className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {HOW.labels.running}
                    </Chip>
                  ) : (
                    <Chip>{HOW.labels.queued}</Chip>
                  )}
                </div>
                <h3 className="mt-3 text-[19px] font-medium tracking-[-0.02em] text-ink">{step.title}</h3>
                <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-ink-muted">{step.body}</p>
                <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink">{step.note}</p>
              </div>
              {!isLast ? (
                <RiArrowRightLine
                  className="absolute -right-[11px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-[#8E5BFF] lg:block"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
