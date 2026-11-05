"use client";

// The strip under the hero: requests come in from every channel, Nova works
// through them, and hands back a booked visit. Beams are SVG paths measured
// from the layout, with a short light travelling along each one.

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  RiCalendarCheckLine,
  RiChat3Line,
  RiComputerLine,
  RiHome4Line,
  RiPhoneLine,
  RiRepeatLine,
  RiSparkling2Fill,
} from "@remixicon/react";
import { AGENT_FLOW } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { useCycle, useOnScreen } from "./motion";
import { Chip, gutter, shell } from "./primitives";

const ICONS = {
  call: RiPhoneLine,
  text: RiChat3Line,
  web: RiComputerLine,
  host: RiHome4Line,
  member: RiRepeatLine,
} as const;

type BeamPath = { d: string; delay: number };

const PAIRS = [
  { from: '[data-beam="source"]', to: '[data-beam="agent"]' },
  { from: '[data-beam="agent"]', to: '[data-beam="output"]' },
] as const;

function useBeamPaths(containerRef: RefObject<HTMLElement | null>) {
  const [paths, setPaths] = useState<BeamPath[]>([]);
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const next: BeamPath[] = [];
    for (const pair of PAIRS) {
      const target = container.querySelector(pair.to)?.getBoundingClientRect();
      if (!target || target.width === 0) continue;
      container.querySelectorAll(pair.from).forEach((el) => {
        const from = el.getBoundingClientRect();
        if (from.width === 0) return;
        const x1 = from.right - box.left;
        const y1 = from.top + from.height / 2 - box.top;
        const x2 = target.left - box.left;
        const y2 = target.top + target.height / 2 - box.top;
        if (x2 <= x1) return; // stacked layout on small screens: no beams
        const bend = Math.max(24, (x2 - x1) * 0.5);
        next.push({ d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, delay: next.length * 0.4 });
      });
    }
    setPaths(next);
  }, [containerRef]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [containerRef, measure]);
  return paths;
}

export function AgentFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { ref: screenRef, visible } = useOnScreen<HTMLDivElement>();
  const paths = useBeamPaths(containerRef);
  const status = useCycle(AGENT_FLOW.statuses.length, 2000, visible);
  const finished = status === AGENT_FLOW.statuses.length - 1;

  return (
    <section aria-label="How a booking flows" className={cn(gutter, "border-t border-line py-14 sm:py-16")}>
      <div ref={screenRef} className={shell}>
        <div ref={containerRef} className="relative grid items-center gap-6 md:grid-cols-[1fr_auto_1fr] md:gap-16">
          <svg className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible md:block" aria-hidden="true">
            <defs>
              <linearGradient id="flow-light" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#8E5BFF" stopOpacity="0" />
                <stop offset="50%" stopColor="#8E5BFF" stopOpacity="1" />
                <stop offset="100%" stopColor="#C9B6FF" stopOpacity="0" />
              </linearGradient>
            </defs>
            {paths.map((p, i) => (
              <g key={i}>
                <path d={p.d} fill="none" stroke="#E4E0EC" strokeWidth={1.25} />
                <path
                  d={p.d}
                  fill="none"
                  stroke="url(#flow-light)"
                  pathLength={1}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  className="flow-light"
                  style={{ animationDelay: `${p.delay}s` }}
                />
              </g>
            ))}
          </svg>

          <ul className="relative flex flex-wrap justify-center gap-2 md:flex-col md:items-end">
            {AGENT_FLOW.sources.map((s) => {
              const Icon = ICONS[s.key as keyof typeof ICONS];
              return (
                <li
                  key={s.key}
                  data-beam="source"
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[14px] text-ink shadow-[0_6px_16px_-12px_rgba(11,10,17,0.35)]"
                >
                  <Icon className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
                  {s.label}
                </li>
              );
            })}
          </ul>

          <div
            data-beam="agent"
            className="relative mx-auto w-full max-w-[260px] rounded-2xl border border-[#E3D7FF] bg-white px-6 pb-6 pt-7 text-center shadow-[0_0_72px_-28px_rgba(104,16,254,0.55)]"
          >
            <span className="relative mx-auto grid h-14 w-14 place-items-center rounded-full border border-line bg-gradient-to-b from-white to-[#F3EEFF]">
              <RiSparkling2Fill className="h-6 w-6 text-[#6810FE]" aria-hidden="true" />
              <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" aria-hidden="true" />
            </span>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{AGENT_FLOW.agentRole}</p>
            <p className="text-[20px] font-medium tracking-[-0.02em] text-ink">{AGENT_FLOW.agent}</p>
            <p className="mt-3 h-5 text-[13px] text-ink-muted" aria-live="polite">
              {AGENT_FLOW.statuses[status]}
            </p>
          </div>

          <div
            data-beam="output"
            className="relative mx-auto w-full max-w-[320px] rounded-xl border border-line bg-white p-4 shadow-[0_16px_40px_-28px_rgba(11,10,17,0.4)] md:mx-0"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg border border-line bg-[#F6F5F9]">
                <RiCalendarCheckLine className="h-[18px] w-[18px] text-[#6810FE]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-ink">{AGENT_FLOW.output.title}</p>
                <p className="text-[12.5px] text-ink-muted">{AGENT_FLOW.output.meta}</p>
              </div>
            </div>
            <div className="mt-3">
              <Chip tone={finished ? "good" : "warn"} dot>
                {finished ? AGENT_FLOW.output.state : "In progress"}
              </Chip>
            </div>
          </div>
        </div>
        <p className="mt-8 text-center text-[13px] text-ink-muted">{AGENT_FLOW.caption}</p>
      </div>
    </section>
  );
}
