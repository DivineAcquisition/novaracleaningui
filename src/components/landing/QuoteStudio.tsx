"use client";

// Hero product frame: a quote being built. Prices are the real starting rates
// passed in from the pricing config; the ZIP and home are sample values and
// the frame says so.

import { RiLoader4Line, RiSearchLine, RiTimeLine } from "@/components/icons";
import { HERO, QUOTE_STUDIO } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { dollars } from "./format";
import { useCycle, useOnScreen } from "./motion";
import { Chip, Frame } from "./primitives";

export function QuoteStudio({ baseCents, extraCents }: { baseCents: number; extraCents: number }) {
  const { ref, visible } = useOnScreen<HTMLDivElement>();
  const steps = QUOTE_STUDIO.steps;
  const step = useCycle(steps.length + 1, 1700, visible); // last frame = finished
  const done = step >= steps.length;
  const shownStep = Math.min(step, steps.length - 1);
  const progress = done ? 100 : ((shownStep + 1) / (steps.length + 1)) * 100;

  // Online bookings get 25% off a deep clean (src/lib/pricing.ts). Extras are not discounted.
  const offerCents = Math.round(baseCents * 0.25);
  const lines: Array<{ label: string; value: string; at: number; muted?: boolean }> = [
    { label: "Deep clean · 1,000 – 1,500 sq ft", value: dollars(baseCents), at: 1 },
    { label: "Inside oven", value: `+${dollars(extraCents)}`, at: 2 },
    { label: "Online discount, 25% off the clean", value: `−${dollars(offerCents)}`, at: 3 },
  ];

  return (
    <div ref={ref}>
      <Frame glow label={HERO.exampleLabel}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{QUOTE_STUDIO.label}</p>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <p className="text-[22px] font-medium tracking-[-0.02em] text-ink">{QUOTE_STUDIO.title}</p>
          <Chip tone={done ? "good" : "brand"} dot>
            {done ? "Ready" : "Pricing"}
          </Chip>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-[#FAFAFC] p-3.5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-ink">
              {done ? (
                <RiSearchLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
              ) : (
                <RiLoader4Line className="h-4 w-4 animate-spin text-[#6810FE] motion-reduce:animate-none" aria-hidden="true" />
              )}
              {done ? "Quote ready" : steps[shownStep]}
            </span>
            <span className="text-ink-muted">
              {done ? `${steps.length} of ${steps.length}` : `Step ${shownStep + 1} of ${steps.length}`}
            </span>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#ECEAF2]" aria-hidden="true">
            <div className="h-full rounded-full bg-[#8E5BFF] transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {QUOTE_STUDIO.inputs.map((input, i) => (
              <div
                key={input.label}
                className={cn(
                  "rounded-lg border bg-white px-2.5 py-2 transition-colors",
                  done || i <= shownStep ? "border-line" : "border-dashed border-line opacity-60",
                )}
              >
                <p className="text-[11px] text-ink-muted">{input.label}</p>
                <p className="truncate text-[12.5px] font-medium text-ink">{input.value}</p>
              </div>
            ))}
          </div>
        </div>

        <ul className="mt-4 divide-y divide-dashed divide-line text-[13.5px]">
          {lines.map((line) => {
            const shown = done || step >= line.at;
            return (
              <li key={line.label} className="flex items-center justify-between gap-3 py-2.5">
                <span className={line.muted ? "text-ink-muted" : "text-ink"}>{line.label}</span>
                {shown ? (
                  <span className={cn("tabular-nums", line.muted ? "text-ink-muted" : "font-medium text-ink")}>{line.value}</span>
                ) : (
                  <span className="h-3 w-14 animate-pulse rounded bg-[#ECEAF2] motion-reduce:animate-none" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-2 flex items-end justify-between border-t border-ink pt-3">
          <span className="text-[13px] text-ink-muted">{done ? "Total" : "Starting at"}</span>
          <span className="text-[30px] font-medium tracking-[-0.03em] tabular-nums text-ink">
            {done ? dollars(baseCents + extraCents - offerCents) : step >= 2 ? dollars(baseCents + extraCents) : dollars(baseCents)}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RiTimeLine className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          {QUOTE_STUDIO.slots.map((slot, i) => (
            <Chip key={slot} tone={done && i === 0 ? "solid" : "neutral"}>
              {slot}
            </Chip>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-ink-muted">{QUOTE_STUDIO.footnote}</p>
      </Frame>
    </div>
  );
}
