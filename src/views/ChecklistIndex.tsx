"use client";

import Link from "next/link";
import {
  RiArrowRightLine,
  RiCheckLine,
} from "@remixicon/react";
import { SEO } from "@/components/SEO";
import {
  ChecklistShell,
  countItems,
  roomIcon,
} from "@/components/checklists/ChecklistPages";
import {
  CHECKLISTS,
  COMMERCIAL_CHECKLIST_SLUGS,
  RESIDENTIAL_CHECKLIST_SLUGS,
  type ChecklistSlug,
} from "@/lib/checklists";

export default function ChecklistIndex() {
  return (
    <ChecklistShell>
      <SEO
        title="Cleaning Checklists"
        description="See exactly what's included in every Novara Cleaning service — home Standard, Deep, Move In/Out, and Recurring, plus commercial Light, Standard, Detailed, and office."
        canonical="https://novaracleaning.com/checklist"
      />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.08] via-background to-background" />
        <div className="absolute left-1/2 top-0 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="relative container mx-auto grid max-w-6xl items-end gap-10 px-4 pb-12 pt-14 md:grid-cols-[1.2fr_0.8fr] md:pb-16 md:pt-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">What&apos;s included</p>
            <h1 className="mt-3 font-jakarta text-4xl font-extrabold tracking-tight md:text-6xl md:leading-[1.02]">
              The exact list
              <span className="block bg-gradient-primary bg-clip-text text-transparent">the crew follows</span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
              Homes and commercial sites each have their own scope. Open a service and you&apos;ll see every line, in the order it gets done.
            </p>
          </div>
          <PreviewCard />
        </div>
      </section>

      <div className="container mx-auto max-w-6xl space-y-14 px-4 pb-16">
        <ChecklistFamily
          kicker="Homes"
          title="Four residential lists"
          subtitle="Standard, Deep, Move In/Out, and Recurring."
          slugs={RESIDENTIAL_CHECKLIST_SLUGS}
        />
        <ChecklistFamily
          kicker="Sites"
          title="Commercial and office"
          subtitle="Light, Standard, and Detailed stack. Office adds after-hours desk and lock-up rules."
          slugs={COMMERCIAL_CHECKLIST_SLUGS}
        />
      </div>
    </ChecklistShell>
  );
}

function PreviewCard() {
  const sample = CHECKLISTS["standard-clean"];
  const kitchen = sample.sections[0];
  return (
    <Link
      href="/checklist/standard-clean"
      className="group block rounded-[28px] border border-border/70 bg-card p-5 shadow-xl shadow-primary/10"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Sample · Standard</p>
        <span className="text-xs text-muted-foreground">{countItems(sample.sections)} lines</span>
      </div>
      <p className="mt-3 font-jakarta text-2xl font-bold">{kitchen?.title}</p>
      <ul className="mt-4 space-y-2">
        {kitchen?.items.slice(0, 4).map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <RiCheckLine className="h-3.5 w-3.5" />
            </span>
            <span className="line-clamp-1">{item}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 inline-flex items-center text-sm font-semibold text-primary">
        Open the full list
        <RiArrowRightLine className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
      </p>
    </Link>
  );
}

function ChecklistFamily({
  kicker,
  title,
  subtitle,
  slugs,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  slugs: ChecklistSlug[];
}) {
  return (
    <section>
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{kicker}</p>
        <h2 className="mt-1 font-jakarta text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {slugs.map((slug) => {
          const checklist = CHECKLISTS[slug];
          const total = countItems(checklist.sections);
          const Icon = roomIcon(checklist.sections[0]?.title || checklist.name);
          return (
            <Link
              key={slug}
              href={`/checklist/${slug}`}
              className="group relative overflow-hidden rounded-[28px] border border-border/70 bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-xl"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-primary" />
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary text-white shadow-lavender">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-jakarta text-xl font-bold tracking-tight">{checklist.name}</h3>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {total} lines
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{checklist.tagline}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Fact label="Time" value={checklist.meta.estimatedTime.split(" for ")[0]} />
                <Fact label="Frequency" value={checklist.meta.frequency.split(",")[0]} />
                <Fact label="Areas" value={`${checklist.sections.length}`} />
              </div>
              <ul className="mt-4 space-y-1.5">
                {checklist.sections[0]?.items.slice(0, 3).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-foreground/80">
                    <RiCheckLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="line-clamp-1">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 inline-flex items-center text-sm font-semibold text-primary">
                See every line
                <RiArrowRightLine className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 line-clamp-1 text-xs font-medium">{value}</p>
    </div>
  );
}
