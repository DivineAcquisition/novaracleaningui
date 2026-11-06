"use client";

// "Our promises are policies." The stated policies, then an interactive sample
// of a re-clean request. The sample sends nothing.

import { useState } from "react";
import { RiCheckboxCircleFill, RiRefreshLine } from "@/components/icons";
import { PROMISES } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { Chip, Section, btnPrimary } from "./primitives";

function RecleanDemo() {
  const d = PROMISES.demo;
  const [picked, setPicked] = useState<string[]>(["Kitchen"]);
  const [sent, setSent] = useState(false);
  const toggle = (area: string) =>
    setPicked((cur) => (cur.includes(area) ? cur.filter((a) => a !== area) : [...cur, area]));

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_24px_50px_-30px_rgba(11,10,17,0.4)] sm:p-6">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5A1FD6]">{d.label}</p>
        <span className="h-2 w-2 rounded-full bg-[#8E5BFF]" aria-hidden="true" />
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium text-ink">{d.visit}</p>
          <p className="text-[13px] text-ink-muted">{d.within}</p>
        </div>
        <Chip tone={sent ? "good" : "warn"} dot>
          {sent ? "Scheduled" : "Within 48 hours"}
        </Chip>
      </div>

      {sent ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
          <p className="flex items-center gap-2 text-[15px] font-medium text-emerald-800">
            <RiCheckboxCircleFill className="h-5 w-5" aria-hidden="true" />
            {d.sentTitle}
          </p>
          <p className="mt-1 text-[13.5px] text-emerald-800/80">
            {picked.join(", ")}. {d.sentBody}
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-800 underline-offset-4 hover:underline"
          >
            <RiRefreshLine className="h-3.5 w-3.5" aria-hidden="true" />
            {d.reset}
          </button>
        </div>
      ) : (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked.length) setSent(true);
          }}
        >
          <fieldset>
            <legend className="mb-2 text-[13px] text-ink-muted">What was missed?</legend>
            <div className="flex flex-wrap gap-2">
              {d.areas.map((area) => (
                <label key={area} className="cursor-pointer">
                  <input type="checkbox" checked={picked.includes(area)} onChange={() => toggle(area)} className="peer sr-only" />
                  <span className="inline-block rounded-full border border-line bg-white px-3 py-1.5 text-[13.5px] text-ink transition peer-checked:border-[#C9B6FF] peer-checked:bg-[#F3EEFF] peer-checked:text-[#4A0CD0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#6810FE]">
                    {area}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={!picked.length} className={cn(btnPrimary, "mt-4 h-11")}>
            {d.submit}
          </button>
        </form>
      )}
    </div>
  );
}

export function Promises() {
  return (
    <Section id={PROMISES.id} headline={PROMISES.headline} lead={PROMISES.lead}>
      <ol className="grid gap-2 sm:grid-cols-3">
        {PROMISES.steps.map((step, i) => (
          <li
            key={step}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3 text-[14.5px] text-ink",
              i === PROMISES.steps.length - 1 ? "border-[#C9B6FF] bg-[#F7F4FF]" : "border-line bg-white",
            )}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-[#F6F5F9] font-mono text-[10.5px] text-ink-muted">{i + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {PROMISES.items.map((item) => (
          <li key={item} className="rounded-xl border border-line bg-white p-4 text-[14.5px] leading-relaxed text-ink shadow-[0_16px_40px_-32px_rgba(11,10,17,0.35)]">
            {item}
          </li>
        ))}
      </ul>
      <div className="mt-12 grid items-center gap-6 lg:grid-cols-[0.8fr_1fr] lg:gap-12">
        <div className="max-w-md">
          <h3 className="text-[21px] font-medium tracking-[-0.02em] text-ink">{PROMISES.demo.introTitle}</h3>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-muted">{PROMISES.demo.introBody}</p>
        </div>
        <RecleanDemo />
      </div>
    </Section>
  );
}
