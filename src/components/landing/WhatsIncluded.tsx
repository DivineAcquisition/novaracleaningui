"use client";

// What's included, from the same checklists the crews work from
// (src/lib/checklists.ts). Items a Deep or Move-in/out clean adds over
// Standard are marked so the step up is easy to see.

import { useState } from "react";
import Link from "next/link";
import { RiArrowRightLine, RiCheckLine, RiAddLine } from "@remixicon/react";
import { CHECKLISTS } from "@/lib/checklists";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "standard-clean", label: "Standard" },
  { slug: "deep-clean", label: "Deep" },
  { slug: "move-in-out", label: "Move-in/out" },
] as const;

const standardItems = new Set(
  CHECKLISTS["standard-clean"].sections.flatMap((s) => s.items.map((i) => i.toLowerCase())),
);

export function WhatsIncluded() {
  const [tab, setTab] = useState<(typeof TABS)[number]["slug"]>("standard-clean");
  const checklist = CHECKLISTS[tab];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div role="tablist" aria-label="Type of clean" className="mb-5 inline-flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.slug}
            role="tab"
            id={`tab-${t.slug}`}
            aria-selected={tab === t.slug}
            aria-controls="included-panel"
            onClick={() => setTab(t.slug)}
            className={cn(
              "rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.slug ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="included-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
          {checklist.tagline}. {checklist.meta.estimatedTime}.
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {checklist.sections.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1.5 text-sm">
                {section.items.map((item) => {
                  const extra = tab !== "standard-clean" && !standardItems.has(item.toLowerCase());
                  return (
                    <li key={item} className="flex gap-2">
                      {extra ? (
                        <RiAddLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-label="Added" />
                      ) : (
                        <RiCheckLine className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                      )}
                      <span className={extra ? "font-medium text-foreground" : "text-foreground/85"}>{item}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          {tab !== "standard-clean" ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <RiAddLine className="h-4 w-4 text-primary" aria-hidden="true" /> Added on top of a Standard clean
            </span>
          ) : (
            <span className="text-muted-foreground">Every visit follows this checklist.</span>
          )}
          <Link
            href={`/checklist/${tab}`}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Full {checklist.name} checklist
            <RiArrowRightLine className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
