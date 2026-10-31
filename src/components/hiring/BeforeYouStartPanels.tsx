"use client";

import type { ComponentType, ReactNode, SVGProps } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export interface BeforeStepView {
  id: string;
  name: string;
  detail: string;
  waitsOnNovara: boolean;
}

const PAPER = "#F3F0E8";
const INK = "#16141C";

type MarkProps = SVGProps<SVGSVGElement>;

function Mark({ children, ...props }: MarkProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden {...props}>
      {children}
    </svg>
  );
}

const STEP_MARKS: Record<string, ComponentType<MarkProps>> = {
  identity: (props) => (
    <Mark {...props}><rect x="5" y="4" width="14" height="16" rx="1.5" /><circle cx="12" cy="10" r="2" /><path d="M8.5 16.5c.6-1.6 1.8-2.4 3.5-2.4s2.9.8 3.5 2.4" /></Mark>
  ),
  vehicle: (props) => (
    <Mark {...props}><path d="M4 14.5 6.2 9.2A2 2 0 0 1 8 8h8a2 2 0 0 1 1.8 1.2L20 14.5" /><path d="M4 14.5h16V17a1 1 0 0 1-1 1h-1.2M4 14.5V17a1 1 0 0 0 1 1h1.2" /><circle cx="7.5" cy="17.2" r="1.3" /><circle cx="16.5" cy="17.2" r="1.3" /></Mark>
  ),
  agreement: (props) => (
    <Mark {...props}><path d="M7 4.5h7l4 4V19.5H7z" /><path d="M14 4.5V9h4" /><path d="M9 14.5c1.2-.8 2.2.6 3.2 0S14.2 13.7 15.5 14.5" /></Mark>
  ),
  phone: (props) => (
    <Mark {...props}><rect x="8" y="3.5" width="8" height="17" rx="1.5" /><path d="M11 18.5h2" /></Mark>
  ),
  supplies: (props) => (
    <Mark {...props}><path d="M8 8.5h8l-1 11H9z" /><path d="M10 8.5V7a2 2 0 0 1 4 0v1.5" /></Mark>
  ),
  job_day: (props) => (
    <Mark {...props}><rect x="4.5" y="5.5" width="15" height="14" rx="1.5" /><path d="M4.5 9.5h15M8 3.8v3.2M16 3.8v3.2" /></Mark>
  ),
  dress_code: (props) => (
    <Mark {...props}><path d="M9 5.5 12 8l3-2.5 2 3.2-2.2 1.2V19H9.2V9.9L7 8.7z" /></Mark>
  ),
  background: (props) => (
    <Mark {...props}><path d="M12 3.8 19 6.5v5.2c0 3.6-2.7 6.2-7 8-4.3-1.8-7-4.4-7-8V6.5z" /><path d="m9.2 12 1.8 1.8 3.8-4" /></Mark>
  ),
  w9: (props) => (
    <Mark {...props}><path d="M7 4h10v16H7z" /><path d="M9.5 8.5h5M9.5 12h5M9.5 15.5h3" /></Mark>
  ),
  payouts: (props) => (
    <Mark {...props}><rect x="3.5" y="6.5" width="17" height="11" rx="1.5" /><path d="M3.5 10.5h17" /><circle cx="16.5" cy="14.2" r="0.8" fill="currentColor" stroke="none" /></Mark>
  ),
  training: (props) => (
    <Mark {...props}><rect x="4" y="6" width="12" height="12" rx="1.5" /><path d="M16 9.5 20.5 7v10L16 14.5" /></Mark>
  ),
  trial: (props) => (
    <Mark {...props}><path d="M4.5 11 12 5l7.5 6" /><path d="M7 10.5V19h10v-8.5" /></Mark>
  ),
};

const PATH = [
  { label: "Approved", state: "done" },
  { label: "Before you start", state: "now" },
  { label: "Onboarding", state: "next" },
] as const;

function sameCopy(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function OnboardingPath() {
  return (
    <div className="relative">
      <div className="absolute left-[16%] right-[16%] top-[7px] h-px bg-[#16141C]/15" aria-hidden />
      <ol className="relative grid grid-cols-3" aria-label="Where you are">
        {PATH.map((step) => (
          <li key={step.label} className="flex flex-col items-center gap-2 text-center">
            <span className="relative z-10 flex h-4 w-4 items-center justify-center bg-[#F3F0E8]" aria-hidden>
              <span
                className={cn(
                  step.state === "done" && "h-2.5 w-2.5 rounded-full bg-[#16141C]",
                  step.state === "now" && "h-2.5 w-2.5 rotate-45 bg-[#5C0FFE]",
                  step.state === "next" && "h-2.5 w-2.5 rounded-full border border-[#16141C]/35",
                )}
              />
            </span>
            <span
              className={cn(
                "max-w-[7.5rem] text-[10px] font-semibold uppercase leading-tight tracking-[0.16em]",
                step.state === "now" ? "text-[#5C0FFE]" : "text-[#16141C]/55",
              )}
              aria-current={step.state === "now" ? "step" : undefined}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TenMinutePromise() {
  return (
    <article className="relative mt-8 flex bg-[#16141C] text-[#F3F0E8] shadow-[0_24px_50px_-28px_rgba(22,20,28,0.7)]">
      <span className="absolute left-[5.6rem] top-0 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: PAPER }} aria-hidden />
      <span className="absolute left-[5.6rem] bottom-0 z-10 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full" style={{ background: PAPER }} aria-hidden />
      <div className="flex w-[5.6rem] shrink-0 flex-col items-center justify-center border-r border-dashed border-white/25 px-2 py-5 text-center">
        <span className="text-[9px] font-semibold tracking-[0.22em] text-white/60">UNDER</span>
        <span className="font-heading text-[2.6rem] font-semibold leading-none tracking-tight">10</span>
        <span className="text-[9px] font-semibold tracking-[0.22em] text-white/60">MINUTES</span>
      </div>
      <div className="min-w-0 flex-1 px-4 py-5 sm:px-5">
        <p className="font-heading text-[1.15rem] font-semibold leading-snug sm:text-xl">
          Get fully onboarded in less than 10 minutes.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          You can stop and come back. Everything stays on this site.
        </p>
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C8B8FF]">
          Online · No call · Pause anytime
        </p>
      </div>
    </article>
  );
}

export function OnboardingStepRail({ steps }: { steps: BeforeStepView[] }) {
  return (
    <section className="mt-12" aria-labelledby="steps-heading">
      <div className="flex items-baseline justify-between gap-4 border-b border-[#16141C]/15 pb-3">
        <h2 id="steps-heading" className="font-heading text-2xl font-semibold tracking-tight">The steps</h2>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#16141C]/45">{steps.length} on this site</p>
      </div>
      <ol>
        {steps.map((step, index) => {
          const Glyph = STEP_MARKS[step.id];
          return (
            <li key={step.id} className="grid grid-cols-[2.75rem_1fr] gap-2 border-b border-[#16141C]/10 py-4 sm:grid-cols-[3.25rem_1fr] sm:gap-4">
              <span className="font-heading text-xl font-medium tabular-nums leading-none text-[#5C0FFE]/80">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex items-start gap-2.5">
                  {Glyph && <Glyph className="mt-0.5 h-4 w-4 shrink-0 text-[#16141C]" />}
                  <p className="font-heading text-[15px] font-semibold leading-snug text-[#16141C]">{step.name}</p>
                </div>
                {!sameCopy(step.detail, step.name) && (
                  <p className="mt-1.5 text-sm leading-relaxed text-[#16141C]/65">{step.detail}</p>
                )}
                {step.waitsOnNovara && (
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5C0FFE]">
                    A person at Novara reviews this
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
    <section className="mt-12" aria-labelledby="ready-heading">
      <h2 id="ready-heading" className="font-heading text-2xl font-semibold tracking-tight">Have these ready</h2>
      <ul className="mt-4 border-y border-[#16141C]/15">
        {items.map((item) => (
          <li key={item} className="flex gap-3 border-b border-[#16141C]/10 py-3.5 last:border-b-0">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rotate-45 bg-[#5C0FFE]" aria-hidden />
            <span className="text-[15px] leading-relaxed text-[#16141C]">{item}</span>
          </li>
        ))}
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
  return (
    <section className="mt-12" aria-labelledby="safety-heading">
      <h2 id="safety-heading" className="font-heading text-2xl font-semibold tracking-tight">Safety and privacy</h2>
      <div className="mt-4 border-l-2 border-[#5C0FFE] pl-4">
        {lines.map((line) => (
          <p key={line} className="mt-3 text-sm leading-relaxed text-[#16141C]/75 first:mt-0">{line}</p>
        ))}
      </div>
      <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold">
        <a className="text-[#5C0FFE] underline decoration-[#5C0FFE]/30 underline-offset-4" href={privacyUrl}>Privacy Notice</a>
        <a className="text-[#16141C] underline decoration-[#16141C]/20 underline-offset-4" href={`mailto:${contactEmail}`}>{contactEmail}</a>
        <a className="text-[#16141C] underline decoration-[#16141C]/20 underline-offset-4" href={`tel:${contactPhone.replace(/[^\d+]/g, "")}`}>{contactPhone}</a>
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
    <section className="mt-12" aria-labelledby="ready-now">
      <div className="bg-[#16141C] px-5 py-6 text-[#F3F0E8] sm:px-6 sm:py-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#C8B8FF]">When you are ready</p>
        <h2 id="ready-now" className="mt-2 font-heading text-2xl font-semibold leading-snug">{question}</h2>
        {answer && (
          <p className="mt-3 text-sm text-white/65">
            Your last answer: {answer === "yes" ? "Yes, start onboarding" : "Not yet, remind me"}. You can change it.
          </p>
        )}
        {note && <p className="mt-4 border border-white/15 px-3 py-2 text-sm text-white/85">{note}</p>}
        {error && (
          <Alert variant="destructive" className="mt-4 border-red-300/30 bg-red-500/10 text-red-50">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {expired ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRequestLink}
            className="mt-6 h-12 w-full bg-white text-base font-semibold text-[#16141C] transition hover:bg-[#F3F0E8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
          >
            Request a new link
          </button>
        ) : (
          <div className="mt-6 grid gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onYes}
              className="h-12 w-full bg-[#5C0FFE] text-base font-semibold text-white transition hover:bg-[#4A0CD0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
            >
              Yes, start onboarding
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onLater}
              className="h-12 w-full border border-white/20 text-base font-semibold text-white/90 transition hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
            >
              Not yet, remind me
            </button>
          </div>
        )}
      </div>
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
    <header>
      <OnboardingPath />
      <h1 className="mt-8 font-heading text-[2rem] font-semibold leading-[1.12] tracking-tight text-[#16141C] sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-prose text-base leading-relaxed text-[#16141C]/70">{intro}</p>
      <TenMinutePromise />
    </header>
  );
}

export const BEFORE_YOU_START_PAPER = PAPER;
export const BEFORE_YOU_START_INK = INK;
