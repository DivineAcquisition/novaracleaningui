"use client";

// Button-driven tab bar with the same chip layout as <TabsList variant="chips">.
// For screens that switch sections through their own state or the URL rather
// than Radix Tabs. Chips wrap onto another line instead of overlapping, and
// the bar exposes tablist/tab semantics with arrow-key movement.

import * as React from "react";

import { chipClass } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface SectionTab<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Small count or status shown after the label. */
  badge?: React.ReactNode;
  title?: string;
}

export function SectionTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: SectionTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the bar, e.g. "Cleaner sections". */
  label: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };
  return (
    <div role="tablist" aria-label={label} data-variant="chips" className={cn("flex w-full flex-wrap items-center gap-1.5", className)}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-state={on ? "active" : "inactive"}
            data-variant="chips"
            title={t.title}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(i, 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); move(i, -1); }
              else if (e.key === "Home") { e.preventDefault(); move(i, -i); }
              else if (e.key === "End") { e.preventDefault(); move(i, tabs.length - 1 - i); }
            }}
            className={chipClass}
          >
            {Icon ? <Icon className="h-4 w-4" /> : null}
            {t.label}
            {t.badge != null && t.badge !== false ? (
              <span className="rounded-full bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-600">{t.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
