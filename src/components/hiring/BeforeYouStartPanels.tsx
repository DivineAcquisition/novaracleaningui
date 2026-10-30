"use client";

import type { ComponentType } from "react";
import {
  RiArrowRightLine,
  RiBankCardLine,
  RiBrushLine,
  RiCalendarCheckLine,
  RiCameraLine,
  RiCarLine,
  RiCheckboxCircleFill,
  RiCheckboxCircleLine,
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
import { BlurFade } from "@/components/magicui/blur-fade";
import { MagicCard } from "@/components/magicui/magic-card";
import { ShimmerButton } from "@/components/magicui/shimmer-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
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

const PATH = [
  { label: "Approved", state: "done" },
  { label: "Before you start", state: "now" },
  { label: "Onboarding", state: "next" },
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
  return RiCheckboxCircleLine;
}

export function OnboardingPath() {
  return (
    <ol className="flex items-center gap-2" aria-label="Where you are">
      {PATH.map((step, index) => (
        <li key={step.label} className="flex min-w-0 items-center gap-2">
          {index > 0 && <span className="h-px w-4 shrink-0 bg-violet-200 sm:w-6" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide",
              step.state === "done" && "bg-emerald-50 text-emerald-800",
              step.state === "now" && "bg-[#5C0FFE] text-white shadow-[0_8px_20px_-12px_rgba(92,15,254,0.8)]",
              step.state === "next" && "bg-white text-slate-500 ring-1 ring-violet-200",
            )}
          >
            {step.state === "done" ? (
              <RiCheckboxCircleFill className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <span className="font-heading tabular-nums" aria-hidden>{index + 1}</span>
            )}
            <span className="truncate">{step.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TenMinutePromise() {
  return (
    <MagicCard className="relative mt-5 overflow-hidden rounded-3xl border border-violet-200/80 bg-white p-4 shadow-[0_22px_50px_-34px_rgba(92,15,254,0.65)] sm:p-5">
      <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#8F7BFD]/25 blur-2xl" aria-hidden />
      <div className="relative flex items-center gap-4">
        <div
          className="flex h-[4.5rem] w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-2xl text-white"
          style={{ background: BRAND.gradient }}
          aria-hidden
        >
          <RiTimeLine className="mb-0.5 h-4 w-4 opacity-90" />
          <span className="font-heading text-[1.65rem] font-bold leading-none">10</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">min</span>
        </div>
        <div className="min-w-0">
          <p className="font-heading text-lg font-semibold leading-snug text-slate-900">
            Get fully onboarded in less than 10 minutes.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">You can stop and come back. Everything stays on this site.</p>
        </div>
      </div>
      <ul className="relative mt-4 grid grid-cols-3 gap-2">
        {[
          ["Online", "No download"],
          ["No call", "You start it"],
          ["Pausable", "Pick up later"],
        ].map(([title, detail]) => (
          <li key={title} className="rounded-2xl bg-[#F7F5FC] px-2 py-2.5 text-center">
            <p className="text-[13px] font-semibold text-slate-900">{title}</p>
            <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{detail}</p>
          </li>
        ))}
      </ul>
    </MagicCard>
  );
}

export function OnboardingStepRail({ steps }: { steps: BeforeStepView[] }) {
  return (
    <section className="mt-8" aria-labelledby="steps-heading">
      <div className="flex items-end justify-between gap-3">
        <h2 id="steps-heading" className="font-heading text-lg font-semibold">The steps</h2>
        <p className="text-sm text-slate-500">{steps.length} steps, all on this site</p>
      </div>
      <ol className="mt-4">
        {steps.map((step, index) => {
          const Icon = STEP_ICONS[step.id] || RiCheckboxCircleLine;
          const last = index === steps.length - 1;
          return (
            <li key={step.id} className="relative flex gap-3">
              {!last && <span className="absolute bottom-0 left-[1.35rem] top-12 w-px bg-violet-200" aria-hidden />}
              <span className="relative z-10 mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#5C0FFE] shadow-[0_8px_20px_-16px_rgba(92,15,254,0.9)] ring-1 ring-violet-200">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className={cn("min-w-0 flex-1 rounded-2xl border border-violet-100 bg-white px-4 py-3", last ? "mb-0" : "mb-3")}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-base font-semibold leading-snug text-slate-900">{step.name}</p>
                  <span className="font-heading text-xs font-semibold tabular-nums text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                </div>
                {step.detail.trim().toLowerCase() !== step.name.trim().toLowerCase() && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.detail}</p>
                )}
                {step.waitsOnNovara && (
                  <p className="mt-2 inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                    Waits on a person at Novara
                  </p>
                )}
              </div>
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
      <h2 id="ready-heading" className="font-heading text-lg font-semibold">Have these ready</h2>
      <ul className="mt-3 grid gap-2">
        {items.map((item) => {
          const Icon = readyIcon(item);
          return (
            <li key={item} className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-white px-3.5 py-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F4F0FF] text-[#5C0FFE]">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <span className="text-sm leading-relaxed text-slate-800">{item}</span>
            </li>
          );
        })}
      </ul>
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
      <h2 id="safety-heading" className="font-heading text-lg font-semibold">Safety and privacy</h2>
      <div className="mt-3 space-y-2">
        {lines.map((line, index) => {
          const Icon = icons[index] || RiShieldCheckLine;
          return (
            <div key={line} className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-white px-3.5 py-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-700 ring-1 ring-slate-200">
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <p className="text-sm leading-relaxed text-slate-700">{line}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm font-semibold">
        <a className="text-[#5C0FFE] underline underline-offset-4" href={privacyUrl}>Privacy Notice</a>
        <a className="text-[#5C0FFE] underline underline-offset-4" href={`mailto:${contactEmail}`}>{contactEmail}</a>
        <a className="text-[#5C0FFE] underline underline-offset-4" href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>
      </p>
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
      <MagicCard className="rounded-3xl border border-violet-200 bg-white p-5 shadow-[0_18px_40px_-32px_rgba(92,15,254,0.55)]">
        <h2 id="ready-now" className="font-heading text-xl font-semibold leading-snug">{question}</h2>
        {answer && (
          <p className="mt-2 text-sm text-slate-600">
            Your last answer: {answer === "yes" ? "Yes, start onboarding" : "Not yet, remind me"}. You can change it.
          </p>
        )}
        {note && (
          <Alert className="mt-3">
            <AlertDescription>{note}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {expired ? (
          <Button type="button" size="lg" disabled={busy} onClick={onRequestLink} className="mt-4 min-h-12 w-full text-base">
            Request a new link
          </Button>
        ) : (
          <div className="mt-4 grid gap-3">
            <ShimmerButton
              type="button"
              disabled={busy}
              background="#5C0FFE"
              borderRadius="0.9rem"
              onClick={onYes}
              className="h-12 w-full gap-2 text-base font-semibold disabled:opacity-60"
            >
              Yes, start onboarding
              <RiArrowRightLine className="h-4 w-4" aria-hidden />
            </ShimmerButton>
            <Button type="button" variant="outline" size="lg" disabled={busy} onClick={onLater} className="min-h-12 w-full text-base">
              Not yet, remind me
            </Button>
          </div>
        )}
      </MagicCard>
    </section>
  );
}

export function BeforeYouStartHero({
  title,
  intro,
}: {
  title: string;
  intro: string;
}) {
  return (
    <BlurFade>
      <OnboardingPath />
      <h1 className="mt-5 font-heading text-[1.7rem] font-semibold leading-tight text-slate-900 sm:text-3xl">{title}</h1>
      <p className="mt-3 text-base leading-relaxed text-slate-700">{intro}</p>
      <TenMinutePromise />
    </BlurFade>
  );
}
