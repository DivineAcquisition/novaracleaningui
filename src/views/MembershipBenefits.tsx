"use client";

// ─── /membership-benefits — public Glow Membership benefits page ────────
//
// Modeled on the /checklist/[slug] pages: nav → hero → benefit cards →
// plans strip → CTA → footer. This is the page admins email/text from a
// saved membership quote (send-membership-benefits edge fn), so it reads
// as a clear, factual "here's everything you get" — portal access, the
// Before & After photo report, cleaner-selection control, and the rest.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCameraLensLine,
  RiCheckboxCircleFill,
  RiDashboard3Line,
  RiHeartsLine,
  RiPriceTag3Line,
  RiQuestionLine,
  RiShieldCheckLine,
  RiSparklingLine,
  RiTicket2Line,
  RiUserStarLine,
  RiVipCrown2Line,
} from "@remixicon/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  BenefitSection,
  HERO_BENEFITS,
  MORE_BENEFITS,
  PLAN_SUMMARIES,
} from "@/lib/membership-benefits";

const ICONS: Record<BenefitSection["icon"], typeof RiDashboard3Line> = {
  portal: RiDashboard3Line,
  camera: RiCameraLensLine,
  cleaner: RiUserStarLine,
  price: RiPriceTag3Line,
  calendar: RiCalendarCheckLine,
  shield: RiShieldCheckLine,
  credit: RiTicket2Line,
  flex: RiHeartsLine,
};

export default function MembershipBenefits() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Glow Membership Benefits"
        description="Everything included with a NovaraCleaning Glow Membership — customer portal access, before & after photo reports, your choice of cleaner, member pricing, priority scheduling, and more."
        canonical="https://novaracleaning.com/membership-benefits"
      />

      {/* Nav */}
      <div className="border-b border-border/50">
        <div className="container max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/membership")}
            className="text-muted-foreground -ml-2"
          >
            <RiArrowLeftLine className="w-4 h-4 mr-1.5" /> Plans &amp; pricing
          </Button>
          <Button
            size="sm"
            asChild
            className="rounded-lg shadow-sm bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Link href="/membership">
              Become a member
              <RiArrowRightLine className="w-4 h-4 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-b from-violet-50 via-white to-white dark:from-violet-950/20 dark:via-background dark:to-background">
        <div className="container max-w-6xl mx-auto px-4 py-12 md:py-16">
          <div className="max-w-3xl space-y-4">
            <Badge
              variant="outline"
              className="px-3 py-1 text-xs font-medium border bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900"
            >
              <RiVipCrown2Line className="w-3.5 h-3.5 mr-1.5" />
              Glow Membership
            </Badge>
            <h1 className="text-3xl md:text-5xl font-bold font-jakarta tracking-tight">
              Membership Benefits
            </h1>
            <p className="text-base md:text-lg text-muted-foreground">
              More than a recurring clean — a home that runs itself, with you in
              control.
            </p>
            <p className="text-sm md:text-base text-foreground/80 leading-relaxed pt-2 max-w-2xl">
              Every Glow Membership includes your own customer portal, photo
              proof of every visit, your choice of cleaner, our best per-clean
              rates, and priority scheduling — all backed by the 48-hour
              re-clean guarantee. Here&apos;s everything you get.
            </p>
          </div>

          {/* Meta pills */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetaCard
              icon={RiSparklingLine}
              label="Plans"
              value="Monthly · Bi-Weekly · Weekly"
            />
            <MetaCard
              icon={RiPriceTag3Line}
              label="Member pricing"
              value="Our best per-clean rates, flat by home size"
            />
            <MetaCard
              icon={RiHeartsLine}
              label="Commitment"
              value="Free rescheduling · pause or cancel anytime"
            />
          </div>
        </div>
      </div>

      <div className="container max-w-6xl mx-auto px-4 py-12">
        {/* Headline benefits */}
        <h2 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight mb-2">
          The big three
        </h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
          The benefits members tell us they can&apos;t live without — full
          visibility, photo proof, and control over who cleans your home.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {HERO_BENEFITS.map((b) => (
            <BenefitCard key={b.title} benefit={b} featured />
          ))}
        </div>

        {/* Everything else */}
        <h2 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight mt-14 mb-2">
          And everything else
        </h2>
        <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
          Every plan includes the full stack below — no tiers of fine print.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {MORE_BENEFITS.map((b) => (
            <BenefitCard key={b.title} benefit={b} />
          ))}
        </div>

        {/* Plans strip */}
        <div className="mt-14">
          <h2 className="text-2xl md:text-3xl font-bold font-jakarta tracking-tight mb-2">
            Pick your rhythm
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-2xl">
            Same benefits on every plan — just choose how often we visit.
            Pricing is a flat rate based on your home size.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PLAN_SUMMARIES.map((p) => (
              <Card
                key={p.id}
                className={cn(
                  "shadow-sm border-border/60 relative overflow-hidden",
                  p.highlight && "ring-2 ring-violet-300 dark:ring-violet-800",
                )}
              >
                {p.highlight && (
                  <span className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider bg-violet-600 text-white rounded-full px-2 py-0.5">
                    Most popular
                  </span>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-jakarta tracking-tight">
                    {p.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <p className="text-2xl font-bold font-jakarta text-violet-700 dark:text-violet-300">
                    {p.cleansPerMonth}
                    <span className="text-sm font-medium text-muted-foreground">
                      {" "}
                      clean{p.cleansPerMonth > 1 ? "s" : ""} / month
                    </span>
                  </p>
                  <p className="text-sm text-foreground/80">{p.blurb}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-14 text-center max-w-2xl mx-auto space-y-4">
          <h3 className="text-xl md:text-2xl font-bold font-jakarta tracking-tight">
            Ready to make it effortless?
          </h3>
          <p className="text-sm text-muted-foreground">
            Join Glow and your next clean books itself — portal access, photo
            reports, and your preferred cleaner from day one.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
            <Button
              asChild
              size="lg"
              className="rounded-lg shadow-sm bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Link href="/membership">
                View plans &amp; pricing
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-lg">
              <Link href="/checklist/recurring">
                See the cleaning checklist
                <RiArrowRightLine className="w-4 h-4 ml-1.5" />
              </Link>
            </Button>
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
            — we&apos;re happy to help.
          </p>
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

function BenefitCard({
  benefit,
  featured = false,
}: {
  benefit: BenefitSection;
  featured?: boolean;
}) {
  const Icon = ICONS[benefit.icon];
  return (
    <Card
      className={cn(
        "shadow-sm border-border/60 hover:shadow-md transition-shadow ring-1 ring-violet-200/60 dark:ring-violet-900/40",
        featured && "bg-violet-50/40 dark:bg-violet-950/10",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-violet-50 dark:bg-violet-950/30">
            <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <CardTitle className="text-lg font-jakarta tracking-tight">
              {benefit.title}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{benefit.tagline}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-2">
          {benefit.items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm">
              <RiCheckboxCircleFill className="w-4 h-4 mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />
              <span className="text-foreground/90">{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MetaCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof RiSparklingLine;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 dark:bg-violet-950/30">
        <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
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
