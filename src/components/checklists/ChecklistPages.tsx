"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiCheckLine,
  RiDropLine,
  RiHomeLine,
  RiMoonLine,
  RiPhoneLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiSunLine,
  RiTimeLine,
} from "@remixicon/react";
import { INBOUND_PHONE, SUPPORT_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";

const logo = "/novara-logo.png";

type Icon = ComponentType<{ className?: string }>;

export function countItems(sections: Array<{ items: string[] }>): number {
  return sections.reduce((total, section) => total + section.items.length, 0);
}

export function roomIcon(title: string): Icon {
  const name = title.toLowerCase();
  if (name.includes("bath")) return RiDropLine;
  if (name.includes("kitchen") || name.includes("break")) return RiSparklingLine;
  if (name.includes("daily") || name.includes("every visit") || name.includes("light")) return RiSunLine;
  if (name.includes("week")) return RiCalendarCheckLine;
  if (name.includes("month") || name.includes("night")) return RiMoonLine;
  if (name.includes("rule") || name.includes("disinfect") || name.includes("high-touch")) return RiShieldCheckLine;
  if (name.includes("commercial") || name.includes("office") || name.includes("site") || name.includes("detailed") || name.includes("standard scope")) return RiBuilding2Line;
  if (name.includes("before") || name.includes("arrival") || name.includes("time")) return RiTimeLine;
  return RiHomeLine;
}

export function ChecklistShell({
  children,
  ctaHref = "/book/zip",
  ctaLabel = "Book a clean",
}: {
  children: ReactNode;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <img src={logo} alt="" className="h-9 w-9 rounded-xl" />
            <span className="font-jakarta text-lg font-bold tracking-tight">
              Novara<span className="text-primary">Cleaning</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={INBOUND_PHONE.tel}
              className="hidden items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
            >
              <RiPhoneLine className="h-4 w-4" />
              {INBOUND_PHONE.display}
            </a>
            <Link
              href={ctaHref}
              className="inline-flex h-10 items-center rounded-xl bg-gradient-primary px-4 text-sm font-semibold text-white shadow-lavender transition hover:opacity-90"
            >
              {ctaLabel}
              <RiArrowRightLine className="ml-1.5 h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-border/60 bg-muted/30">
        <div className="container mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>Novara Cleaning · Maryland, Washington DC, and Northern Virginia</p>
          <a href={SUPPORT_PHONE.tel} className="hover:text-foreground">
            Questions {SUPPORT_PHONE.display}
          </a>
        </div>
      </footer>
    </div>
  );
}

export function ChecklistBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center text-sm font-medium text-white/80 transition hover:text-white"
    >
      <RiArrowLeftLine className="mr-1.5 h-4 w-4" />
      {label}
    </Link>
  );
}

export function ScopeRoom({
  title,
  items,
  index,
  id,
}: {
  title: string;
  items: string[];
  index: number;
  id: string;
}) {
  const Icon = roomIcon(title);
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      <div className="flex items-center gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.08] to-transparent px-5 py-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-primary text-white shadow-lavender">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Area {index}</p>
          <h2 className="font-jakarta text-lg font-bold tracking-tight">{title}</h2>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {items.length}
        </span>
      </div>
      <ul className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 rounded-2xl bg-muted/50 px-3 py-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <RiCheckLine className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm leading-snug text-foreground/90">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AsideNote({
  tone,
  title,
  items,
}: {
  tone: "warn" | "add";
  title: string;
  items: string[];
}) {
  const warn = tone === "warn";
  return (
    <section
      className={cn(
        "rounded-3xl border p-5 sm:p-6",
        warn
          ? "border-amber-200/80 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20"
          : "border-border/70 bg-card shadow-card",
      )}
    >
      <h2 className="font-jakarta text-lg font-bold tracking-tight">{title}</h2>
      {warn ? (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-snug">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary"
            >
              <RiAddLine className="h-3.5 w-3.5" />
              {item}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
