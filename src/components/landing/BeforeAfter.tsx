"use client";

// Before and after photos from real Novara jobs, with a drag slider.
// Renders nothing until BEFORE_AFTER in src/lib/landing/content.ts has pairs.

import { useState } from "react";
import { BEFORE_AFTER } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { Section } from "./primitives";

function Pair({ room, service, before, after }: (typeof BEFORE_AFTER)[number]) {
  const [x, setX] = useState(50);
  return (
    <figure>
      <div className="relative aspect-[4/3] select-none overflow-hidden rounded-2xl border border-line bg-[#F6F5F9]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={`${room} after a Novara ${service}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={before} alt={`${room} before the clean`} className="h-full w-full object-cover" loading="lazy" />
        </div>
        <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink">Before</span>
        <span className="absolute right-3 top-3 rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink">After</span>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(11,10,17,0.15)]" style={{ left: `${x}%` }}>
          <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-[12px] text-ink shadow">
            ⇆
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={x}
          onChange={(e) => setX(Number(e.target.value))}
          aria-label={`Compare ${room} before and after`}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <figcaption className="mt-2 text-[13.5px] text-ink-muted">
        {room} · {service}
      </figcaption>
    </figure>
  );
}

export function BeforeAfterSection() {
  if (!BEFORE_AFTER.length) return null;
  return (
    <Section id="results" eyebrow="Real results" headline="See the difference." lead="Photos from Novara cleans, taken by our cleaners before and after the visit.">
      <div className={cn("grid gap-6", BEFORE_AFTER.length > 1 && "md:grid-cols-2")}>
        {BEFORE_AFTER.map((p) => (
          <Pair key={p.before} {...p} />
        ))}
      </div>
    </Section>
  );
}
