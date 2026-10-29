"use client";

import Link from "next/link";
import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiSparklingLine,
  RiTimeLine,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import { SUPPORT_PHONE } from "@/config/brand-config";
import {
  AsideNote,
  ChecklistBack,
  ChecklistShell,
  ScopeRoom,
  countItems,
} from "@/components/checklists/ChecklistPages";
import {
  CHECKLISTS,
  CHECKLIST_SLUGS,
  type Checklist,
} from "@/lib/checklists";

export default function ChecklistView({ checklist }: { checklist: Checklist }) {
  const total = countItems(checklist.sections);
  const bookLabel = checklist.family === "commercial" ? "Request a quote" : "Book this clean";
  const others = CHECKLIST_SLUGS
    .filter((slug) => slug !== checklist.slug && CHECKLISTS[slug].family === checklist.family)
    .map((slug) => CHECKLISTS[slug]);

  return (
    <ChecklistShell ctaHref={checklist.bookingHref} ctaLabel={bookLabel}>
      <SEO
        title={`${checklist.name} Checklist`}
        description={`${checklist.tagline}. See exactly what's included in a Novara Cleaning ${checklist.name.toLowerCase()}.`}
        canonical={`https://novaracleaning.com/checklist/${checklist.slug}`}
      />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-primary" />
        <div className="absolute -right-16 top-0 h-64 w-64 rounded-full bg-white/15 blur-3xl" />
        <div className="relative container mx-auto max-w-6xl px-4 py-10 text-white md:py-14">
          <ChecklistBack href="/checklist" label="All checklists" />
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-white/75">
            {checklist.family === "commercial" ? "Commercial checklist" : "Home checklist"}
          </p>
          <h1 className="mt-2 max-w-3xl font-jakarta text-4xl font-extrabold tracking-tight md:text-6xl">
            {checklist.name}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-white/85 md:text-lg">{checklist.tagline}</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/75 md:text-base">{checklist.description}</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <GlassFact icon={RiTimeLine} label="Time" value={checklist.meta.estimatedTime} />
            <GlassFact icon={RiSparklingLine} label="Best for" value={checklist.meta.bestFor} />
            <GlassFact icon={RiCalendarCheckLine} label="Frequency" value={checklist.meta.frequency} />
          </div>
        </div>
      </section>

      <div className="container mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground lg:block">
            On this list
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:mt-3 lg:block lg:space-y-1 lg:overflow-visible">
            {checklist.sections.map((section, index) => (
              <a
                key={section.title}
                href={`#area-${index + 1}`}
                className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 hover:border-primary/40 hover:text-primary lg:block lg:rounded-xl lg:border-0 lg:bg-transparent lg:px-0 lg:py-1.5 lg:text-sm"
              >
                <span className="text-primary/70 lg:mr-2">{String(index + 1).padStart(2, "0")}</span>
                {section.title}
              </a>
            ))}
          </div>
          <p className="mt-4 hidden text-xs text-muted-foreground lg:block">
            {checklist.sections.length} areas · {total} lines
          </p>
        </aside>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-jakarta text-2xl font-bold tracking-tight md:text-3xl">What&apos;s included</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {total} lines across {checklist.sections.length} areas. This is the scope the crew follows.
              </p>
            </div>
          </div>

          {checklist.sections.map((section, index) => (
            <ScopeRoom
              key={section.title}
              id={`area-${index + 1}`}
              index={index + 1}
              title={section.title}
              items={section.items}
            />
          ))}

          {checklist.notIncluded.length > 0 && (
            <AsideNote tone="warn" title={checklist.notIncludedHeading} items={checklist.notIncluded} />
          )}
          {checklist.addOns.length > 0 && (
            <AsideNote tone="add" title="Available add-ons" items={checklist.addOns} />
          )}

          <section className="overflow-hidden rounded-[28px] bg-gradient-primary px-6 py-8 text-center text-white shadow-lavender">
            <h2 className="font-jakarta text-2xl font-bold tracking-tight md:text-3xl">
              {checklist.family === "commercial"
                ? `Ready to scope a ${checklist.name.toLowerCase()}?`
                : `Ready to book your ${checklist.name.toLowerCase()}?`}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-white/80">
              {checklist.family === "commercial"
                ? "Tell us about the site. The crew works this exact list."
                : "The crew works this exact list. Most homes can be scheduled within a couple of days."}
            </p>
            <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={checklist.bookingHref}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-primary"
              >
                {bookLabel}
                <RiArrowRightLine className="ml-1.5 h-4 w-4" />
              </Link>
              {checklist.recommendedNextSlug && (
                <Link
                  href={`/checklist/${checklist.recommendedNextSlug}`}
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-white/40 px-5 text-sm font-semibold text-white"
                >
                  {checklist.recommendedNextLabel}
                </Link>
              )}
            </div>
            <p className="mt-4 text-xs text-white/70">
              Questions?{" "}
              <a href={SUPPORT_PHONE.tel} className="underline underline-offset-2">
                {SUPPORT_PHONE.display}
              </a>
            </p>
          </section>

          <div className="pt-4">
            <h2 className="font-jakarta text-lg font-bold">
              {checklist.family === "commercial" ? "Other commercial scopes" : "Other home lists"}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {others.map((other) => (
                <Link
                  key={other.slug}
                  href={`/checklist/${other.slug}`}
                  className="group flex items-center justify-between rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-card hover:border-primary/30"
                >
                  <span>
                    <span className="block font-jakarta text-sm font-bold">{other.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-1">{other.tagline}</span>
                  </span>
                  <RiArrowRightLine className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ChecklistShell>
  );
}

function GlassFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof RiTimeLine;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/70">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug text-white">{value}</p>
    </div>
  );
}
