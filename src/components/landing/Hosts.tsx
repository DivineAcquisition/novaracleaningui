"use client";

// Airbnb / short-term-rental hosts. A tab switcher over what the turnover
// service does; items come from the STR turnover checklist.

import { useState } from "react";
import Link from "next/link";
import { RiArrowRightLine, RiCheckLine } from "@/components/icons";
import { HOSTS } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { Section, btnOutline, btnPrimary } from "./primitives";

export function Hosts() {
  const [active, setActive] = useState<string>(HOSTS.tabs[0].id);
  const tab = HOSTS.tabs.find((t) => t.id === active) || HOSTS.tabs[0];

  return (
    <Section id={HOSTS.id} headline={HOSTS.headline} lead={HOSTS.lead}>
      <div role="tablist" aria-label="Host turnovers" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-[#F6F5F9] p-1">
        {HOSTS.tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`host-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls="host-panel"
            onClick={() => setActive(t.id)}
            className={cn(
              "rounded-lg px-2 py-2 text-[13.5px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] sm:text-[14.5px]",
              active === t.id ? "bg-white text-ink shadow-[0_1px_3px_rgba(11,10,17,0.12)]" : "text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id="host-panel"
        role="tabpanel"
        aria-labelledby={`host-tab-${tab.id}`}
        className="mt-5 grid gap-6 rounded-2xl border border-line bg-white p-5 shadow-[0_16px_40px_-30px_rgba(11,10,17,0.35)] md:grid-cols-[0.8fr_1.2fr] md:p-6"
      >
        <div>
          <h3 className="text-[24px] font-medium tracking-[-0.02em] text-ink">{tab.title}</h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-muted">{tab.body}</p>
        </div>
        <ul className="space-y-2">
          {tab.items.map((item, i) => (
            <li
              key={item}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3.5 py-3 text-[14px] text-ink",
                i === 0 ? "border-[#E3D7FF] bg-[#F7F4FF]" : "border-line bg-[#FAFAFC]",
              )}
            >
              <RiCheckLine className="h-4 w-4 flex-shrink-0 text-[#6810FE]" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href={HOSTS.primary.href} className={btnPrimary}>
          {HOSTS.primary.label}
          <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
        </Link>
        <a href={HOSTS.secondary.href} className={btnOutline}>
          {HOSTS.secondary.label}
        </a>
      </div>
    </Section>
  );
}
