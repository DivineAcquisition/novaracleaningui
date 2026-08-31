"use client";

import type { ReactNode } from "react";

import { AnimatedShinyText } from "@/components/magicui/animated-shiny-text";
import { BlurFade } from "@/components/magicui/blur-fade";
import { BorderBeam } from "@/components/magicui/border-beam";
import { ShineBorder } from "@/components/magicui/shine-border";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for tokenized partner / commercial / walkthrough pages.
 * Cream field, Novara glow only at the top — no particle field.
 */
export function TokenPageShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  topBar,
  maxWidth = "max-w-3xl",
  embedded = false,
}: {
  eyebrow?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  topBar?: ReactNode;
  maxWidth?: string;
  embedded?: boolean;
}) {
  const inner = (
    <div className={cn("relative z-10 mx-auto w-full px-4 py-8 sm:px-6", maxWidth, embedded && "px-0 py-4")}>
      {topBar && <div className="mb-4 flex items-center justify-end text-[11px] font-semibold text-slate-500">{topBar}</div>}
      {(eyebrow || title || subtitle) && (
        <BlurFade delay={0.04} className="mb-6 text-center">
          {!embedded && (
            <img src="/novara-logo.png" alt="Novara Cleaning" className="mx-auto mb-4 h-8" />
          )}
          {eyebrow && (
            <div className="mb-3 inline-flex items-center rounded-full border border-primary/20 bg-primary/[0.04] px-4 py-1.5 backdrop-blur-sm">
              <AnimatedShinyText className="mx-0 max-w-none text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                {eyebrow}
              </AnimatedShinyText>
            </div>
          )}
          {title && (
            <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-600">{subtitle}</p>
          )}
        </BlurFade>
      )}
      <BlurFade delay={0.1}>
        <div className="space-y-4">{children}</div>
      </BlurFade>
      {footer && <div className="mt-8">{footer}</div>}
    </div>
  );

  if (embedded) return inner;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FBF6EE] font-sans text-slate-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-gradient-to-b from-primary/[0.10] via-primary/[0.04] to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[240px] w-[560px] -translate-x-1/2 rounded-full bg-primary/[0.10] blur-3xl" />
      {inner}
    </div>
  );
}

export function TokenPanel({
  children,
  className,
  shine = false,
  beam = false,
}: {
  children: ReactNode;
  className?: string;
  shine?: boolean;
  beam?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl">
      {shine && <ShineBorder borderWidth={1.5} duration={14} />}
      {beam && <BorderBeam size={80} duration={8} />}
      <Panel className={cn("relative z-10 p-5 sm:p-6", className)}>{children}</Panel>
    </div>
  );
}
