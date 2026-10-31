"use client";

import type { ComponentType, ReactNode } from "react";
import {
  RiArrowRightLine,
  RiBankCardLine,
  RiBrushLine,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCarLine,
  RiCheckLine,
  RiFileList3Line,
  RiFileTextLine,
  RiHomeSmileLine,
  RiIdCardLine,
  RiLockLine,
  RiMoneyDollarCircleLine,
  RiPlayCircleLine,
  RiShieldCheckLine,
  RiShieldUserLine,
  RiShirtLine,
  RiSmartphoneLine,
  RiTimeLine,
  RiUserStarLine,
} from "@remixicon/react";
import Link from "next/link";
import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { ShineBorder } from "@/components/magicui/shine-border";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface BeforeStepView {
  id: string;
  name: string;
  detail: string;
  waitsOnNovara: boolean;
}

const STEP_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  identity: RiIdCardLine,
  vehicle: RiCarLine,
  agreement: RiFileTextLine,
  phone: RiSmartphoneLine,
  supplies: RiBrushLine,
  job_day: RiCalendarCheckLine,
  dress_code: RiShirtLine,
  background: RiShieldUserLine,
  w9: RiFileList3Line,
  payouts: RiMoneyDollarCircleLine,
  training: RiPlayCircleLine,
  trial: RiHomeSmileLine,
};

const PROMISE = [
  ["Online", "No download"],
  ["No call", "You start it"],
  ["Pausable", "Pick up later"],
] as const;

function readyIcon(text: string): ComponentType<{ className?: string }> {
  const line = text.toLowerCase();
  if (line.includes("camera") || line.includes("phone")) return RiCameraLine;
  if (line.includes("photo id") || line.includes("government")) return RiIdCardLine;
  if (line.includes("driver") || line.includes("vehicle") || line.includes("plate")) return RiCarLine;
  if (line.includes("insured")) return RiShieldCheckLine;
  if (line.includes("supplies")) return RiBrushLine;
  if (line.includes("taxpayer") || line.includes("w-9") || line.includes("mailing")) return RiFileList3Line;
  if (line.includes("payout") || line.includes("stripe") || line.includes("zelle")) return RiBankCardLine;
  if (line.includes("reference")) return RiUserStarLine;
  return RiCheckLine;
}

function sameCopy(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function BeforeYouStartHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[color:var(--hairline)] bg-background/95 backdrop-blur-xl hairline-glow">
      <div className="container mx-auto max-w-6xl px-4 py-4">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/hiring" className="flex items-center gap-2.5 transition hover:opacity-80">
            <img src="/novara-logo.png" alt="Novara" className="h-9 w-9 rounded-lg object-contain sm:h-10 sm:w-10" />
            <span className="font-jakarta text-[15px] font-bold tracking-tight">
              Novara<span className="text-primary">Cleaning</span>
            </span>
          </Link>
          <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
            Field Cleaner
          </Badge>
        </div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            <span className="font-semibold">Step 2</span>
            <span className="text-muted-foreground"> of 3</span>
            <span className="ml-2 text-muted-foreground">— Before you start</span>
          </p>
          <p className="text-sm font-semibold text-primary">66%</p>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-50 ring-1 ring-[color:var(--hairline)]">
          <div className="h-full w-2/3 rounded-full bg-gradient-primary" />
        </div>
      </div>
    </header>
  );
}

export function BeforeYouStartHero({ title, intro }: { title: string; intro: string }) {
  return (
    <BlurFade>
      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-1.5 backdrop-blur-sm">
        <RiTimeLine className="h-4 w-4 text-primary" aria-hidden />
        <AnimatedShinyText className="mx-0 max-w-none text-sm font-medium text-primary">
          Less than 10 minutes
        </AnimatedShinyText>
      </div>
      <h1 className="mt-4 font-jakarta text-3xl font-extrabold leading-tight tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">{intro}</p>
      <Card className="relative mt-6 overflow-hidden">
        <ShineBorder borderWidth={1.5} duration={14} />
        <CardContent className="relative z-10 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-primary text-white shadow-lavender" aria-hidden>
              <NumberTicker value={10} startValue={10} className="font-jakarta text-3xl font-extrabold leading-none text-white" />
              <span className="text-[10px] font-bold uppercase tracking-wider">min</span>
            </div>
            <div>
              <p className="font-jakarta text-lg font-bold leading-snug">
                Get fully onboarded in less than 10 minutes.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                You can stop and come back. Everything stays on this site.
              </p>
            </div>
          </div>
          <ul className="mt-4 grid grid-cols-3 gap-2">
            {PROMISE.map(([label, detail]) => (
              <li key={label} className="rounded-xl border border-primary/15 bg-primary/5 px-2 py-2.5 text-center">
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </BlurFade>
  );
}

export function OnboardingStepRail({ steps }: { steps: BeforeStepView[] }) {
  return (
    <section className="mt-8" aria-labelledby="steps-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="steps-heading" className="font-jakarta text-xl font-bold tracking-tight">The steps</h2>
        <p className="text-sm text-muted-foreground">{steps.length} on this site</p>
      </div>
      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const Icon = STEP_ICONS[step.id] || RiCheckLine;
          return (
            <li key={step.id}>
              <Card>
                <CardContent className="flex gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-jakarta font-bold leading-snug">{step.name}</p>
                      <span className="font-jakarta text-xs font-bold tabular-nums text-primary">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    {!sameCopy(step.detail, step.name) && (
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
                    )}
                    {step.waitsOnNovara && (
                      <Badge variant="outline" className="mt-2 border-primary/30 bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary">
                        A person at Novara reviews this
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ReadyToStartList({ items }: { items: string[] }) {
  return (
    <section className="mt-8" aria-labelledby="ready-heading">
      <h2 id="ready-heading" className="font-jakarta text-xl font-bold tracking-tight">Have these ready</h2>
      <Card className="mt-4">
        <CardContent className="space-y-3 p-5">
          <ul className="space-y-3">
            {items.map((item) => {
              const Icon = readyIcon(item);
              return (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="leading-snug text-foreground">{item}</span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

export function PrivacyNotes({
  lines,
  privacyUrl,
  contactEmail,
  contactPhone,
}: {
  lines: string[];
  privacyUrl: string;
  contactEmail: string;
  contactPhone: string;
}) {
  const icons = [RiIdCardLine, RiLockLine, RiShieldCheckLine];
  return (
    <section className="mt-8" aria-labelledby="safety-heading">
      <h2 id="safety-heading" className="font-jakarta text-xl font-bold tracking-tight">Safety and privacy</h2>
      <Card className="mt-4">
        <CardContent className="space-y-3 p-5">
          {lines.map((line, index) => {
            const Icon = icons[index] || RiShieldCheckLine;
            return (
              <div key={line} className="flex items-start gap-2.5 text-sm">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <p className="leading-relaxed text-foreground">{line}</p>
              </div>
            );
          })}
          <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-sm font-semibold">
            <a className="text-primary underline-offset-4 hover:underline" href={privacyUrl}>Privacy Notice</a>
            <a className="text-primary underline-offset-4 hover:underline" href={`mailto:${contactEmail}`}>{contactEmail}</a>
            <a className="text-primary underline-offset-4 hover:underline" href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export function StartDecision({
  question,
  answer,
  note,
  error,
  expired,
  busy,
  onYes,
  onLater,
  onRequestLink,
}: {
  question: string;
  answer: "yes" | "not_yet" | null;
  note: string;
  error: string;
  expired: boolean;
  busy: boolean;
  onYes: () => void;
  onLater: () => void;
  onRequestLink: () => void;
}) {
  return (
    <section className="mt-8" aria-labelledby="ready-now">
      <Card className="relative overflow-hidden border-primary/30 shadow-lg">
        <BorderBeam size={90} duration={8} />
        <CardContent className="relative z-10 p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">When you are ready</p>
          <h2 id="ready-now" className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight">{question}</h2>
          {answer && (
            <p className="mt-2 text-sm text-muted-foreground">
              Your last answer: {answer === "yes" ? "Yes, start onboarding" : "Not yet, remind me"}. You can change it.
            </p>
          )}
          {note && (
            <Alert className="mt-4">
              <AlertDescription>{note}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {expired ? (
            <Button type="button" size="lg" disabled={busy} onClick={onRequestLink} className="mt-5 h-12 w-full text-base">
              Request a new link
            </Button>
          ) : (
            <div className="mt-5 grid gap-3">
              <Button type="button" size="lg" disabled={busy} onClick={onYes} className="h-12 w-full text-base">
                Yes, start onboarding
                <RiArrowRightLine className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" size="lg" variant="outline" disabled={busy} onClick={onLater} className="h-12 w-full text-base">
                Not yet, remind me
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function BeforeYouStartFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-screen bg-muted/30 text-foreground", className)}>{children}</div>;
}
