"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiClockwise2Line,
  RiSparklingLine,
  RiCalendarCheckLine,
  RiQuestionLine,
  RiAddCircleLine,
  RiInformationLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  Checklist,
  CHECKLISTS,
  CHECKLIST_SLUGS,
} from "@/lib/checklists";

interface ChecklistViewProps {
  checklist: Checklist;
}

// Tailwind palette segments per accent. Kept as plain string maps (not
// dynamic `bg-${accent}-50`) so PurgeCSS keeps them.
const ACCENT_STYLES: Record<
  Checklist["accent"],
  {
    pill: string;
    sectionIcon: string;
    sectionIconBg: string;
    heroBg: string;
    cta: string;
    chip: string;
    ring: string;
  }
> = {
  emerald: {
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
    sectionIcon: "text-emerald-600 dark:text-emerald-400",
    sectionIconBg: "bg-emerald-50 dark:bg-emerald-950/30",
    heroBg: "from-emerald-50 via-white to-white dark:from-emerald-950/20 dark:via-background dark:to-background",
    cta: "bg-emerald-600 hover:bg-emerald-700 text-white",
    chip: "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    ring: "ring-emerald-200/60 dark:ring-emerald-900/40",
  },
  blue: {
    pill: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900",
    sectionIcon: "text-sky-600 dark:text-sky-400",
    sectionIconBg: "bg-sky-50 dark:bg-sky-950/30",
    heroBg: "from-sky-50 via-white to-white dark:from-sky-950/20 dark:via-background dark:to-background",
    cta: "bg-sky-600 hover:bg-sky-700 text-white",
    chip: "bg-sky-100/70 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    ring: "ring-sky-200/60 dark:ring-sky-900/40",
  },
  purple: {
    pill: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900",
    sectionIcon: "text-violet-600 dark:text-violet-400",
    sectionIconBg: "bg-violet-50 dark:bg-violet-950/30",
    heroBg: "from-violet-50 via-white to-white dark:from-violet-950/20 dark:via-background dark:to-background",
    cta: "bg-violet-600 hover:bg-violet-700 text-white",
    chip: "bg-violet-100/70 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
    ring: "ring-violet-200/60 dark:ring-violet-900/40",
  },
  slate: {
    pill: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800",
    sectionIcon: "text-slate-600 dark:text-slate-300",
    sectionIconBg: "bg-slate-100 dark:bg-slate-900/40",
    heroBg: "from-slate-50 via-white to-white dark:from-slate-950/30 dark:via-background dark:to-background",
    cta: "bg-slate-800 hover:bg-slate-900 text-white",
    chip: "bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-200",
    ring: "ring-slate-200/70 dark:ring-slate-800/50",
  },
  teal: {
    pill: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-900",
    sectionIcon: "text-teal-600 dark:text-teal-400",
    sectionIconBg: "bg-teal-50 dark:bg-teal-950/30",
    heroBg: "from-teal-50 via-white to-white dark:from-teal-950/20 dark:via-background dark:to-background",
    cta: "bg-teal-600 hover:bg-teal-700 text-white",
    chip: "bg-teal-100/70 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
    ring: "ring-teal-200/60 dark:ring-teal-900/40",
  },
  amber: {
    pill: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900",
    sectionIcon: "text-amber-600 dark:text-amber-400",
    sectionIconBg: "bg-amber-50 dark:bg-amber-950/30",
    heroBg: "from-amber-50 via-white to-white dark:from-amber-950/20 dark:via-background dark:to-background",
    cta: "bg-amber-600 hover:bg-amber-700 text-white",
    chip: "bg-amber-100/70 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    ring: "ring-amber-200/60 dark:ring-amber-900/40",
  },
};

export default function ChecklistView({ checklist }: ChecklistViewProps) {
  const router = useRouter();
  const a = ACCENT_STYLES[checklist.accent];

  const otherChecklists = CHECKLIST_SLUGS
    .filter((s) => s !== checklist.slug && CHECKLISTS[s].family === checklist.family)
    .map((s) => CHECKLISTS[s]);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${checklist.name} Checklist`}
        description={`${checklist.tagline}. See exactly what's included in a Novara Cleaning ${checklist.name.toLowerCase()}.`}
        canonical={`https://novaracleaning.com/checklist/${checklist.slug}`}
      />

      {/* Nav */}
      <div className="border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/checklist")}
            className="text-muted-foreground -ml-2"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> All checklists
          </Button>
          <Button
            size="sm"
            asChild
            className={cn("rounded-lg shadow-sm", a.cta)}
          >
            <Link href={checklist.bookingHref}>
              {checklist.family === "commercial" ? "Request a quote" : "Book this clean"}
              <RiArrowRightLine className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className={cn("bg-gradient-to-b", a.heroBg)}>
        <div className="container max-w-6xl mx-auto px-4 py-12 md:py-16">
          <div className="max-w-3xl space-y-4">
            <Badge
              variant="outline"
              className={cn("px-3 py-1 text-xs font-medium border", a.pill)}
            >
              <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" />
              {checklist.family === "commercial" ? "Commercial checklist" : "Service checklist"}
            </Badge>
            <h1 className="text-3xl md:text-5xl font-bold font-jakarta tracking-tight">
              {checklist.name}
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              {checklist.tagline}
            </p>
            <p className="text-sm md:text-base text-foreground/80 leading-relaxed pt-2 max-w-2xl">
              {checklist.description}
            </p>
          </div>

          {/* Meta pills */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetaCard
              icon={RiClockwise2Line}
              label="Estimated time"
              value={checklist.meta.estimatedTime}
              accent={a}
            />
            <MetaCard
              icon={RiCalendarCheckLine}
              label="Best for"
              value={checklist.meta.bestFor}
              accent={a}
            />
            <MetaCard
              icon={RiSparklingLine}
              label="Frequency"
              value={checklist.meta.frequency}
              accent={a}
            />
          </div>
        </div>
      </div>

      {/* What's included */}
      <div className="container max-w-6xl mx-auto px-4 py-12">
        <h2 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight mb-2">
          What's included
        </h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
          Every item below is part of the standard scope. Cleaners follow this
          exact list, in order, for every visit.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {checklist.sections.map((section) => (
            <Card
              key={section.title}
              className={cn(
                "shadow-sm border-border/60 hover:shadow-md transition-shadow",
                "ring-1",
                a.ring,
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center",
                      a.sectionIconBg,
                    )}
                  >
                    <RiCheckboxCircleFill className={cn("w-5 h-5", a.sectionIcon)} />
                  </div>
                  <CardTitle className="text-lg font-jakarta tracking-tight">
                    {section.title}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-2">
                  {section.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm">
                      <RiCheckboxCircleFill
                        className={cn(
                          "w-4 h-4 mt-0.5 shrink-0",
                          a.sectionIcon,
                        )}
                      />
                      <span className="text-foreground/90">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Not included */}
        {checklist.notIncluded.length > 0 && (
          <div className="mt-10">
            <Card className="border-amber-200/70 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900/40">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2.5">
                  <RiInformationLine className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  <CardTitle className="text-base font-jakarta">
                    {checklist.notIncludedHeading}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {checklist.notIncluded.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-sm text-foreground/85"
                    >
                      <span className="text-amber-600 dark:text-amber-400 mt-0.5">
                        —
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Add-ons */}
        {checklist.addOns.length > 0 && (
          <div className="mt-8">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <RiAddCircleLine className={cn("w-5 h-5", a.sectionIcon)} />
                  <div>
                    <CardTitle className="text-base font-jakarta">
                      Available add-ons
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Additional charges apply — add at checkout or ask your cleaner.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {checklist.addOns.map((item) => (
                    <span
                      key={item}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
                        a.chip,
                      )}
                    >
                      <RiAddCircleLine className="w-3.5 h-3.5" />
                      {item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 text-center max-w-2xl mx-auto space-y-4">
          <h3 className="text-xl md:text-2xl font-bold font-jakarta tracking-tight">
            {checklist.family === "commercial"
              ? `Ready to scope a ${checklist.name.toLowerCase()}?`
              : `Ready to book your ${checklist.name.toLowerCase()}?`}
          </h3>
          <p className="text-sm text-muted-foreground">
            {checklist.family === "commercial"
              ? "Tell us about the site and we'll follow up with a walkthrough or a firm price — the crew works this exact list."
              : "Transparent pricing, professional cleaners, 100% satisfaction guarantee. Most homes can be scheduled within 48 hours."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
            <Button
              asChild
              size="lg"
              className={cn("rounded-lg shadow-sm", a.cta)}
            >
              <Link href={checklist.bookingHref}>
                {checklist.family === "commercial" ? "Request a commercial quote" : "Book this clean"}
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
            {checklist.recommendedNextSlug && (
              <Button asChild size="lg" variant="outline" className="rounded-lg">
                <Link href={`/checklist/${checklist.recommendedNextSlug}`}>
                  {checklist.recommendedNextLabel}
                  <RiArrowRightLine className="w-4 h-4 ml-1.5" />
                </Link>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground/80 inline-flex items-center gap-1.5 justify-center pt-2">
            <RiQuestionLine className="w-3.5 h-3.5" />
            Questions? Text us at{" "}
            <a
              href="tel:+13013579119"
              className="underline underline-offset-2 hover:text-foreground"
            >
              (301) 357-9119
            </a>{" "}
            — we're happy to help.
          </p>
        </div>

        {/* Other checklists */}
        <div className="mt-16 border-t border-border/60 pt-10">
          <h3 className="text-lg font-bold font-jakarta tracking-tight mb-1">
            {checklist.family === "commercial" ? "Compare other commercial scopes" : "Compare other services"}
          </h3>
          <p className="text-sm text-muted-foreground mb-5">
            Each checklist lists every line item we&apos;ll touch — no surprises.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherChecklists.map((other) => {
              const oa = ACCENT_STYLES[other.accent];
              return (
                <Link
                  key={other.slug}
                  href={`/checklist/${other.slug}`}
                  className={cn(
                    "block group rounded-xl border border-border/60 bg-card p-4 transition-all",
                    "hover:border-foreground/20 hover:shadow-md",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                        oa.sectionIconBg,
                      )}
                    >
                      <RiSparklingLine className={cn("w-5 h-5", oa.sectionIcon)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm font-jakarta">
                        {other.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {other.tagline}
                      </p>
                    </div>
                    <RiArrowRightLine className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer strip */}
      <div className="border-t border-border/50 bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          © NovaraCleaning · Serving the DMV Area · Trusted. Thorough. On Time.
        </div>
      </div>
    </div>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof RiClockwise2Line;
  label: string;
  value: string;
  accent: (typeof ACCENT_STYLES)[Checklist["accent"]];
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex items-start gap-3">
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          accent.sectionIconBg,
        )}
      >
        <Icon className={cn("w-5 h-5", accent.sectionIcon)} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p className="text-sm font-medium text-foreground mt-0.5 leading-snug">
          {value}
        </p>
      </div>
    </div>
  );
}
