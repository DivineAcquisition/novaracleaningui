"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleFill,
  RiSparklingLine,
} from "@remixicon/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import {
  CHECKLISTS,
  COMMERCIAL_CHECKLIST_SLUGS,
  RESIDENTIAL_CHECKLIST_SLUGS,
  type ChecklistSlug,
} from "@/lib/checklists";
import { cn } from "@/lib/utils";

const ACCENT_BG: Record<string, string> = {
  emerald: "bg-emerald-50 dark:bg-emerald-950/30",
  blue: "bg-sky-50 dark:bg-sky-950/30",
  purple: "bg-violet-50 dark:bg-violet-950/30",
  amber: "bg-amber-50 dark:bg-amber-950/30",
  slate: "bg-slate-100 dark:bg-slate-900/40",
  teal: "bg-teal-50 dark:bg-teal-950/30",
};
const ACCENT_FG: Record<string, string> = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  blue: "text-sky-600 dark:text-sky-400",
  purple: "text-violet-600 dark:text-violet-400",
  amber: "text-amber-600 dark:text-amber-400",
  slate: "text-slate-600 dark:text-slate-300",
  teal: "text-teal-600 dark:text-teal-400",
};
const ACCENT_PILL: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  purple: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  slate: "bg-slate-200 text-slate-800 dark:bg-slate-800/60 dark:text-slate-200",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
};

export default function ChecklistIndex() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Cleaning Checklists"
        description="See exactly what's included in every Novara Cleaning service — home Standard, Deep, Move In/Out, and Recurring, plus commercial Light, Standard, Detailed, and office."
        canonical="https://novaracleaning.com/checklist"
      />

      {/* Nav */}
      <div className="border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="text-muted-foreground -ml-2"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Back home
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-b from-emerald-50/60 via-white to-white dark:from-emerald-950/10 dark:via-background dark:to-background">
        <div className="container max-w-6xl mx-auto px-4 py-12 md:py-16 text-center">
          <Badge
            variant="outline"
            className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900 px-3 py-1 text-xs font-medium"
          >
            <RiSparklingLine className="w-3.5 h-3.5 mr-1.5" />
            What's included
          </Badge>
          <h1 className="text-3xl md:text-5xl font-bold font-jakarta tracking-tight mt-4">
            Service checklists
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mt-3 max-w-2xl mx-auto">
            Every Novara service is built around a specific checklist — no
            mystery, no upsells once we&apos;re on site. Homes and commercial
            sites each have their own lists. Pick a service to see the exact
            line items the crew will execute.
          </p>
        </div>
      </div>

      {/* Cards */}
      <div className="container max-w-6xl mx-auto px-4 pb-16 space-y-12">
        <ChecklistFamily
          title="Homes"
          subtitle="The four residential lists — Standard, Deep, Move In/Out, and Recurring."
          slugs={RESIDENTIAL_CHECKLIST_SLUGS}
        />
        <ChecklistFamily
          title="Commercial & office"
          subtitle="Light, Standard, and Detailed are cumulative — each level is the one before it plus more. Office adds after-hours desk and lock-up rules."
          slugs={COMMERCIAL_CHECKLIST_SLUGS}
        />

        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Booking a home?{" "}
            <Link
              href="/book/zip"
              className="text-emerald-700 dark:text-emerald-400 font-medium hover:underline"
            >
              Start a booking
            </Link>
            . Scoping a site?{" "}
            <Link
              href="/commercial"
              className="text-teal-700 dark:text-teal-400 font-medium hover:underline"
            >
              Request a commercial quote
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="border-t border-border/50 bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
          © NovaraCleaning · Serving the DMV Area · Trusted. Thorough. On Time.
        </div>
      </div>
    </div>
  );
}

function ChecklistFamily({
  title,
  subtitle,
  slugs,
}: {
  title: string;
  subtitle: string;
  slugs: ChecklistSlug[];
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl md:text-2xl font-bold font-jakarta tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slugs.map((slug) => {
          const c = CHECKLISTS[slug];
          const previewCount = c.sections.reduce((n, s) => n + s.items.length, 0);
          return (
            <Link key={slug} href={`/checklist/${slug}`} className="group block">
              <Card className="h-full border-border/60 hover:border-foreground/20 hover:shadow-lg transition-all">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                        ACCENT_BG[c.accent],
                      )}
                    >
                      <RiSparklingLine className={cn("w-6 h-6", ACCENT_FG[c.accent])} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xl font-bold font-jakarta tracking-tight">{c.name}</h3>
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full",
                            ACCENT_PILL[c.accent],
                          )}
                        >
                          {previewCount} items
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{c.tagline}</p>
                    </div>
                    <RiArrowRightLine className="w-5 h-5 mt-2 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <Stat label="Time" value={c.meta.estimatedTime.split(" for ")[0]} />
                    <Stat label="Frequency" value={c.meta.frequency.split(",")[0]} />
                    <Stat label="Sections" value={`${c.sections.length} areas`} />
                  </div>
                  <ul className="space-y-1.5">
                    {c.sections[0]?.items.slice(0, 4).map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-foreground/80">
                        <RiCheckboxCircleFill
                          className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", ACCENT_FG[c.accent])}
                        />
                        <span className="line-clamp-1">{item}</span>
                      </li>
                    ))}
                    <li className="text-xs text-muted-foreground pl-5">
                      + {Math.max(0, previewCount - 4)} more items
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-xs font-medium text-foreground mt-0.5 line-clamp-1">
        {value}
      </p>
    </div>
  );
}
